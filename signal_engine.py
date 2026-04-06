"""
signal_engine.py — SmartTrading Core Signal Engine
====================================================
Arsitektur  : Zero-Cost (yfinance + pandas-ta + Groq API + Supabase)
Dijadwalkan : GitHub Actions cron */15 market hours (WIB 09:00-15:30)
Output      : INSERT ke tabel `signals` di Supabase
Versi       : 2.0 | 03 Apr 2026  [PATCHED: 4-komponen scoring]

Pipeline v2.0:
  1. Ambil daftar ticker dari Supabase (emiten_meta, is_active=True)
  2. Fetch OHLCV 60 hari via yfinance
  3. Hitung 6 indikator teknikal via pandas-ta
  4. [NEW] Deteksi fase cacing/naga via phase_detector
  5. [NEW] Evaluasi macro trigger via macro_trigger
  6. [NEW] Analisis broker flow via broker_flow
  7. Scoring 4-komponen: 35% teknikal + 25% fase + 20% sentimen + 20% macro
  8. Filter confidence >= MIN_CONFIDENCE (70%)
  9. Groq LLM generate narasi bahasa manusia
  10. INSERT ke tabel signals (+ kolom baru: phase, cacing_score, macro_flag, fomo_penalty)

Scoring Formula:
  confidence = (teknikal*0.35 + fase*0.25 + sentimen*0.20 + macro*0.20)
  Guardrail: DISTRIBUSI<=60 | DUMP<=20 | SHORT_REPORT=0 | FOMO-=15
"""

import os
import json
import time
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf
import pandas as pd
# pandas_ta dihapus — pakai pure pandas TA di calculate_indicators()
import requests
from supabase import create_client, Client

# [v2.0] Import modul backend expansion
try:
    from phase_detector import classify_phase, cacing_score_calc, naga_score_calc, apply_phase_to_confidence
    from macro_trigger import evaluate_macro_context, MacroEvent
    from broker_flow import analyze_broker_flow
    _MODULES_LOADED = True
    log_pre = "phase_detector + macro_trigger + broker_flow LOADED"
except ImportError as _e:
    _MODULES_LOADED = False
    log_pre = f"WARNING: modul baru tidak ditemukan ({_e}) — fallback ke scoring v1.0"

# ── Logging setup ──────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("signal_engine")

# Log status modul v2.0 (dievaluasi setelah import)
# (log_pre diset saat import modul, diprint saat engine start)

# ══════════════════════════════════════════════════════════════
# KONFIGURASI — semua dari environment variables (GitHub Secrets)
# ══════════════════════════════════════════════════════════════
SUPABASE_URL      = os.environ["SUPABASE_URL"]
SUPABASE_KEY      = os.environ["SUPABASE_SERVICE_KEY"]   # service role key
GROQ_API_KEY      = os.environ["GROQ_API_KEY"]
GROQ_MODEL        = "llama-3.3-70b-versatile"
GROQ_API_URL      = "https://api.groq.com/openai/v1/chat/completions"

IDX_TZ            = ZoneInfo("Asia/Jakarta")
MIN_CONFIDENCE    = 50.0          # Turun dari 70 — kondisi pasar bearish, sinyal 55-65% tetap valid
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
        .order("is_active", desc=True)   # aktif dulu, LQ45 first via market_cap_tier ordering done in app
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


def _ema_series(series: pd.Series, period: int) -> pd.Series:
    """EMA menggunakan pandas ewm — pengganti pandas_ta."""
    return series.ewm(span=period, adjust=False).mean()

def calculate_indicators(df: pd.DataFrame) -> dict:
    """
    Hitung indikator teknikal menggunakan pure pandas (tanpa pandas_ta).
    Compatible dengan Python 3.11 di GitHub Actions Linux.
    """
    close  = df["close"].astype(float)
    volume = df["volume"].astype(float)

    # ── RSI (14) — Wilder's smoothing via EMA ──────────────────
    delta = close.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_gain = gain.ewm(com=13, adjust=False).mean()
    avg_loss = loss.ewm(com=13, adjust=False).mean()
    rs  = avg_gain / avg_loss.replace(0, float("nan"))
    rsi = 100 - (100 / (1 + rs))

    # ── MACD (12, 26, 9) ────────────────────────────────────────
    ema12       = _ema_series(close, 12)
    ema26       = _ema_series(close, 26)
    macd_line   = ema12 - ema26
    macd_signal = _ema_series(macd_line, 9)
    macd_hist   = macd_line - macd_signal

    # ── EMA 20 + EMA 50 ─────────────────────────────────────────
    ema20 = _ema_series(close, 20)
    ema50 = _ema_series(close, 50)

    # ── Bollinger Bands (20, 2) ──────────────────────────────────
    bb_mid   = close.rolling(20).mean()
    bb_std   = close.rolling(20).std(ddof=0)
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std

    # ── Volume ratio (hari ini vs 20d avg) ───────────────────────
    vol_ratio = volume / volume.rolling(20).mean()

    latest = df.index[-1]
    prev   = df.index[-2]

    def safe(series, idx, default=0.0):
        try:
            v = series.loc[idx]
            return round(float(v), 4) if not pd.isna(v) else default
        except Exception:
            return default

    return {
        "rsi":          safe(rsi,        latest, 50.0),
        "macd":         safe(macd_line,  latest, 0.0),
        "macd_signal":  safe(macd_signal,latest, 0.0),
        "macd_hist":    safe(macd_hist,  latest, 0.0),
        "ema20":        safe(ema20,      latest, 0.0),
        "ema50":        safe(ema50,      latest, 0.0),
        "bb_upper":     safe(bb_upper,   latest, 0.0),
        "bb_lower":     safe(bb_lower,   latest, 0.0),
        "bb_mid":       safe(bb_mid,     latest, 0.0),
        "vol_ratio":    safe(vol_ratio,  latest, 1.0),
        "close":        safe(close,      latest, 0.0),
        "prev_close":   safe(close,      prev,   0.0),
        "price_change_pct": round(
            (safe(close, latest) - safe(close, prev)) / max(safe(close, prev), 0.01) * 100, 2
        ),
    }

# ══════════════════════════════════════════════════════════════
# SCORING ENGINE — Deterministik, tanpa LLM
# Logika: setiap kondisi memberi poin +/-, total -> signal + confidence
# ══════════════════════════════════════════════════════════════

def score_signal(
    ind: dict,
    phase_result: dict | None = None,
    macro_result: dict | None = None,
    sentiment_score: float | None = None,
) -> tuple[str, float, dict]:
    """
    Scoring 4-komponen v2.0:
      35% teknikal (RSI, MACD, EMA, BB, Volume, Momentum)
      25% fase cacing/naga (phase_detector)
      20% sentimen Groq news (dari news_cache aggregate)
      20% macro trigger (macro_trigger)

    Guardrail:
      - fase DISTRIBUSI -> hard cap confidence 60
      - fase DUMP       -> hard cap confidence 20
      - short_report    -> override confidence = 0
      - FOMO >5k mention -> minus 15 poin

    Return: (signal_type, confidence_pct, score_breakdown)
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

    # ── Kalkulasi total teknikal & signal awal ─────────────
    total = sum(scores.values())           # -6 s/d +6
    teknikal_conf = round(50 + (total / 6) * 50, 1)   # normalisasi ke 0-100
    teknikal_conf = max(0.0, min(100.0, teknikal_conf))

    if total >= 2:
        signal_type = "BUY"
    elif total <= -2:
        signal_type = "SELL"
    else:
        signal_type = "HOLD"

    # ── [v2.0] 4-Komponen Scoring ───────────────────────────
    # Komponen 1: Teknikal (35%) — sudah dihitung di atas
    w_teknikal = teknikal_conf * 0.35

    # Komponen 2: Fase Cacing/Naga (25%)
    fase_conf = 50.0   # default netral
    fase_label = "UNKNOWN"
    cacing_score = 0.0
    fomo_penalty = 0
    if _MODULES_LOADED and phase_result:
        fase_label = phase_result.get("phase", "UNKNOWN")
        cacing_score = float(phase_result.get("cacing_score", 0.0))
        naga_score   = float(phase_result.get("naga_score",  0.0))
        # AKUMULASI -> bullish boost, DISTRIBUSI -> bearish, DUMP -> sangat bearish
        if fase_label == "AKUMULASI":
            fase_conf = 50 + cacing_score * 50      # 50-100
        elif fase_label == "DISTRIBUSI":
            fase_conf = 50 - naga_score * 30        # 20-50
        elif fase_label == "DUMP":
            fase_conf = 20.0
        else:
            fase_conf = 50.0
        # FOMO penalty
        fomo_mention = phase_result.get("fomo_mention_count", 0)
        if fomo_mention > 5000:
            fomo_penalty = 15
    w_fase = fase_conf * 0.25

    # Komponen 3: Sentimen Groq (20%)
    sentimen_conf = sentiment_score if sentiment_score is not None else 50.0
    w_sentimen = sentimen_conf * 0.20

    # Komponen 4: Macro Trigger (20%)
    macro_conf = 50.0
    macro_flag = []
    if _MODULES_LOADED and macro_result:
        macro_conf = float(macro_result.get("macro_conf", 50.0))
        macro_flag = macro_result.get("flags", [])
    w_macro = macro_conf * 0.20

    # ── Gabungkan + guardrail ────────────────────────────────
    confidence = round(w_teknikal + w_fase + w_sentimen + w_macro - fomo_penalty, 1)
    confidence = max(0.0, min(100.0, confidence))

    # Guardrail keras berdasarkan fase
    if fase_label == "DISTRIBUSI":
        confidence = min(confidence, 60.0)
    elif fase_label == "DUMP":
        confidence = min(confidence, 20.0)

    # Override khusus: SHORT_REPORT -> confidence = 0
    if "SHORT_REPORT" in macro_flag:
        confidence = 0.0
        signal_type = "SELL"

    # Simpan breakdown lengkap
    scores["_fase"]        = fase_label
    scores["_cacing_score"] = round(cacing_score, 3)
    scores["_macro_flag"]  = macro_flag
    scores["_fomo_penalty"] = fomo_penalty
    scores["_teknikal_conf"] = round(teknikal_conf, 1)
    scores["_fase_conf"]   = round(fase_conf, 1)
    scores["_sentimen_conf"] = round(sentimen_conf, 1)
    scores["_macro_conf"]  = round(macro_conf, 1)

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
            "max_tokens": 600,
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
    # [v2.0] Ekstrak field baru dari scores breakdown
    _fase_label    = scores.get("_fase", "UNKNOWN")
    _cacing_score  = scores.get("_cacing_score", 0.0)
    _macro_flag    = scores.get("_macro_flag", [])
    _fomo_penalty  = scores.get("_fomo_penalty", 0)

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
        # [v2.0] kolom baru dari backend expansion
        "phase":           _fase_label,
        "cacing_score":    _cacing_score,
        "macro_flag":      _macro_flag,
        "fomo_penalty":    _fomo_penalty,
    }
    try:
        # Upsert — overwrite sinyal lama per ticker (UNIQUE constraint signals_ticker_unique)
        supabase.table("signals").upsert(payload, on_conflict="ticker").execute()
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
    log.info("=== Signal Engine START === [v2.0 — 4-komponen scoring]")
    log.info(f"Modul status: {log_pre}")

    force_run = os.environ.get("FORCE_RUN", "false").lower() == "true"
    if not is_market_open() and not force_run:
        log.info("Pasar BEI tutup — engine tidak dijalankan. (Set FORCE_RUN=true untuk override)")
        return
    if force_run and not is_market_open():
        log.info("FORCE_RUN=true — menjalankan engine di luar jam bursa (manual trigger)")

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

            # 3a. [v2.0] Fetch phase_detector input
            phase_result = None
            if _MODULES_LOADED:
                try:
                    # Ambil vol series 30 hari terakhir
                    vol_series = df["volume"].tail(30).tolist()
                    price_change_30d = float(
                        (df["close"].iloc[-1] - df["close"].iloc[-30]) / df["close"].iloc[-30] * 100
                    ) if len(df) >= 30 else 0.0
                    phase_result = classify_phase(
                        vol_series=vol_series,
                        rsi=ind["rsi"],
                        price_change_30d=price_change_30d
                    )
                    # Tambah cacing/naga score ke phase_result
                    phase_result["cacing_score"] = cacing_score_calc(
                        vol_series=vol_series,
                        rsi=ind["rsi"],
                        price_change_30d=price_change_30d
                    )
                    phase_result["naga_score"] = naga_score_calc(
                        vol_series=vol_series,
                        rsi=ind["rsi"],
                        price_change_30d=price_change_30d
                    )
                except Exception as _ep:
                    log.warning(f"  phase_detector error {ticker}: {_ep}")

            # 3b. [v2.0] Fetch macro trigger
            macro_result = None
            if _MODULES_LOADED:
                try:
                    # Ambil berita terbaru dari Supabase untuk ticker ini
                    news_resp = (
                        supabase.table("news_cache")
                        .select("title,sentiment,relevance")
                        .eq("ticker", ticker)
                        .order("published_at", desc=True)
                        .limit(20)
                        .execute()
                    )
                    news_items = news_resp.data or []
                    macro_result = evaluate_macro_context(
                        ticker=ticker,
                        news_items=news_items
                    )
                    # Hitung sentimen aggregate dari news
                    if news_items:
                        pos = sum(1 for n in news_items if n.get("sentiment") == "POSITIVE")
                        neg = sum(1 for n in news_items if n.get("sentiment") == "NEGATIVE")
                        total_news = len(news_items)
                        sentiment_score = round(50 + (pos - neg) / total_news * 50, 1)
                    else:
                        sentiment_score = 50.0
                except Exception as _em:
                    log.warning(f"  macro_trigger error {ticker}: {_em}")
                    sentiment_score = 50.0
            else:
                sentiment_score = 50.0

            # 3. Scoring 4-komponen
            signal_type, confidence, scores = score_signal(
                ind,
                phase_result=phase_result,
                macro_result=macro_result,
                sentiment_score=sentiment_score,
            )
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
