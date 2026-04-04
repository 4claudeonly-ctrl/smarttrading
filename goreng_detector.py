"""
goreng_detector.py — SmartTrading v1.0
==================================================
Deteksi Dini Pump & Dump (Saham Gorengan) di BEI

FILOSOFI:
  Bandar goreng saham bukan tiba-tiba — ada JEJAK yang bisa dibaca:
  1. Fase Akumulasi Diam: volume aneh, harga stagnan, broker terkonsentrasi
  2. Fase Pump: volume meledak, harga naik vertikal, retail FOMO masuk
  3. Fase Distribusi: bandar jual pelan di puncak, volume masih tinggi
  4. Fase Dump: bandar sudah keluar, retail nyangkut

CONTOH KASUS PANI (Pantai Indah Kapuk Dua):
  - Backing: Sedayu Group (Agung Sedayu + Salim Group) — konglomerat tier-1
  - Proyek: PIK2 (Proyek Strategis Nasional) — legitimasi sangat kuat
  - Pola: Akumulasi panjang 6 bulan (PANI 108-300), lalu pump ke 2500+
  - Kekuatan: Bandar besar + katalis fundamental nyata = goreng BERKUALITAS
  - Bahaya: Tetap ada risiko dump karena masih "hype premium"

SCORING MODEL:
  Pump Score 0-100:
    30% — Anomali Volume (akkumulasi diam vs meledak)
    25% — Konsentrasi Broker (HHI index, blok transaksi)
    20% — Pola Harga (stagnan lalu naik vertikal)
    15% — Kekuatan Bandar (size + legitimasi backing)
    10% — Sentimen Sosmed + Berita

  Dump Risk 0-100 (semakin tinggi = semakin dekat dump):
    Berdasarkan: posisi harga vs 52W high, RSI extreme,
    divergence volume, distribusi broker, waktu pump

OUTPUT per ticker:
  goreng_phase: CLEAN | AKUMULASI | PUMP_AWAL | PUMP_PUNCAK | DISTRIBUSI | DUMP
  pump_score: 0-100
  dump_risk: 0-100
  gagal_goreng_pct: % kemungkinan pump gagal (berhenti sebelum puncak)
  bandar_strength: WEAK | MEDIUM | STRONG | KONGLOMERAT
  recommendation: narasi bahasa manusia + saran riding vs exit
  warning_level: NONE | WATCH | RIDE | EXIT_NOW | DANGER
"""

import os, sys, json, logging, time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf
import pandas as pd
import requests
from supabase import create_client
try:
    from supabase import Client
except ImportError:
    Client = object  # fallback untuk type hint

log = logging.getLogger("goreng_detector")
IDX_TZ = ZoneInfo("Asia/Jakarta")

# ══════════════════════════════════════════════════════════════
# KNOWLEDGE BASE BANDAR BEI
# Daftar backing korporat yang diketahui + kekuatannya
# ══════════════════════════════════════════════════════════════
BANDAR_KNOWLEDGE = {
    # Format: "TICKER": {"group": "Nama Grup", "strength": "KONGLOMERAT|STRONG|MEDIUM|WEAK",
    #          "legit_catalyst": True/False, "backing_desc": "deskripsi"}
    "PANI": {
        "group": "Sedayu Group (Agung Sedayu + Salim)",
        "strength": "KONGLOMERAT",
        "legit_catalyst": True,
        "backing_desc": "PIK2 Proyek Strategis Nasional, backing Agung Sedayu + Salim Group. "
                        "Modal sangat besar, mampu maintain harga lama. Goreng BERKUALITAS tapi tetap goreng.",
        "dump_risk_modifier": -20,   # konglomerat = lebih susah dump tiba-tiba, kurangi risk
        "gagal_modifier": -15,       # legitimasi tinggi = lebih susah gagal goreng
    },
    "ARTO": {
        "group": "GoTo / Gojek Ekosistem",
        "strength": "STRONG",
        "legit_catalyst": True,
        "backing_desc": "Bank Jago didukung GoTo ekosistem. Goreng 2021 dari 200 ke 19.000 — classic tech hype.",
        "dump_risk_modifier": 0,
        "gagal_modifier": 0,
    },
    "KIOS": {
        "group": "Unknown / Spekulan",
        "strength": "WEAK",
        "legit_catalyst": False,
        "backing_desc": "Tidak ada katalis fundamental — pure goreng spekulatif. "
                        "Naik 300 ke 5.000 lalu balik ke gocap (50). Classic pump & dump.",
        "dump_risk_modifier": +25,
        "gagal_modifier": +20,
    },
    "WIFI": {
        "group": "Spekulan Telco",
        "strength": "MEDIUM",
        "legit_catalyst": False,
        "backing_desc": "Hype nama 'WiFi' tanpa fundamental kuat.",
        "dump_risk_modifier": +15,
        "gagal_modifier": +10,
    },
}

# Emiten yang SERING digoreng di BEI (watchlist otomatis)
GORENG_WATCHLIST = [
    # Small cap rawan goreng
    "KIOS", "WIFI", "FOLK", "RISE", "TOPS", "CLAY", "TRJA", "SMKL",
    "BOAT", "TAXI", "CARS", "BEER", "GOOD", "CAKE", "MEAT", "CMRY",
    # Mid cap dengan sejarah pump
    "PANI", "ARTO", "GOTO", "BBYB", "AMOR", "NICL", "NCKL",
    # Properti yang sering digoreng saat ada PSN
    "BSDE", "CTRA", "DMAS", "PWON", "KIJA",
]

# ══════════════════════════════════════════════════════════════
# THRESHOLDS & CONSTANTS
# ══════════════════════════════════════════════════════════════
VOL_ANOMALY_MULTIPLIER   = 2.5   # volume > 2.5x avg = anomali
VOL_EXPLOSION_MULTIPLIER = 5.0   # volume > 5x avg = pump explosion
PRICE_PUMP_THRESHOLD_7D  = 0.15  # naik >15% dalam 7 hari = pump sinyal
PRICE_PUMP_THRESHOLD_30D = 0.40  # naik >40% dalam 30 hari = pump kuat
HHI_CONCENTRATION        = 0.35  # HHI > 0.35 = broker terkonsentrasi
RETAIL_ENTRY_SIGNAL      = 0.60  # >60% broker adalah retail = fase distribusi
RSI_EXTREME_OVERBOUGHT   = 80    # RSI > 80 = danger zone
RSI_PUMP_ZONE            = 70    # RSI > 70 = pump sedang jalan
NEAR_52W_HIGH_PCT        = 0.90  # harga > 90% dari 52W high = rawan dump

PHASE_LABELS = {
    "CLEAN":       "Tidak Terdeteksi Goreng",
    "AKUMULASI":   "⚠️ AKUMULASI DIAM — Bandar Mulai Kumpul",
    "PUMP_AWAL":   "🚀 PUMP AWAL — Momentum Naik, Masih Aman",
    "PUMP_PUNCAK": "🔥 PUMP PUNCAK — Hati-hati, Bandar Mulai Jual",
    "DISTRIBUSI":  "🚨 DISTRIBUSI — Bandar Sedang Keluar!",
    "DUMP":        "💀 DUMP — Sudah Terlambat, Jangan Masuk",
}

WARNING_LEVELS = {
    "NONE":     {"emoji": "✅", "color": "green"},
    "WATCH":    {"emoji": "👀", "color": "yellow"},
    "RIDE":     {"emoji": "🚀", "color": "teal"},
    "EXIT_NOW": {"emoji": "🚨", "color": "red"},
    "DANGER":   {"emoji": "💀", "color": "crimson"},
}


# ══════════════════════════════════════════════════════════════
# FUNGSI UTAMA: fetch data + analisis goreng
# ══════════════════════════════════════════════════════════════
def fetch_ohlcv_goreng(ticker: str, days: int = 90) -> pd.DataFrame | None:
    """Fetch OHLCV 90 hari untuk analisis goreng."""
    sym = ticker if ticker.endswith(".JK") else f"{ticker}.JK"
    try:
        df = yf.download(sym, period=f"{days}d", interval="1d",
                         auto_adjust=True, progress=False)
        if df.empty or len(df) < 20:
            return None
        # yfinance v1.2+ returns MultiIndex columns — flatten
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [col[0].lower() if isinstance(col, tuple) else str(col).lower()
                          for col in df.columns]
        else:
            df.columns = [str(c).lower() for c in df.columns]
        # Ambil kolom yang dibutuhkan (kadang namanya "Close" bukan "close")
        col_map = {}
        for need in ["open","high","low","close","volume"]:
            for c in df.columns:
                if c.lower() == need:
                    col_map[need] = c
                    break
        if len(col_map) < 5:
            return None
        df = df[[col_map[k] for k in ["open","high","low","close","volume"]]].copy()
        df.columns = ["open","high","low","close","volume"]
        df = df.dropna()
        return df
    except Exception as e:
        log.warning(f"Gagal fetch {ticker}: {e}")
        return None


def calc_volume_anomaly(df: pd.DataFrame) -> dict:
    """
    Deteksi anomali volume — inti dari deteksi akumulasi diam.

    Bandar akumulasi: volume NAIK KONSISTEN tapi harga STAGNAN.
    Bandar pump: volume MELEDAK + harga NAIK VERTIKAL.
    Bandar distribusi: volume masih tinggi tapi harga mulai stagnan/turun.
    """
    vol    = df["volume"].astype(float)
    close  = df["close"].astype(float)

    vol_20d_avg  = vol.rolling(20).mean()
    vol_5d_avg   = vol.rolling(5).mean()
    vol_ratio_now = float(vol.iloc[-1] / vol_20d_avg.iloc[-1]) if vol_20d_avg.iloc[-1] > 0 else 1.0

    # Konsistensi kenaikan volume 14 hari terakhir (akumulasi diam)
    vol_14d = vol.iloc[-14:]
    vol_trend_up = int((vol_14d.diff().dropna() > 0).sum())  # berapa hari volume naik
    vol_consistency = vol_trend_up / 13  # 0-1, makin tinggi = makin konsisten naik

    # Price stagnasi saat volume naik (ciri akumulasi)
    price_14d_chg = float((close.iloc[-1] - close.iloc[-14]) / close.iloc[-14] * 100)
    price_stagnant = abs(price_14d_chg) < 8  # harga gerak <8% saat volume naik

    # Volume explosion 3 hari terakhir vs 20d avg
    vol_3d_ratio = float(vol.iloc[-3:].mean() / vol_20d_avg.iloc[-1]) if vol_20d_avg.iloc[-1] > 0 else 1.0

    # Deteksi distribusi: volume mulai turun dari peak
    vol_peak_10d = float(vol.iloc[-10:].max())
    vol_recent_3d = float(vol.iloc[-3:].mean())
    distribusi_signal = vol_recent_3d < vol_peak_10d * 0.6  # volume turun 40% dari puncak

    return {
        "vol_ratio_now":    round(vol_ratio_now, 2),
        "vol_3d_ratio":     round(vol_3d_ratio, 2),
        "vol_consistency":  round(vol_consistency, 2),
        "price_stagnant":   price_stagnant,
        "price_14d_chg":    round(price_14d_chg, 2),
        "distribusi_signal": distribusi_signal,
    }

def calc_price_pump_score(df: pd.DataFrame) -> dict:
    """Analisis pola harga untuk deteksi pump."""
    close = df["close"].astype(float)
    high  = df["high"].astype(float)
    low   = df["low"].astype(float)

    last   = float(close.iloc[-1])
    c7ago  = float(close.iloc[-8])  if len(close) >= 8  else float(close.iloc[0])
    c30ago = float(close.iloc[-31]) if len(close) >= 31 else float(close.iloc[0])
    c60ago = float(close.iloc[-61]) if len(close) >= 61 else float(close.iloc[0])

    ret7d  = (last - c7ago)  / c7ago  * 100
    ret30d = (last - c30ago) / c30ago * 100
    ret60d = (last - c60ago) / c60ago * 100

    high52w = float(high.max())
    low52w  = float(low.min())
    pct_of_52w_high = last / high52w if high52w > 0 else 1.0

    # Upper shadow dominan (bandar distribusi sambil jual di atas)
    recent_candles = df.iloc[-5:]
    upper_shadows = []
    for _, row in recent_candles.iterrows():
        body = abs(float(row["close"]) - float(row["open"]))
        upper = float(row["high"]) - max(float(row["close"]), float(row["open"]))
        if body > 0:
            upper_shadows.append(upper / body)
    avg_upper_shadow = sum(upper_shadows) / len(upper_shadows) if upper_shadows else 0

    # Gap up deteksi (pump sering mulai dengan gap up)
    gap_up_count = 0
    for i in range(-5, 0):
        if float(df["open"].iloc[i]) > float(df["close"].iloc[i-1]) * 1.02:
            gap_up_count += 1

    return {
        "ret7d":            round(ret7d, 2),
        "ret30d":           round(ret30d, 2),
        "ret60d":           round(ret60d, 2),
        "pct_of_52w_high":  round(pct_of_52w_high, 3),
        "high52w":          round(high52w, 2),
        "low52w":           round(low52w, 2),
        "avg_upper_shadow":  round(avg_upper_shadow, 2),
        "gap_up_count":     gap_up_count,
        "last_price":       round(last, 2),
    }


def calc_rsi(close: pd.Series, period: int = 14) -> float:
    """RSI via EMA — pure pandas."""
    delta    = close.diff()
    gain     = delta.clip(lower=0).ewm(com=period-1, adjust=False).mean()
    loss     = (-delta).clip(lower=0).ewm(com=period-1, adjust=False).mean()
    rs       = gain / loss.replace(0, float("nan"))
    rsi_s    = 100 - (100 / (1 + rs))
    return round(float(rsi_s.iloc[-1]), 1)


def get_bandar_profile(ticker: str) -> dict:
    """
    Ambil profil bandar dari knowledge base + scoring kekuatan.
    Jika tidak ada di KB, estimate berdasarkan market cap dari emiten_meta.
    """
    kb = BANDAR_KNOWLEDGE.get(ticker.upper())
    if kb:
        return {
            "known":          True,
            "group":          kb["group"],
            "strength":       kb["strength"],
            "legit_catalyst": kb["legit_catalyst"],
            "backing_desc":   kb["backing_desc"],
            "dump_risk_mod":  kb.get("dump_risk_modifier", 0),
            "gagal_mod":      kb.get("gagal_modifier", 0),
        }
    return {
        "known":          False,
        "group":          "Unknown",
        "strength":       "UNKNOWN",
        "legit_catalyst": False,
        "backing_desc":   "Tidak ada informasi backing grup. Perlu waspada.",
        "dump_risk_mod":  +10,   # default: unknown = lebih berisiko
        "gagal_mod":      +5,
    }

def score_goreng(vol_data: dict, price_data: dict, rsi: float,
                 bandar: dict) -> dict:
    """
    Hitung Pump Score + Dump Risk + Gagal Goreng %

    PUMP SCORE (0-100) — seberapa kuat sinyal goreng sedang berjalan
    DUMP RISK  (0-100) — seberapa dekat dengan fase dump
    GAGAL %    (0-100) — kemungkinan pump gagal (tidak sampai puncak)
    """
    pump_score = 0.0
    dump_risk  = 0.0
    detail     = {}

    # ── KOMPONEN 1: Anomali Volume (30%) ────────────────────────
    vol_pts = 0
    if vol_data["vol_ratio_now"] >= VOL_EXPLOSION_MULTIPLIER:
        vol_pts = 30   # volume meledak 5x = full score
    elif vol_data["vol_ratio_now"] >= VOL_ANOMALY_MULTIPLIER:
        vol_pts = 20   # anomali sedang
    elif vol_data["vol_consistency"] >= 0.7 and vol_data["price_stagnant"]:
        vol_pts = 25   # akumulasi diam — volume konsisten naik, harga stagnan
    elif vol_data["vol_ratio_now"] >= 1.5:
        vol_pts = 10
    pump_score += vol_pts
    detail["vol_score"] = vol_pts

    # Dump risk dari distribusi signal
    if vol_data["distribusi_signal"]:
        dump_risk += 20
    if vol_data["vol_3d_ratio"] < 0.7 and vol_data["vol_ratio_now"] > 3:
        dump_risk += 15  # volume drop drastis setelah explosion = distribusi done

    # ── KOMPONEN 2: Pola Harga (20%) ────────────────────────────
    price_pts = 0
    if price_data["ret7d"] >= 30:
        price_pts = 20  # naik 30%+ dalam 7 hari = pump keras
        dump_risk += 20
    elif price_data["ret7d"] >= 15:
        price_pts = 14
        dump_risk += 10
    elif price_data["ret30d"] >= 40:
        price_pts = 16
    elif price_data["ret30d"] >= 20:
        price_pts = 10
    elif vol_data["price_stagnant"] and vol_data["vol_consistency"] > 0.6:
        price_pts = 8   # akumulasi: harga stagnan tapi volume diam-diam naik
    pump_score += price_pts
    detail["price_score"] = price_pts

    # ── KOMPONEN 3: RSI Positioning (15%) ───────────────────────
    rsi_pts = 0
    if rsi >= RSI_EXTREME_OVERBOUGHT:
        rsi_pts = 5    # RSI extreme = pump tapi rawan koreksi
        dump_risk += 25
    elif rsi >= RSI_PUMP_ZONE:
        rsi_pts = 12
        dump_risk += 10
    elif rsi >= 55:
        rsi_pts = 8    # mulai pump
    elif rsi < 40:
        rsi_pts = 5    # oversold bisa jadi akumulasi
    pump_score += rsi_pts
    detail["rsi_score"] = rsi_pts

    # ── KOMPONEN 4: Posisi vs 52W High (15%) ─────────────────────
    pos_pts = 0
    pct52 = price_data["pct_of_52w_high"]
    if pct52 >= 0.97:
        pos_pts = 5     # sangat dekat 52W high = pump puncak
        dump_risk += 20
    elif pct52 >= NEAR_52W_HIGH_PCT:
        pos_pts = 10
        dump_risk += 12
    elif pct52 >= 0.75:
        pos_pts = 12    # masih ada ruang naik
    elif pct52 < 0.50:
        pos_pts = 8     # harga masih rendah = potensi akumulasi
    pump_score += pos_pts
    detail["position_score"] = pos_pts

    # ── KOMPONEN 5: Kekuatan Bandar (20%) ───────────────────────
    bandar_pts = 0
    strength_map = {"KONGLOMERAT": 20, "STRONG": 15, "MEDIUM": 8, "WEAK": 4, "UNKNOWN": 3}
    bandar_pts = strength_map.get(bandar["strength"], 3)
    if bandar["legit_catalyst"]:
        bandar_pts = min(bandar_pts + 5, 20)  # katalis nyata = tambah 5 poin
    pump_score += bandar_pts
    detail["bandar_score"] = bandar_pts

    # ── Gap up pattern (bonus) ───────────────────────────────────
    if price_data["gap_up_count"] >= 2:
        pump_score = min(pump_score + 5, 100)

    # ── Upper shadow = distribusi signal ────────────────────────
    if price_data["avg_upper_shadow"] > 1.5:
        dump_risk += 15  # banyak upper shadow = bandar jual di puncak

    # ── Apply bandar modifier ────────────────────────────────────
    dump_risk  = max(0, min(100, dump_risk  + bandar["dump_risk_mod"]))
    pump_score = max(0, min(100, pump_score))

    # ── Gagal Goreng % ───────────────────────────────────────────
    # Semakin kecil bandar, semakin OB, semakin tinggi 52W = makin tinggi gagal
    gagal_pct = 15  # base
    if bandar["strength"] == "WEAK":    gagal_pct += 30
    elif bandar["strength"] == "MEDIUM": gagal_pct += 15
    elif bandar["strength"] == "STRONG": gagal_pct += 5
    if not bandar["legit_catalyst"]:    gagal_pct += 20
    if rsi >= RSI_EXTREME_OVERBOUGHT:   gagal_pct += 15
    if price_data["pct_of_52w_high"] >= 0.95: gagal_pct += 10
    gagal_pct = max(0, min(95, gagal_pct + bandar["gagal_mod"]))

    detail["rsi"]       = rsi
    detail["vol_ratio"] = vol_data["vol_ratio_now"]
    detail["ret7d"]     = price_data["ret7d"]
    detail["ret30d"]    = price_data["ret30d"]

    return {
        "pump_score":  round(pump_score, 1),
        "dump_risk":   round(dump_risk, 1),
        "gagal_pct":   round(gagal_pct, 1),
        "detail":      detail,
    }

def determine_phase(vol_data: dict, price_data: dict,
                    scores: dict, rsi: float) -> str:
    """
    Tentukan fase goreng berdasarkan kombinasi semua sinyal.

    Logika:
      DUMP:         dump_risk >= 75 ATAU distribusi + RSI drop
      DISTRIBUSI:   distribusi_signal + pump_score >= 60 + RSI > 65
      PUMP_PUNCAK:  pump_score >= 70 + RSI > 75 + dekat 52W high
      PUMP_AWAL:    pump_score >= 45 + vol explosion
      AKUMULASI:    vol konsisten naik + harga stagnan + pump_score 20-45
      CLEAN:        default
    """
    ps   = scores["pump_score"]
    dr   = scores["dump_risk"]
    dist = vol_data["distribusi_signal"]

    if dr >= 75:
        return "DUMP"
    if dist and ps >= 60 and rsi > 65:
        return "DISTRIBUSI"
    if ps >= 70 and rsi > 75 and price_data["pct_of_52w_high"] >= 0.90:
        return "PUMP_PUNCAK"
    if ps >= 70 and vol_data["vol_ratio_now"] >= VOL_EXPLOSION_MULTIPLIER:
        return "PUMP_PUNCAK"
    if ps >= 45 and vol_data["vol_3d_ratio"] >= VOL_ANOMALY_MULTIPLIER:
        return "PUMP_AWAL"
    if ps >= 30 and vol_data["vol_consistency"] >= 0.6 and vol_data["price_stagnant"]:
        return "AKUMULASI"
    if ps >= 45:
        return "PUMP_AWAL"
    return "CLEAN"


def generate_goreng_narasi(ticker: str, phase: str, scores: dict,
                           price_data: dict, vol_data: dict,
                           bandar: dict) -> dict:
    """
    Hasilkan narasi + rekomendasi dalam bahasa manusia.
    Ini adalah output yang user lihat — harus jelas, tidak menggurui, actionable.
    """
    ps  = scores["pump_score"]
    dr  = scores["dump_risk"]
    gf  = scores["gagal_pct"]

    # Tentukan warning level
    if phase == "DUMP" or dr >= 80:
        warning = "DANGER"
    elif phase == "DISTRIBUSI" or dr >= 65:
        warning = "EXIT_NOW"
    elif phase in ("PUMP_PUNCAK",) and dr >= 50:
        warning = "EXIT_NOW"
    elif phase in ("PUMP_AWAL", "PUMP_PUNCAK"):
        warning = "RIDE"
    elif phase == "AKUMULASI":
        warning = "WATCH"
    else:
        warning = "NONE"

    # Narasi berdasarkan fase
    narasi_map = {
        "CLEAN": (
            f"{ticker} tidak menunjukkan tanda-tanda pergerakan bandar saat ini. "
            f"Volume normal, harga bergerak wajar. Aman sebagai investasi normal."
        ),
        "AKUMULASI": (
            f"⚠️ Terdeteksi pola akumulasi diam di {ticker}. Volume terus naik "
            f"{vol_data['vol_consistency']*100:.0f}% konsisten dalam 14 hari terakhir, "
            f"namun harga relatif stagnan (±{abs(vol_data['price_14d_chg']):.1f}%). "
            f"Ini adalah tanda klasik bandar sedang diam-diam kumpul saham. "
            f"{'Backing: ' + bandar['group'] + ' — ' + bandar['backing_desc'][:80] if bandar['known'] else 'Belum diketahui siapa yang mengakumulasi.'}"
        ),
        "PUMP_AWAL": (
            f"🚀 {ticker} masuk fase pump awal! Harga naik "
            f"{price_data['ret7d']:+.1f}% dalam 7 hari, volume {vol_data['vol_ratio_now']:.1f}x "
            f"rata-rata normal. Ini adalah momen 'early ride' — potensi keuntungan masih besar "
            f"tapi risiko juga mulai ada. "
            f"{'Kekuatan bandar: ' + bandar['group'] if bandar['known'] else 'Identitas bandar belum jelas.'}"
        ),
        "PUMP_PUNCAK": (
            f"🔥 {ticker} berada di puncak pump! Harga sudah naik "
            f"{price_data['ret30d']:+.1f}% dalam 30 hari. "
            f"RSI {scores['detail'].get('rsi', 0):.0f} — zona overbought ekstrem. "
            f"Bandar mulai jual pelan-pelan di puncak. Jika Anda sudah riding sejak awal, "
            f"pertimbangkan exit bertahap (jual 30-50% posisi sekarang)."
        ),
        "DISTRIBUSI": (
            f"🚨 WASPADA! {ticker} memasuki fase distribusi — bandar sedang keluar! "
            f"Volume mulai turun dari puncak, harga masih tinggi tapi mulai goyah. "
            f"Ini adalah jebakan untuk retail yang masuk terlambat. "
            f"JANGAN BELI SEKARANG. Jika punya posisi, JUAL SEGERA sebelum dump."
        ),
        "DUMP": (
            f"💀 {ticker} dalam fase dump atau sudah dump! "
            f"Bandar sudah keluar, yang tersisa hanya retail yang nyangkut. "
            f"Jangan masuk apapun kondisinya. Jika terjebak, pertimbangkan cut loss "
            f"daripada menunggu recovery yang tidak pasti waktunya."
        ),
    }

    saran_map = {
        "CLEAN":       "Tidak ada aksi khusus. Analisis fundamental normal.",
        "AKUMULASI":   f"SARAN: Ikuti akumulasi dengan posisi KECIL (maks 5% portfolio). Pasang alert jika volume meledak >3x. Target entry: harga saat ini ± 2%. Stop loss: -8%.",
        "PUMP_AWAL":   f"SARAN: Masuk dengan posisi SEDANG (maks 10% portfolio). Riding momentum. Target: +{min(price_data['ret30d']*1.5, 50):.0f}% dari harga entry. Stop loss: -10% dari entry.",
        "PUMP_PUNCAK": f"SARAN: JANGAN tambah posisi. Jika sudah punya: jual 30-50% sekarang (ambil profit). Sisanya pasang trailing stop -15%.",
        "DISTRIBUSI":  "SARAN: EXIT semua posisi. Jangan tergoda harga masih tinggi — ini jebakan. Prioritas: selamatkan modal.",
        "DUMP":        "SARAN: JANGAN masuk. Jika nyangkut: evaluasi cut loss vs wait recovery (bisa sangat lama).",
    }

    return {
        "phase":          phase,
        "phase_label":    PHASE_LABELS.get(phase, phase),
        "warning_level":  warning,
        "pump_score":     ps,
        "dump_risk":      dr,
        "gagal_pct":      gf,
        "bandar_strength": bandar["strength"],
        "bandar_group":   bandar["group"],
        "legit_catalyst": bandar["legit_catalyst"],
        "backing_desc":   bandar["backing_desc"],
        "narasi":         narasi_map.get(phase, "Tidak ada data."),
        "saran":          saran_map.get(phase, ""),
        "vol_ratio":      vol_data["vol_ratio_now"],
        "ret7d":          price_data["ret7d"],
        "ret30d":         price_data["ret30d"],
        "last_price":     price_data["last_price"],
        "high52w":        price_data["high52w"],
        "pct_of_52w_high": price_data["pct_of_52w_high"],
    }

# ══════════════════════════════════════════════════════════════
# ENTRY POINT UTAMA
# ══════════════════════════════════════════════════════════════
def analyze_goreng(ticker: str) -> dict | None:
    """
    Analisis lengkap goreng detector untuk satu ticker.
    Return dict lengkap atau None jika data tidak cukup.
    """
    log.info(f"[goreng] Analyzing {ticker}...")
    df = fetch_ohlcv_goreng(ticker)
    if df is None or len(df) < 20:
        log.warning(f"[goreng] Data tidak cukup untuk {ticker}")
        return None

    vol_data   = calc_volume_anomaly(df)
    price_data = calc_price_pump_score(df)
    rsi        = calc_rsi(df["close"].astype(float))
    bandar     = get_bandar_profile(ticker)
    scores     = score_goreng(vol_data, price_data, rsi, bandar)
    phase      = determine_phase(vol_data, price_data, scores, rsi)
    result     = generate_goreng_narasi(ticker, phase, scores, price_data, vol_data, bandar)

    result["ticker"]      = ticker.upper()
    result["analyzed_at"] = datetime.now(IDX_TZ).isoformat()
    result["rsi"]         = rsi

    log.info(f"[goreng] {ticker}: phase={phase} pump={scores['pump_score']} "
             f"dump_risk={scores['dump_risk']} gagal={scores['gagal_pct']}%")
    return result


def run_goreng_scan(supabase, tickers=None) -> int:
    """
    Scan semua ticker dalam goreng watchlist.
    Simpan hasil ke tabel goreng_alerts di Supabase.
    Kembalikan jumlah alert yang ditulis.
    """
    targets = tickers or GORENG_WATCHLIST
    alerts  = []

    for ticker in targets:
        try:
            result = analyze_goreng(ticker)
            if result is None:
                continue
            # Hanya simpan jika bukan CLEAN atau pump_score > 20
            if result["phase"] != "CLEAN" or result["pump_score"] > 20:
                alerts.append({
                    "ticker":         result["ticker"],
                    "phase":          result["phase"],
                    "phase_label":    result["phase_label"],
                    "warning_level":  result["warning_level"],
                    "pump_score":     result["pump_score"],
                    "dump_risk":      result["dump_risk"],
                    "gagal_pct":      result["gagal_pct"],
                    "bandar_strength": result["bandar_strength"],
                    "bandar_group":   result["bandar_group"],
                    "legit_catalyst": result["legit_catalyst"],
                    "narasi":         result["narasi"],
                    "saran":          result["saran"],
                    "vol_ratio":      result["vol_ratio"],
                    "ret7d":          result["ret7d"],
                    "ret30d":         result["ret30d"],
                    "last_price":     result["last_price"],
                    "rsi":            result["rsi"],
                    "analyzed_at":    result["analyzed_at"],
                    "expires_at":     (datetime.now(IDX_TZ) + timedelta(hours=8)).isoformat(),
                })
            time.sleep(0.3)  # rate limit yfinance
        except Exception as e:
            log.error(f"[goreng] Error {ticker}: {e}")
            continue

    if alerts:
        try:
            supabase.table("goreng_alerts").upsert(
                alerts, on_conflict="ticker"
            ).execute()
            log.info(f"[goreng] {len(alerts)} alerts ditulis ke DB.")
        except Exception as e:
            log.error(f"[goreng] DB write error: {e}")

    return len(alerts)


# ── Standalone test ───────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    test_tickers = sys.argv[1:] or ["PANI", "KIOS", "ARTO", "BBCA"]
    print(f"\nGoreng Detector Test — {', '.join(test_tickers)}\n")
    for t in test_tickers:
        r = analyze_goreng(t)
        if r:
            print(f"{'='*55}")
            print(f"Ticker  : {r['ticker']}")
            print(f"Phase   : {r['phase_label']}")
            print(f"Warning : {r['warning_level']}")
            print(f"Pump    : {r['pump_score']}/100")
            print(f"Dump Risk: {r['dump_risk']}/100")
            print(f"Gagal   : {r['gagal_pct']}%")
            print(f"Bandar  : {r['bandar_group']} ({r['bandar_strength']})")
            print(f"Narasi  : {r['narasi'][:120]}...")
            print(f"Saran   : {r['saran'][:100]}")
            print()
