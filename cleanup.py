"""
cleanup.py — SmartTrading Daily Cleanup & Signal Evaluator
===========================================================
Dipanggil oleh: GitHub Actions cleanup.yml (setiap hari 16:00 WIB)

Tugas:
  1. Hapus news_cache expired
  2. Evaluasi signal expired -> WIN/LOSS/NEUTRAL -> tulis signal_history
  3. Prune signals lama > 7 hari
"""

import os
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import yfinance as yf
from supabase import create_client, Client

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("cleanup")

SUPABASE_URL  = os.environ["SUPABASE_URL"]
SUPABASE_KEY  = os.environ["SUPABASE_SERVICE_KEY"]
DRY_RUN       = os.environ.get("DRY_RUN", "false").lower() == "true"
IDX_TZ        = ZoneInfo("Asia/Jakarta")
SIGNAL_RETAIN = 7    # hari — hapus signal lebih lama dari ini

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def cleanup_news_cache():
    """Hapus news_cache yang sudah melewati expires_at."""
    log.info("Task 1: Cleanup news_cache expired...")
    if DRY_RUN:
        count = supabase.table("news_cache").select("id", count="exact") \
            .lt("expires_at", datetime.now(IDX_TZ).isoformat()).execute()
        log.info(f"  [DRY RUN] Akan hapus {count.count} baris news_cache")
        return
    result = supabase.table("news_cache") \
        .delete().lt("expires_at", datetime.now(IDX_TZ).isoformat()).execute()
    log.info(f"  Dihapus: {len(result.data)} baris news_cache")

def evaluate_expired_signals():
    """
    Ambil signals yang sudah expires_at tapi belum dievaluasi.
    Bandingkan harga saat signal dibuat vs harga sekarang.
    Tulis hasil ke signal_history.
    """
    log.info("Task 2: Evaluasi signal expired...")
    now = datetime.now(IDX_TZ).isoformat()

    # Ambil signals expired yang belum ada di signal_history
    expired = supabase.table("signals") \
        .select("id, ticker, signal_type, confidence, price_at_signal, created_at") \
        .lt("expires_at", now).execute()

    # Ambil signal_id yang sudah di-evaluate
    existing_ids = {
        row["signal_id"]
        for row in supabase.table("signal_history").select("signal_id").execute().data
    }

    to_evaluate = [s for s in expired.data if s["id"] not in existing_ids]
    log.info(f"  {len(to_evaluate)} signal perlu dievaluasi")

    for sig in to_evaluate:
        ticker   = sig["ticker"]
        buy_px   = sig["price_at_signal"]
        sig_type = sig["signal_type"]

        try:
            df = yf.download(f"{ticker}.JK", period="2d", interval="1d", progress=False, auto_adjust=True)
            if df.empty:
                outcome, pct_chg, current_px = "NEUTRAL", 0.0, buy_px
            else:
                current_px = float(df["Close"].iloc[-1])
                pct_chg    = round((current_px - buy_px) / buy_px * 100, 2)
                if sig_type == "BUY":
                    outcome = "WIN" if pct_chg > 0.5 else ("LOSS" if pct_chg < -0.5 else "NEUTRAL")
                elif sig_type == "SELL":
                    outcome = "WIN" if pct_chg < -0.5 else ("LOSS" if pct_chg > 0.5 else "NEUTRAL")
                else:
                    outcome = "NEUTRAL"
        except Exception as e:
            log.warning(f"  Gagal fetch harga {ticker}: {e}")
            outcome, pct_chg, current_px = "NEUTRAL", 0.0, buy_px

        if not DRY_RUN:
            supabase.table("signal_history").insert({
                "signal_id": sig["id"], "ticker": ticker,
                "signal_type": sig_type, "confidence": sig["confidence"],
                "price_at_signal": buy_px, "price_at_expire": current_px,
                "outcome": outcome, "pct_change": pct_chg,
                "evaluated_at": now,
            }).execute()
        log.info(f"  {ticker} {sig_type} -> {outcome} ({pct_chg:+.1f}%)")


def prune_old_signals():
    """Hapus signals lebih dari SIGNAL_RETAIN hari."""
    log.info(f"Task 3: Prune signals > {SIGNAL_RETAIN} hari...")
    cutoff = (datetime.now(IDX_TZ) - timedelta(days=SIGNAL_RETAIN)).isoformat()
    if DRY_RUN:
        c = supabase.table("signals").select("id", count="exact").lt("created_at", cutoff).execute()
        log.info(f"  [DRY RUN] Akan hapus {c.count} signals lama")
        return
    result = supabase.table("signals").delete().lt("created_at", cutoff).execute()
    log.info(f"  Dihapus: {len(result.data)} signals lama")


if __name__ == "__main__":
    log.info(f"=== Cleanup START {'[DRY RUN]' if DRY_RUN else ''} ===")
    cleanup_news_cache()
    evaluate_expired_signals()
    prune_old_signals()
    log.info("=== Cleanup DONE ===")
