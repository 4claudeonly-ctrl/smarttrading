"""
signal_engine.py — SmartTrading Core Signal Engine
====================================================
Arsitektur  : Zero-Cost (yfinance + pandas-ta + Groq API + Supabase)
Dijadwalkan : GitHub Actions cron */15 market hours (WIB 09:00-15:30)
Output      : INSERT ke tabel `signals` di Supabase
Versi       : 1.0 | 01 Apr 2026

Pipeline:
  1. Ambil daftar ticker dari Supabase (emiten_meta, is_active=True)
  2. Fetch OHLCV 60 hari via yfinance
  3. Hitung 6 indikator teknikal via pandas-ta
  4. Scoring deterministik -> BUY/HOLD/SELL + confidence
  5. Filter confidence >= MIN_CONFIDENCE (70%)
  6. Groq LLM generate narasi bahasa manusia
  7. INSERT ke tabel signals + news_cache
"""

import os
import json
import time
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf
import pandas as pd
import pandas_ta as ta
import requests
from supabase import create_client, Client

# ── Logging setup ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("signal_engine")

# ══════════════════════════════════════════════════════════════
# KONFIGURASI — semua dari environment variables (GitHub Secrets)
# ══════════════════════════════════════════════════════════════
SUPABASE_URL      = os.environ["SUPABASE_URL"]
SUPABASE_KEY      = os.environ["SUPABASE_SERVICE_KEY"]   # service role key
GROQ_API_KEY      = os.environ["GROQ_API_KEY"]
GROQ_MODEL        = "llama-3.3-70b-versatile"
GROQ_API_URL      = "https://api.groq.com/openai/v1/chat/completions"

IDX_TZ            = ZoneInfo("Asia/Jakarta")
MIN_CONFIDENCE    = 70.0          # NFR-008: threshold minimum
SIGNAL_TTL_HOURS  = 4             # signal kadaluarsa setelah 4 jam
OHLCV_DAYS        = 60            # ambil 60 hari data historis
MAX_TICKERS_RUN   = 50            # batasi per run agar tidak timeout GitHub Actions
RATE_LIMIT_SLEEP  = 0.5           # detik jeda antar ticker (hindari rate limit yfinance)

# ── Supabase client ────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ══════════════════════════════════════════════════════════════
# FUNGSI UTILITAS
# ══════════════════════════════════════════════════════════════

def is_market_open() -> bool:
    """Cek apakah BEI sedang buka (Senin-Jumat 09:00-15:30 WIB)."""
    now = datetime.now(IDX_TZ)
    if now.weekday() >= 5:          # Sabtu=5, Minggu=6
        return False
    open_time  = now.replace(hour=9,  minute=0,  second=0, microsecond=0)
    close_time = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return open_time <= now <= close_time


def get_active_tickers(limit: int = MAX_TICKERS_RUN) -> list[str]:
    """Ambil daftar ticker aktif dari Supabase, prioritas LQ45 dulu."""
    resp = (
        supabase.table("emiten_meta")
        .select("ticker, market_cap_tier")
        .eq("is_active", True)
        .order("market_cap_tier")     # LQ45 < IDX80 < SMALL < MICRO
        .limit(limit)
        .execute()
    )
    return [row["ticker"] for row in resp.data]

# ══════════════════════════════════════════════════════════════
# FETCH DATA + HITUNG INDIKATOR
# ══════════════════════════════════════════════════════════════

def fetch_ohlcv(ticker: str) -> pd.DataFrame | None:
    """Fetch data OHLCV dari Yahoo Finance. Ticker IDX pakai suffix .JK"""
    yf_ticker = f"{ticker}.JK"
    try:
        df = yf.download(
            yf_ticker,
            period=f"{OHLCV_DAYS}d",
            interval="1d",
            progress=False,
            auto_adjust=True
        )
        if df.empty or len(df) < 20:
            log.warning(f"Data tidak cukup untuk {ticker}: {len(df)} baris")
            return None
        df.columns = [c.lower() for c in df.columns]
        return df
    except Exception as e:
        log.error(f"Gagal fetch {ticker}: {e}")
        return None


def calculate_indicators(df: pd.DataFrame) -> dict:
    """
    Hitung 6 indikator teknikal menggunakan pandas-ta.
    Return dict dengan nilai indikator terbaru (baris terakhir).
    """
    # RSI (14 hari) — momentum overbought/oversold
    df.ta.rsi(length=14, append=True)

    # MACD (12,26,9) — trend momentum
    df.ta.macd(fast=12, slow=26, signal=9, append=True)

    # EMA 20 + EMA 50 — trend direction
    df.ta.ema(length=20, append=True)
    df.ta.ema(length=50, append=True)

    # Bollinger Bands (20,2) — volatility + mean reversion
    df.ta.bbands(length=20, std=2, append=True)

    # Volume ratio: volume hari ini vs rata-rata 20 hari
    df["vol_ratio"] = df["volume"] / df["volume"].rolling(20).mean()

    latest = df.iloc[-1]
    prev   = df.iloc[-2]

    return {
        "rsi":          round(float(latest.get("RSI_14", 50)), 2),
        "macd":         round(float(latest.get("MACD_12_26_9", 0)), 4),
        "macd_signal":  round(float(latest.get("MACDs_12_26_9", 0)), 4),
        "macd_hist":    round(float(latest.get("MACDh_12_26_9", 0)), 4),
        "ema20":        round(float(latest.get("EMA_20", 0)), 2),
        "ema50":        round(float(latest.get("EMA_50", 0)), 2),
        "bb_upper":     round(float(latest.get("BBU_20_2.0", 0)), 2),
        "bb_lower":     round(float(latest.get("BBL_20_2.0", 0)), 2),
        "bb_mid":       round(float(latest.get("BBM_20_2.0", 0)), 2),
        "vol_ratio":    round(float(latest.get("vol_ratio", 1)), 2),
        "close":        round(float(latest["close"]), 2),
        "prev_close":   round(float(prev["close"]), 2),
        "price_change_pct": round(
            (float(latest["close"]) - float(prev["close"])) / float(prev["close"]) * 100, 2
        ),
    }

# ══════════════════════════════════════════════════════════════
# SCORING ENGINE — Deterministik, tanpa LLM
# Logika: setiap kondisi memberi poin +/-, total -> signal + confidence
# ══════════════════════════════════════════════════════════════

def score_signal(ind: dict) -> tuple[str, float, dict]:
    """
    Scoring berbasis 6 faktor teknikal.
    Return: (signal_type, confidence_pct, score_breakdown)

    Sistem poin:
      Setiap faktor menghasilkan +1 (bullish), 0 (netral), atau -1 (bearish)
      Total skor -6 s/d +6 -> dinormalisasi ke confidence 0-100
      >= +2  -> BUY
      <= -2  -> SELL
      antara -> HOLD
    """
    scores = {}

    # 1. RSI: oversold (<35) = bullish | overbought (>65) = bearish
    rsi = ind["rsi"]
    if rsi < 35:
        scores["rsi"] = 1
    elif rsi > 65:
        scores["rsi"] = -1
    else:
        scores["rsi"] = 0

    # 2. MACD Histogram: positif & naik = bullish
    macd_hist = ind["macd_hist"]
    if macd_hist > 0 and ind["macd"] > ind["macd_signal"]:
        scores["macd"] = 1
    elif macd_hist < 0 and ind["macd"] < ind["macd_signal"]:
        scores["macd"] = -1
    else:
        scores["macd"] = 0

    # 3. EMA Cross: harga > EMA20 > EMA50 = uptrend kuat
    close = ind["close"]
    if close > ind["ema20"] > ind["ema50"]:
        scores["ema_trend"] = 1
    elif close < ind["ema20"] < ind["ema50"]:
        scores["ema_trend"] = -1
    else:
        scores["ema_trend"] = 0

    # 4. Bollinger Bands: dekat lower = oversold | dekat upper = overbought
    bb_range = ind["bb_upper"] - ind["bb_lower"]
    if bb_range > 0:
        bb_position = (close - ind["bb_lower"]) / bb_range
        if bb_position < 0.2:
            scores["bollinger"] = 1
        elif bb_position > 0.8:
            scores["bollinger"] = -1
        else:
            scores["bollinger"] = 0
    else:
        scores["bollinger"] = 0

    # 5. Volume ratio: > 1.5x rata-rata = konfirmasi sinyal kuat
    vol_ratio = ind["vol_ratio"]
    total_direction = sum(scores.values())
    if vol_ratio >= 1.5:
        scores["volume"] = 1 if total_direction >= 0 else -1  # amplify arah
    elif vol_ratio < 0.7:
        scores["volume"] = 0   # low volume = signal lemah, netralkan
    else:
        scores["volume"] = 0

    # 6. Price momentum: naik >1% atau turun >1% dalam sehari
    chg = ind["price_change_pct"]
    if chg > 1.5:
        scores["momentum"] = 1
    elif chg < -1.5:
        scores["momentum"] = -1
    else:
        scores["momentum"] = 0

    # ── Kalkulasi total & signal ───────────────────────────
    total = sum(scores.values())           # -6 s/d +6
    confidence = round(50 + (total / 6) * 50, 1)   # normalisasi ke 0-100
    confidence = max(0.0, min(100.0, confidence))

    if total >= 2:
        signal_type = "BUY"
    elif total <= -2:
        signal_type = "SELL"
    else:
        signal_type = "HOLD"

    return signal_type, confidence, scores

# ══════════════════════════════════════════════════════════════
# GROQ LLM — Generate narasi bahasa manusia (filosofi penasihat)
# ══════════════════════════════════════════════════════════════

def generate_verdict_text(
    ticker: str,
    emiten_name: str,
    signal_type: str,
    confidence: float,
    ind: dict,
    scores: dict,
) -> str:
    """
    Panggil Groq API untuk generate narasi verdict dalam Bahasa Indonesia.
    Filosofi: penasihat senior, bukan terminal trading.
    Jika Groq gagal, fallback ke narasi template.
    """
    score_desc = []
    label_map = {
        "rsi": f"RSI {ind['rsi']} ({'oversold' if ind['rsi']<35 else 'overbought' if ind['rsi']>65 else 'netral'})",
        "macd": f"MACD histogram {'positif' if ind['macd_hist']>0 else 'negatif'}",
        "ema_trend": f"harga {'di atas' if scores.get('ema_trend',0)==1 else 'di bawah'} EMA20/50",
        "bollinger": f"posisi {'bawah' if scores.get('bollinger',0)==1 else 'atas' if scores.get('bollinger',0)==-1 else 'tengah'} Bollinger",
        "volume": f"volume {ind['vol_ratio']:.1f}x rata-rata",
        "momentum": f"harga {'naik' if ind['price_change_pct']>0 else 'turun'} {abs(ind['price_change_pct']):.1f}% hari ini",
    }
    for k, v in scores.items():
        score_desc.append(f"- {label_map.get(k, k)}: {'bullish' if v>0 else 'bearish' if v<0 else 'netral'}")

    prompt = f"""Kamu adalah analis saham senior Indonesia. Buat narasi analisis SINGKAT (3-4 kalimat) untuk saham {ticker} ({emiten_name}).

Data teknikal:
{chr(10).join(score_desc)}

Harga saat ini: Rp {ind['close']:,.0f} | Sinyal: {signal_type} | Keyakinan: {confidence:.0f}%

Aturan narasi:
1. Gunakan bahasa awam — JANGAN sebut angka RSI/MACD/EMA secara langsung
2. Jelaskan apa artinya dalam bahasa sehari-hari (contoh: "volume 2x lipat = investor besar mulai masuk")
3. Sertakan 1 kalimat risiko eksplisit
4. Akhiri dengan range harga wajar untuk disampaikan ke broker
5. JANGAN ada tombol, CTA, atau instruksi order — hanya narasi analisis

Tulis dalam Bahasa Indonesia yang natural."""

    try:
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 300,
            "temperature": 0.4,
        }
        resp = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=15)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()

    except Exception as e:
        log.warning(f"Groq gagal untuk {ticker}: {e} — pakai fallback template")
        action = {"BUY": "layak dipertimbangkan untuk dibeli", "SELL": "sebaiknya dievaluasi untuk dijual", "HOLD": "disarankan untuk ditahan dulu"}
        return (
            f"{emiten_name} ({ticker}) saat ini {action.get(signal_type, 'dalam kondisi netral')} "
            f"berdasarkan analisis teknikal dengan keyakinan {confidence:.0f}%. "
            f"Harga saat ini di Rp {ind['close']:,.0f}. "
            f"Selalu pertimbangkan kondisi pasar secara keseluruhan sebelum mengambil keputusan."
        )


# ══════════════════════════════════════════════════════════════
# SUPABASE WRITER
# ══════════════════════════════════════════════════════════════

def write_signal_to_db(
    ticker: str,
    signal_type: str,
    confidence: float,
    ind: dict,
    scores: dict,
    verdict_text: str,
) -> bool:
    """Insert signal baru ke tabel signals di Supabase."""
    expires_at = datetime.now(IDX_TZ) + timedelta(hours=SIGNAL_TTL_HOURS)
    # Estimasi range harga: ±2% dari harga saat ini
    price = ind["close"]
    payload = {
        "ticker":          ticker,
        "signal_type":     signal_type,
        "confidence":      confidence,
        "price_at_signal": price,
        "price_low":       round(price * 0.98, 2),
        "price_high":      round(price * 1.02, 2),
        "verdict_text":    verdict_text,
        "reasoning_raw":   scores,
        "indicators":      ind,
        "timeframe":       "SWING",
        "expires_at":      expires_at.isoformat(),
    }
    try:
        supabase.table("signals").insert(payload).execute()
        return True
    except Exception as e:
        log.error(f"Gagal insert signal {ticker}: {e}")
        return False

# ══════════════════════════════════════════════════════════════
# MAIN ORCHESTRATOR
# ══════════════════════════════════════════════════════════════

def run_signal_engine():
    """
    Entry point utama — dipanggil oleh GitHub Actions cron.
    Jalankan pipeline lengkap untuk semua ticker aktif.
    """
    log.info("=== Signal Engine START ===")

    if not is_market_open():
        log.info("Pasar BEI tutup — engine tidak dijalankan.")
        return

    tickers = get_active_tickers()
    log.info(f"Memproses {len(tickers)} ticker...")

    # Ambil nama emiten sekaligus untuk efisiensi
    meta_resp = supabase.table("emiten_meta").select("ticker,name").in_("ticker", tickers).execute()
    meta_map = {row["ticker"]: row["name"] for row in meta_resp.data}

    stats = {"processed": 0, "signals_inserted": 0, "skipped_confidence": 0, "errors": 0}

    for ticker in tickers:
        log.info(f"  -> {ticker}")
        try:
            # 1. Fetch OHLCV
            df = fetch_ohlcv(ticker)
            if df is None:
                stats["errors"] += 1
                continue

            # 2. Hitung indikator
            ind = calculate_indicators(df)

            # 3. Scoring
            signal_type, confidence, scores = score_signal(ind)
            stats["processed"] += 1

            # 4. Filter confidence minimum (NFR-008)
            if confidence < MIN_CONFIDENCE:
                log.info(f"     Skip {ticker}: confidence {confidence:.1f}% < {MIN_CONFIDENCE}%")
                stats["skipped_confidence"] += 1
                continue

            # 5. Generate narasi Groq
            emiten_name = meta_map.get(ticker, ticker)
            verdict_text = generate_verdict_text(ticker, emiten_name, signal_type, confidence, ind, scores)

            # 6. Simpan ke DB
            ok = write_signal_to_db(ticker, signal_type, confidence, ind, scores, verdict_text)
            if ok:
                stats["signals_inserted"] += 1
                log.info(f"     {signal_type} {confidence:.1f}% -> INSERTED")
            else:
                stats["errors"] += 1

            time.sleep(RATE_LIMIT_SLEEP)

        except Exception as e:
            log.error(f"Error pada {ticker}: {e}")
            stats["errors"] += 1
            continue

    log.info("=== Signal Engine DONE ===")
    log.info(
        f"Stats: processed={stats['processed']} | "
        f"inserted={stats['signals_inserted']} | "
        f"skipped={stats['skipped_confidence']} | "
        f"errors={stats['errors']}"
    )
    return stats


# ══════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    run_signal_engine()
