"""
phase_detector.py — Cacing/Naga Phase Detector
================================================
Deteksi fase akumulasi (cacing) vs distribusi (naga) vs dump
berdasarkan volume pattern, RSI, dan price momentum.

Filosofi:
- Fase AKUMULASI = safe zone untuk BELI (confidence normal)
- Fase DISTRIBUSI = hard cap confidence 60% (tidak lolos NFR-008)
- Fase DUMP = hard cap confidence 20% + cutloss alert

Integrasi: dipanggil oleh signal_engine.py sebelum scoring final
"""

import pandas as pd
import numpy as np
from dataclasses import dataclass
from typing import Optional


@dataclass
class PhaseResult:
    phase: str           # AKUMULASI | DISTRIBUSI | DUMP | UNKNOWN
    cacing_score: float  # 0.0–1.0, kekuatan pola akumulasi
    naga_score: float    # 0.0–1.0, kekuatan pola distribusi
    confidence_cap: int  # Hard cap confidence (100 = no cap)
    reasoning: str       # Narasi singkat untuk Groq prompt
    alert_priority: str  # NORMAL | HIGH | CRITICAL


# ── Konstanta threshold ────────────────────────────────────────────
VOL_CV_THRESHOLD       = 0.35   # stddev/mean volume < ini = stabil (cacing)
VOL_SPIKE_THRESHOLD    = 3.0    # volume > 3x mean = spike (naga)
VOL_DUMP_THRESHOLD     = 0.20   # volume < 20% mean = dump
RSI_CACING_MAX         = 60     # RSI di bawah ini = zona aman akumulasi
RSI_NAGA_MIN           = 80     # RSI di atas ini = zona distribusi
RSI_DUMP_MAX           = 35     # RSI di bawah ini + volume drop = dump
PRICE_CHANGE_CACING_LO = 0.08   # min kenaikan 30hr untuk cacing (8%)
PRICE_CHANGE_CACING_HI = 0.60   # max kenaikan 30hr untuk cacing (60%)
CONFIDENCE_CAP_DISTRIBUSI = 60  # Hard cap fase naga
CONFIDENCE_CAP_DUMP       = 20  # Hard cap fase dump

def compute_vol_metrics(vol_series: pd.Series) -> dict:
    """Hitung metrik volume dari series 30-90 hari."""
    if len(vol_series) < 10:
        return {"cv": 1.0, "spike": 1.0, "trend": 0.0, "mean": 0.0}

    mean   = vol_series.mean()
    stddev = vol_series.std()
    latest = vol_series.iloc[-1]
    # Coefficient of variation: rendah = stabil = cacing
    cv     = stddev / mean if mean > 0 else 1.0
    # Spike ratio: tinggi = naga/dump
    spike  = latest / mean if mean > 0 else 1.0
    # Volume trend (slope 14 hari terakhir, dinormalisasi)
    recent = vol_series.iloc[-14:] if len(vol_series) >= 14 else vol_series
    x      = np.arange(len(recent))
    slope  = np.polyfit(x, recent.values, 1)[0] if len(recent) > 2 else 0
    trend  = slope / mean if mean > 0 else 0

    return {"cv": cv, "spike": spike, "trend": trend, "mean": mean}


def cacing_score_calc(vol_cv: float, rsi: float, price_chg: float) -> float:
    """
    Hitung skor kekuatan fase akumulasi (0.0–1.0).
    Semakin tinggi = semakin kuat sinyal cacing.
    """
    score = 0.0
    # Volume stabil: CV rendah bagus
    if vol_cv < 0.20:
        score += 0.40
    elif vol_cv < 0.35:
        score += 0.25
    elif vol_cv < 0.50:
        score += 0.10

    # RSI di zona aman
    if rsi < 45:
        score += 0.30
    elif rsi < 60:
        score += 0.20
    elif rsi < 70:
        score += 0.05

    # Kenaikan harga moderat (bukan pump)
    if PRICE_CHANGE_CACING_LO < price_chg < 0.30:
        score += 0.30
    elif price_chg < PRICE_CHANGE_CACING_HI:
        score += 0.15

    return min(score, 1.0)


def naga_score_calc(vol_spike: float, rsi: float, upper_shadow_pct: float,
                    social_mentions: int) -> float:
    """
    Hitung skor kekuatan fase distribusi (0.0–1.0).
    Semakin tinggi = semakin berbahaya.
    """
    score = 0.0
    if vol_spike > 5.0:
        score += 0.35
    elif vol_spike > 3.0:
        score += 0.25
    elif vol_spike > 2.0:
        score += 0.10

    if rsi > 85:
        score += 0.30
    elif rsi > 80:
        score += 0.20
    elif rsi > 75:
        score += 0.10

    if upper_shadow_pct > 0.15:  # upper shadow >15% body
        score += 0.20
    elif upper_shadow_pct > 0.10:
        score += 0.10

    if social_mentions > 10000:
        score += 0.15
    elif social_mentions > 5000:
        score += 0.10

    return min(score, 1.0)

def classify_phase(
    vol_series: pd.Series,
    rsi_latest: float,
    price_change_30d: float,
    upper_shadow_pct: float = 0.0,
    social_mentions: int = 0,
    ticker: str = ""
) -> PhaseResult:
    """
    Entry point utama: klasifikasi fase saham.

    Args:
        vol_series:       Series volume 30–90 hari (yfinance)
        rsi_latest:       RSI terbaru (pandas-ta, window=14)
        price_change_30d: Return 30 hari, misal 0.25 = +25%
        upper_shadow_pct: Upper shadow sebagai % dari body candle
        social_mentions:  Jumlah mention sosmed/hari (0 jika tidak ada data)
        ticker:           Kode saham untuk logging

    Returns:
        PhaseResult dataclass
    """
    vm = compute_vol_metrics(vol_series)

    # ── FASE DUMP ──────────────────────────────────────────────────
    if vm["spike"] < VOL_DUMP_THRESHOLD and price_change_30d < -0.10:
        return PhaseResult(
            phase="DUMP",
            cacing_score=0.0,
            naga_score=0.0,
            confidence_cap=CONFIDENCE_CAP_DUMP,
            reasoning=(
                f"Volume {ticker} turun drastis ({vm['spike']:.1f}x rata-rata) "
                f"disertai harga -{ abs(price_change_30d)*100:.0f}% dalam 30 hari. "
                "Potensi distribusi selesai atau likuiditas sangat tipis."
            ),
            alert_priority="CRITICAL"
        )

    # ── FASE DISTRIBUSI (NAGA) ─────────────────────────────────────
    is_naga_vol = vm["spike"] >= VOL_SPIKE_THRESHOLD
    is_naga_rsi = rsi_latest >= RSI_NAGA_MIN
    ns = naga_score_calc(vm["spike"], rsi_latest, upper_shadow_pct, social_mentions)

    if is_naga_vol and is_naga_rsi:
        fomo_note = ""
        if social_mentions > 5000:
            fomo_note = (
                f" Mention sosmed tinggi ({social_mentions:,}/hari) — "
                "retail FOMO kemungkinan sudah masuk."
            )
        return PhaseResult(
            phase="DISTRIBUSI",
            cacing_score=0.0,
            naga_score=ns,
            confidence_cap=CONFIDENCE_CAP_DISTRIBUSI,
            reasoning=(
                f"{ticker} dalam fase distribusi: volume {vm['spike']:.1f}x "
                f"rata-rata, RSI {rsi_latest:.0f}. Saham sudah naik signifikan "
                f"dan bandar berpotensi mulai melepas posisi.{fomo_note}"
            ),
            alert_priority="HIGH"
        )

    # Distribusi ringan (salah satu sinyal saja)
    if ns > 0.55:
        return PhaseResult(
            phase="DISTRIBUSI",
            cacing_score=0.0,
            naga_score=ns,
            confidence_cap=CONFIDENCE_CAP_DISTRIBUSI,
            reasoning=(
                f"{ticker} menunjukkan tanda distribusi awal "
                f"(naga_score={ns:.2f}). Waspada entry baru."
            ),
            alert_priority="HIGH"
        )

    # ── FASE AKUMULASI (CACING) ────────────────────────────────────
    is_cacing_vol  = vm["cv"] < VOL_CV_THRESHOLD
    is_cacing_rsi  = rsi_latest < RSI_CACING_MAX
    is_cacing_chg  = PRICE_CHANGE_CACING_LO < price_change_30d < PRICE_CHANGE_CACING_HI
    cs = cacing_score_calc(vm["cv"], rsi_latest, price_change_30d)

    if is_cacing_vol and is_cacing_rsi and is_cacing_chg:
        return PhaseResult(
            phase="AKUMULASI",
            cacing_score=cs,
            naga_score=0.0,
            confidence_cap=100,   # no cap
            reasoning=(
                f"{ticker} dalam pola akumulasi: volume stabil "
                f"(CV={vm['cv']:.2f}), RSI {rsi_latest:.0f} zona aman, "
                f"harga naik {price_change_30d*100:.0f}% halus dalam 30 hari."
            ),
            alert_priority="NORMAL"
        )

    # Akumulasi parsial
    if cs > 0.50:
        return PhaseResult(
            phase="AKUMULASI",
            cacing_score=cs,
            naga_score=0.0,
            confidence_cap=100,
            reasoning=(
                f"{ticker} menunjukkan tanda akumulasi moderat "
                f"(cacing_score={cs:.2f})."
            ),
            alert_priority="NORMAL"
        )

    # ── UNKNOWN ───────────────────────────────────────────────────
    return PhaseResult(
        phase="UNKNOWN",
        cacing_score=cs,
        naga_score=ns,
        confidence_cap=100,
        reasoning=f"{ticker} tidak menunjukkan pola fase yang jelas.",
        alert_priority="NORMAL"
    )


def apply_phase_to_confidence(base_confidence: float, result: PhaseResult,
                               fomo_penalty: int = 0) -> int:
    """
    Terapkan hard cap dan penalty ke confidence score dari signal_engine.

    Args:
        base_confidence: Skor 0–100 dari signal_engine scoring
        result:          PhaseResult dari classify_phase()
        fomo_penalty:    Poin dikurangi karena viral sosmed (default 0)

    Returns:
        Final confidence (int), sudah di-cap dan di-penalize
    """
    score = base_confidence - fomo_penalty
    score = max(0, min(score, result.confidence_cap))
    return int(round(score))


# ── Quick test ─────────────────────────────────────────────────────
if __name__ == "__main__":
    import pandas as pd, numpy as np

    # Simulasi BBCA fase akumulasi: volume stabil 60-80jt, RSI 55
    vol_cacing = pd.Series(
        np.random.normal(70_000_000, 8_000_000, 60).clip(min=10_000_000)
    )
    r1 = classify_phase(vol_cacing, rsi_latest=55, price_change_30d=0.18,
                         ticker="BBCA")
    print(f"BBCA → {r1.phase} | cacing={r1.cacing_score:.2f} | cap={r1.confidence_cap}")
    print(f"  Reason: {r1.reasoning}\n")

    # Simulasi KIOS fase distribusi: volume spike 5x, RSI 87
    vol_naga = pd.Series(
        [30_000_000]*50 + [180_000_000, 200_000_000, 150_000_000,
                           220_000_000, 250_000_000]
    )
    r2 = classify_phase(vol_naga, rsi_latest=87, price_change_30d=1.8,
                         upper_shadow_pct=0.18, social_mentions=12000,
                         ticker="KIOS")
    print(f"KIOS → {r2.phase} | naga={r2.naga_score:.2f} | cap={r2.confidence_cap}")
    print(f"  Reason: {r2.reasoning}\n")

    # Test confidence cap
    final_bbca = apply_phase_to_confidence(80, r1)
    final_kios = apply_phase_to_confidence(80, r2, fomo_penalty=15)
    print(f"Confidence BBCA: 80 → {final_bbca}  (no cap)")
    print(f"Confidence KIOS: 80 → {final_kios}  (cap {r2.confidence_cap}, fomo -15)")
