"""
broker_flow.py — Broker Concentration Detector (IDX)
=====================================================
Monitor konsentrasi broker beli/jual untuk deteksi akumulasi bandar.

Sinyal utama:
  - 1-2 broker dominan beli >60% volume negosiasi = akumulasi
  - Block deal besar dari 1 broker di sisi jual = distribusi

Sumber data:
  - IDX Broker Summary (scraped atau manual upload)
  - Format: CSV dengan kolom broker_code, side, lot_volume
  - Path default: C:\FOLDER4CLAUDE\smarttrading\data\broker_summary\

Integrasi: dipanggil oleh signal_engine.py sebagai data enrichment
"""

import os, json
import pandas as pd
from pathlib import Path
from dataclasses import dataclass
from typing import Optional


@dataclass
class BrokerFlowResult:
    ticker: str
    date: str
    is_concentrated_buy: bool    # True = 1-2 broker dominan di sisi beli
    is_block_sell: bool          # True = block deal besar di sisi jual
    top_buy_broker: str          # Kode broker dengan volume beli terbesar
    top_buy_pct: float           # % dari total volume negosiasi
    top_sell_broker: str
    top_sell_pct: float
    buy_concentration: float     # Herfindahl index sisi beli (0-1)
    sell_concentration: float    # Herfindahl index sisi jual
    signal: str                  # AKUMULASI | DISTRIBUSI | NEUTRAL
    confidence_boost: int        # +10 untuk akumulasi, -10 untuk distribusi


CONCENTRATION_THRESHOLD  = 0.60   # 1-2 broker >60% = concentrated
BLOCK_SELL_THRESHOLD     = 0.45   # 1 broker >45% jual = block deal (lebih konservatif)
HHI_CONCENTRATED         = 0.40   # Herfindahl Index > ini = concentrated


def compute_herfindahl(shares: list[float]) -> float:
    """
    Herfindahl-Hirschman Index: ukuran konsentrasi.
    0 = perfectly distributed, 1 = 1 broker total.
    """
    total = sum(shares)
    if total == 0:
        return 0.0
    normalized = [s / total for s in shares]
    return sum(x**2 for x in normalized)


def analyze_broker_flow(df: pd.DataFrame, ticker: str,
                         date: str = "") -> BrokerFlowResult:
    """
    Analisis broker flow dari DataFrame broker summary.

    Args:
        df:     DataFrame dengan kolom: broker_code, side, lot_volume
                side: 'BUY' atau 'SELL'
        ticker: Kode saham
        date:   Tanggal data (YYYY-MM-DD)

    Returns:
        BrokerFlowResult
    """
    buy_df  = df[df["side"].str.upper() == "BUY"].copy()
    sell_df = df[df["side"].str.upper() == "SELL"].copy()

    # ── Sisi Beli ──────────────────────────────────────────────────
    total_buy = buy_df["lot_volume"].sum()
    if total_buy > 0:
        buy_df["pct"] = buy_df["lot_volume"] / total_buy
        buy_df = buy_df.sort_values("lot_volume", ascending=False)
        top_buy = buy_df.iloc[0]
        top2_buy_pct = buy_df.head(2)["pct"].sum()
        buy_hhi = compute_herfindahl(buy_df["lot_volume"].tolist())
    else:
        top_buy = pd.Series({"broker_code": "N/A", "pct": 0.0})
        top2_buy_pct = 0.0
        buy_hhi = 0.0

    # ── Sisi Jual ──────────────────────────────────────────────────
    total_sell = sell_df["lot_volume"].sum()
    if total_sell > 0:
        sell_df["pct"] = sell_df["lot_volume"] / total_sell
        sell_df = sell_df.sort_values("lot_volume", ascending=False)
        top_sell = sell_df.iloc[0]
        top_sell_pct = float(top_sell["pct"])
        sell_hhi = compute_herfindahl(sell_df["lot_volume"].tolist())
    else:
        top_sell = pd.Series({"broker_code": "N/A", "pct": 0.0})
        top_sell_pct = 0.0
        sell_hhi = 0.0

    # ── Klasifikasi ────────────────────────────────────────────────
    is_conc_buy  = (top2_buy_pct  >= CONCENTRATION_THRESHOLD or
                    buy_hhi >= HHI_CONCENTRATED)
    is_block_sell = top_sell_pct >= BLOCK_SELL_THRESHOLD

    if is_conc_buy and not is_block_sell:
        signal = "AKUMULASI"
        conf_boost = +10
    elif is_block_sell and not is_conc_buy:
        signal = "DISTRIBUSI"
        conf_boost = -10
    elif is_conc_buy and is_block_sell:
        # Beli terkonsentrasi tapi ada block sell juga — netral/waspada
        signal = "MIXED"
        conf_boost = -5
    else:
        signal = "NEUTRAL"
        conf_boost = 0

    return BrokerFlowResult(
        ticker=ticker,
        date=date or pd.Timestamp.now().strftime("%Y-%m-%d"),
        is_concentrated_buy=is_conc_buy,
        is_block_sell=is_block_sell,
        top_buy_broker=str(top_buy.get("broker_code", "N/A")),
        top_buy_pct=float(top_buy.get("pct", 0.0)),
        top_sell_broker=str(top_sell.get("broker_code", "N/A")),
        top_sell_pct=top_sell_pct,
        buy_concentration=buy_hhi,
        sell_concentration=sell_hhi,
        signal=signal,
        confidence_boost=conf_boost,
    )


def load_broker_csv(ticker: str, date: str,
                    data_dir: str = r"C:\FOLDER4CLAUDE\smarttrading\data\broker_summary"
                    ) -> Optional[pd.DataFrame]:
    """
    Load broker summary CSV untuk ticker + tanggal tertentu.
    Filename format: BBCA_20260403.csv
    """
    date_fmt = date.replace("-", "")
    fpath = Path(data_dir) / f"{ticker}_{date_fmt}.csv"
    if not fpath.exists():
        return None
    try:
        df = pd.read_csv(fpath)
        required = {"broker_code", "side", "lot_volume"}
        if not required.issubset(df.columns):
            print(f"[WARN] {fpath}: kolom tidak lengkap")
            return None
        return df
    except Exception as e:
        print(f"[WARN] Gagal load {fpath}: {e}")
        return None


def write_flow_to_db(result: BrokerFlowResult, supabase_client) -> bool:
    """Simpan hasil analisis ke tabel broker_flow di Supabase."""
    row = {
        "ticker":              result.ticker,
        "date":                result.date,
        "is_concentrated_buy": result.is_concentrated_buy,
        "is_block_sell":       result.is_block_sell,
        "top_buy_broker":      result.top_buy_broker,
        "top_buy_pct":         round(result.top_buy_pct, 4),
        "top_sell_broker":     result.top_sell_broker,
        "top_sell_pct":        round(result.top_sell_pct, 4),
        "buy_concentration":   round(result.buy_concentration, 4),
        "sell_concentration":  round(result.sell_concentration, 4),
        "signal":              result.signal,
        "confidence_boost":    result.confidence_boost,
    }
    try:
        supabase_client.table("broker_flow").upsert(
            row, on_conflict="ticker,date"
        ).execute()
        return True
    except Exception as e:
        print(f"[WARN] broker_flow write error: {e}")
        return False


# ── Quick test ──────────────────────────────────────────────────────
if __name__ == "__main__":
    # Simulasi data broker BBCA (akumulasi: BK dominan 65% beli)
    data_bbca = pd.DataFrame([
        {"broker_code": "BK",  "side": "BUY",  "lot_volume": 4_500_000},
        {"broker_code": "YP",  "side": "BUY",  "lot_volume": 800_000},
        {"broker_code": "AK",  "side": "BUY",  "lot_volume": 600_000},
        {"broker_code": "ZP",  "side": "BUY",  "lot_volume": 100_000},
        {"broker_code": "BK",  "side": "SELL", "lot_volume": 200_000},
        {"broker_code": "YP",  "side": "SELL", "lot_volume": 1_500_000},
        {"broker_code": "DX",  "side": "SELL", "lot_volume": 900_000},
        {"broker_code": "CC",  "side": "SELL", "lot_volume": 400_000},
    ])
    r1 = analyze_broker_flow(data_bbca, "BBCA", "2026-04-03")
    print(f"BBCA → {r1.signal}")
    print(f"  Top buy : {r1.top_buy_broker} ({r1.top_buy_pct*100:.0f}%)")
    print(f"  Top sell: {r1.top_sell_broker} ({r1.top_sell_pct*100:.0f}%)")
    print(f"  HHI buy={r1.buy_concentration:.2f} | conf_boost={r1.confidence_boost:+d}")

    # Simulasi KIOS fase distribusi (block sell DM 45%)
    data_kios = pd.DataFrame([
        {"broker_code": "YP",  "side": "BUY",  "lot_volume": 2_000_000},
        {"broker_code": "AK",  "side": "BUY",  "lot_volume": 1_800_000},
        {"broker_code": "ZP",  "side": "BUY",  "lot_volume": 1_200_000},
        {"broker_code": "DM",  "side": "SELL", "lot_volume": 8_000_000},  # block sell
        {"broker_code": "YP",  "side": "SELL", "lot_volume": 2_000_000},
        {"broker_code": "CC",  "side": "SELL", "lot_volume": 500_000},
    ])
    r2 = analyze_broker_flow(data_kios, "KIOS", "2026-04-03")
    print(f"\nKIOS → {r2.signal}")
    print(f"  Top buy : {r2.top_buy_broker} ({r2.top_buy_pct*100:.0f}%)")
    print(f"  Top sell: {r2.top_sell_broker} ({r2.top_sell_pct*100:.0f}%)")
    print(f"  Block sell? {r2.is_block_sell} | conf_boost={r2.confidence_boost:+d}")
