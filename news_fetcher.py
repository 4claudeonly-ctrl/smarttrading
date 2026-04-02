"""
news_fetcher.py — SmartTrading News Cache Pipeline
====================================================
Arsitektur  : Zero-Cost (Google News RSS + Groq API + Supabase)
Dijadwalkan : GitHub Actions cron */30 market hours (WIB 09:00-15:30)
Output      : INSERT ke tabel `news_cache` di Supabase
Versi       : 1.0 | 01 Apr 2026

Pipeline:
  1. Ambil daftar ticker LQ45 dari Supabase (market_cap_tier = LQ45)
  2. Fetch Google News RSS per ticker (query: "BBCA saham" dst)
  3. Fetch headline global IDX/IHSG (query: "IHSG bursa saham Indonesia")
  4. Deduplikasi berdasarkan URL
  5. Groq LLM: klasifikasi sentimen + skor relevansi (batch)
  6. INSERT ke news_cache, skip duplikat (upsert by url)
  7. Log stats
"""

import os
import json
import time
import hashlib
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
from urllib.parse import quote_plus

import requests
from supabase import create_client, Client

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("news_fetcher")

# ══════════════════════════════════════════════════════════════════════════════
# KONFIGURASI
# ══════════════════════════════════════════════════════════════════════════════
SUPABASE_URL      = os.environ["SUPABASE_URL"]
SUPABASE_KEY      = os.environ["SUPABASE_SERVICE_KEY"]
GROQ_API_KEY      = os.environ["GROQ_API_KEY"]
GROQ_MODEL        = "llama-3.3-70b-versatile"
GROQ_API_URL      = "https://api.groq.com/openai/v1/chat/completions"

IDX_TZ            = ZoneInfo("Asia/Jakarta")
NEWS_TTL_HOURS    = 24            # news_cache.expires_at
MAX_TICKERS       = 45            # LQ45 — tidak perlu 900 emiten untuk berita
MAX_NEWS_PER_FEED = 8             # ambil max 8 artikel per ticker
GROQ_BATCH_SIZE   = 10           # analisis sentimen per batch Groq call
REQUEST_TIMEOUT   = 12            # detik timeout HTTP
RATE_LIMIT_SLEEP  = 0.3          # jeda antar RSS request

# Ticker override via env (untuk manual trigger workflow_dispatch)
TICKER_OVERRIDE   = os.environ.get("TICKER_OVERRIDE", "").strip()

# ── Supabase client ───────────────────────────────────────────────────────────
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ══════════════════════════════════════════════════════════════════════════════
# UTILITAS
# ══════════════════════════════════════════════════════════════════════════════

def is_market_hours() -> bool:
    """Cek apakah saat ini jam market BEI (Senin-Jumat 09:00-15:45 WIB)."""
    now = datetime.now(IDX_TZ)
    if now.weekday() >= 5:
        return False
    open_t  = now.replace(hour=9,  minute=0,  second=0, microsecond=0)
    close_t = now.replace(hour=15, minute=45, second=0, microsecond=0)
    return open_t <= now <= close_t


def get_lq45_tickers() -> list[str]:
    """Ambil ticker LQ45 dari Supabase. Fallback ke hardcoded list jika gagal."""
    try:
        resp = (
            supabase.table("emiten_meta")
            .select("ticker")
            .eq("is_active", True)
            .eq("market_cap_tier", "LQ45")
            .limit(MAX_TICKERS)
            .execute()
        )
        tickers = [row["ticker"] for row in resp.data]
        if tickers:
            log.info(f"Ticker LQ45 dari Supabase: {len(tickers)} emiten")
            return tickers
    except Exception as e:
        log.warning(f"Gagal fetch dari Supabase: {e} — pakai fallback list")

    # Hardcoded fallback: 20 saham bluechip IDX paling aktif
    return [
        "BBCA","BBRI","BMRI","BBNI","TLKM","ASII","UNVR","ICBP",
        "KLBF","HMSP","INDF","SMGR","ANTM","PTBA","ADRO",
        "PGAS","JSMR","MIKA","SIDO","GOTO",
    ]


def build_gnews_url(query: str) -> str:
    """
    Bangun URL Google News RSS.
    Format: https://news.google.com/rss/search?q=QUERY&hl=id&gl=ID&ceid=ID:id
    """
    encoded = quote_plus(query)
    return (
        f"https://news.google.com/rss/search"
        f"?q={encoded}&hl=id&gl=ID&ceid=ID:id"
    )


def url_hash(url: str) -> str:
    """Buat hash pendek dari URL sebagai deduplikasi key."""
    return hashlib.md5(url.encode()).hexdigest()[:16]


# ══════════════════════════════════════════════════════════════════════════════
# RSS FETCHER
# ══════════════════════════════════════════════════════════════════════════════

def parse_rss_date(date_str: str | None) -> datetime:
    """Parse RFC 2822 date dari RSS ke datetime aware (UTC)."""
    if not date_str:
        return datetime.now(timezone.utc)
    try:
        return parsedate_to_datetime(date_str)
    except Exception:
        return datetime.now(timezone.utc)


def fetch_rss_articles(query: str, ticker: str | None = None) -> list[dict]:
    """
    Fetch dan parse Google News RSS untuk satu query.
    Return list of raw article dicts.
    """
    url = build_gnews_url(query)
    articles = []
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; SmartTradingBot/1.0; "
            "+https://github.com/smarttrading-idx)"
        )
    }
    try:
        resp = requests.get(url, headers=headers, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        channel = root.find("channel")
        if channel is None:
            return []

        items = channel.findall("item")[:MAX_NEWS_PER_FEED]
        for item in items:
            title_el  = item.find("title")
            link_el   = item.find("link")
            pubdate_el = item.find("pubDate")
            source_el  = item.find("source")

            title = title_el.text.strip() if title_el is not None and title_el.text else ""
            link  = link_el.text.strip()  if link_el  is not None and link_el.text  else ""

            if not title or not link:
                # Fallback ke <guid> jika <link> kosong (perilaku Google News RSS)
                guid_el = item.find("guid")
                if not link and guid_el is not None and guid_el.text:
                    link = guid_el.text.strip()
            if not title or not link:
                continue

            published_at = parse_rss_date(
                pubdate_el.text if pubdate_el is not None else None
            )
            source_name = (
                source_el.text.strip()
                if source_el is not None and source_el.text
                else "Google News"
            )

            articles.append({
                "ticker":       ticker,
                "title":        title,
                "source":       source_name,
                "url":          link,
                "url_hash":     url_hash(link),
                "published_at": published_at,
                "sentiment":    None,   # diisi oleh Groq batch
                "relevance":    None,
            })

        log.info(f"  RSS [{query[:40]}]: {len(articles)} artikel")
    except Exception as e:
        log.warning(f"  Gagal fetch RSS untuk '{query}': {e}")

    return articles


# ══════════════════════════════════════════════════════════════════════════════
# GROQ SENTIMENT ANALYZER — Batch processing
# ══════════════════════════════════════════════════════════════════════════════

def analyze_sentiment_batch(articles: list[dict]) -> list[dict]:
    """
    Kirim batch artikel ke Groq untuk klasifikasi sentimen + relevansi.
    Return articles yang sama dengan field sentiment + relevance diisi.

    Groq response format (JSON array):
    [{"index": 0, "sentiment": "POSITIVE", "relevance": 0.85}, ...]
    """
    if not articles:
        return articles

    # Bangun prompt batch
    items_text = "\n".join(
        f'{i}. [{a["ticker"] or "GLOBAL"}] {a["title"]}'
        for i, a in enumerate(articles)
    )

    prompt = f"""Kamu adalah analis sentimen berita pasar saham Indonesia.

Klasifikasikan setiap judul berita berikut:
- sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" (dari perspektif investor saham Indonesia)
- relevance: 0.0 - 1.0 (seberapa relevan untuk pengambilan keputusan investasi saham)

Daftar berita:
{items_text}

PENTING:
- Respond HANYA dengan JSON array, tanpa penjelasan, tanpa markdown
- Format: [{{"index": 0, "sentiment": "POSITIVE", "relevance": 0.85}}, ...]
- Jumlah item harus sama persis dengan input ({len(articles)} item)"""

    try:
        headers = {
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1200,
            "temperature": 0.1,   # deterministik untuk klasifikasi
        }
        resp = requests.post(GROQ_API_URL, headers=headers, json=payload, timeout=20)
        resp.raise_for_status()

        raw_text = resp.json()["choices"][0]["message"]["content"].strip()
        # Bersihkan jika ada markdown fence
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```")[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
        raw_text = raw_text.strip()

        results = json.loads(raw_text)
        for r in results:
            idx = r.get("index")
            if idx is not None and 0 <= idx < len(articles):
                articles[idx]["sentiment"] = r.get("sentiment", "NEUTRAL")
                articles[idx]["relevance"] = float(r.get("relevance", 0.5))

        log.info(f"  Groq sentimen: {len(results)} artikel dianalisis")

    except json.JSONDecodeError as e:
        log.warning(f"  Groq JSON parse error: {e} — set semua NEUTRAL 0.5")
        for a in articles:
            if a["sentiment"] is None:
                a["sentiment"] = "NEUTRAL"
                a["relevance"] = 0.5
    except Exception as e:
        log.warning(f"  Groq batch gagal: {e} — set semua NEUTRAL 0.5")
        for a in articles:
            if a["sentiment"] is None:
                a["sentiment"] = "NEUTRAL"
                a["relevance"] = 0.5

    return articles



# ══════════════════════════════════════════════════════════════════════════════
# DEDUPLIKASI — filter artikel yang sudah ada di Supabase
# ══════════════════════════════════════════════════════════════════════════════

def get_existing_urls(urls: list[str]) -> set[str]:
    """
    Query Supabase untuk URL yang sudah ada di news_cache.
    Batching per 50 URL untuk hindari PostgREST URL too long error.
    """
    if not urls:
        return set()
    existing: set[str] = set()
    try:
        batch_size = 50
        for i in range(0, len(urls), batch_size):
            batch = urls[i:i + batch_size]
            resp = (
                supabase.table("news_cache")
                .select("url")
                .in_("url", batch)
                .execute()
            )
            existing.update(row["url"] for row in resp.data)
    except Exception as e:
        log.warning(f"  Gagal cek duplikat di Supabase: {e} — skip dedup")
    return existing


def deduplicate_articles(articles: list[dict]) -> list[dict]:
    """
    Hapus artikel duplikat:
    1. Dalam batch saat ini (by url_hash)
    2. Yang sudah ada di Supabase (by url)
    """
    # Dedup dalam batch by url_hash
    seen_hashes: set[str] = set()
    unique = []
    for a in articles:
        h = a["url_hash"]
        if h not in seen_hashes:
            seen_hashes.add(h)
            unique.append(a)

    # Dedup vs Supabase by URL
    existing = get_existing_urls([a["url"] for a in unique])
    fresh = [a for a in unique if a["url"] not in existing]

    removed = len(articles) - len(fresh)
    if removed > 0:
        log.info(f"  Dedup: {removed} artikel dibuang ({len(fresh)} tersisa)")
    return fresh


# ══════════════════════════════════════════════════════════════════════════════
# SUPABASE WRITER
# ══════════════════════════════════════════════════════════════════════════════

def write_articles_to_db(articles: list[dict]) -> int:
    """
    Batch INSERT artikel ke tabel news_cache.
    Return jumlah artikel berhasil diinsert.
    """
    if not articles:
        return 0

    expires_at = (datetime.now(IDX_TZ) + timedelta(hours=NEWS_TTL_HOURS)).isoformat()
    rows = []
    for a in articles:
        rows.append({
            "ticker":       a["ticker"],
            "title":        a["title"][:500],           # truncate judul panjang
            "source":       (a["source"] or "Google News")[:100],
            "url":          a["url"][:1000],
            "sentiment":    a.get("sentiment", "NEUTRAL"),
            "relevance":    a.get("relevance", 0.5),
            "published_at": a["published_at"].isoformat() if a["published_at"] else None,
            "fetched_at":   datetime.now(IDX_TZ).isoformat(),
            "expires_at":   expires_at,
        })

    try:
        # Insert dalam batch kecil untuk hindari payload terlalu besar
        batch_size = 20
        inserted = 0
        # Upsert untuk handle race condition jika concurrent GitHub Actions runs
        # Membutuhkan UNIQUE constraint pada kolom url di schema (lihat catatan)
        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            try:
                supabase.table("news_cache").upsert(
                    batch, on_conflict="url"
                ).execute()
            except Exception:
                # Fallback ke insert jika UNIQUE belum ada di schema
                supabase.table("news_cache").insert(batch).execute()
            inserted += len(batch)
        log.info(f"  DB: {inserted} artikel diinsert ke news_cache")
        return inserted
    except Exception as e:
        log.error(f"  Gagal insert ke news_cache: {e}")
        return 0


# ══════════════════════════════════════════════════════════════════════════════
# MAIN ORCHESTRATOR
# ══════════════════════════════════════════════════════════════════════════════

def run_news_fetcher():
    """
    Entry point — dipanggil GitHub Actions cron */30 market hours.

    Flow:
      A. Headline global: IHSG, bursa Asia, ekonomi makro Indonesia
      B. Per ticker LQ45: "[TICKER] saham" query di Google News
      C. Groq batch sentimen per GROQ_BATCH_SIZE artikel
      D. Dedup vs Supabase
      E. INSERT ke news_cache
    """
    log.info("=== News Fetcher START ===")

    if not is_market_hours():
        log.info("Di luar jam market — fetcher tidak dijalankan.")
        return {"status": "skipped", "reason": "outside_market_hours"}

    all_articles: list[dict] = []

    # ── A. Headline Global ─────────────────────────────────────────────────
    log.info("--- Fetch headline global ---")
    global_queries = [
        ("IHSG bursa saham Indonesia hari ini",       None),
        ("ekonomi makro Indonesia inflasi rupiah",     None),
        ("Bank Indonesia suku bunga kebijakan",        None),
        ("bursa Asia Nikkei Hang Seng hari ini",       None),
        ("harga komoditas minyak batu bara nikel",     None),
    ]
    for query, ticker in global_queries:
        articles = fetch_rss_articles(query, ticker=ticker)
        all_articles.extend(articles)
        time.sleep(RATE_LIMIT_SLEEP)


    # ── B. Per Ticker LQ45 ─────────────────────────────────────────────────
    log.info("--- Fetch berita per ticker ---")

    # Jika ada TICKER_OVERRIDE dari workflow_dispatch, pakai itu saja
    if TICKER_OVERRIDE:
        tickers = [t.strip().upper() for t in TICKER_OVERRIDE.split(",") if t.strip()]
        log.info(f"  Mode override: {tickers}")
    else:
        tickers = get_lq45_tickers()

    for ticker in tickers:
        # Query: nama ticker + kata kunci saham agar hasil relevan
        query = f"{ticker} saham"
        articles = fetch_rss_articles(query, ticker=ticker)
        all_articles.extend(articles)
        time.sleep(RATE_LIMIT_SLEEP)

    log.info(f"Total artikel terkumpul (raw): {len(all_articles)}")

    # ── C. Dedup (sebelum Groq — hemat token) ────────────────────────────
    log.info("--- Deduplikasi ---")
    fresh_articles = deduplicate_articles(all_articles)
    log.info(f"Artikel fresh (setelah dedup): {len(fresh_articles)}")

    if not fresh_articles:
        log.info("Tidak ada artikel baru — selesai.")
        return {"status": "done", "inserted": 0}

    # ── D. Groq Sentimen — batch processing ──────────────────────────────
    log.info("--- Analisis sentimen Groq ---")
    analyzed: list[dict] = []
    for i in range(0, len(fresh_articles), GROQ_BATCH_SIZE):
        batch = fresh_articles[i:i + GROQ_BATCH_SIZE]
        log.info(f"  Batch {i // GROQ_BATCH_SIZE + 1}: {len(batch)} artikel")
        analyzed_batch = analyze_sentiment_batch(batch)
        analyzed.extend(analyzed_batch)
        # Jeda antar Groq call untuk hindari rate limit
        if i + GROQ_BATCH_SIZE < len(fresh_articles):
            time.sleep(1.0)


    # ── E. Write ke Supabase ───────────────────────────────────────────────
    log.info("--- Write ke Supabase ---")
    total_inserted = write_articles_to_db(analyzed)

    # ── F. Summary ────────────────────────────────────────────────────────
    # Hitung distribusi sentimen untuk logging
    pos = sum(1 for a in analyzed if a.get("sentiment") == "POSITIVE")
    neg = sum(1 for a in analyzed if a.get("sentiment") == "NEGATIVE")
    neu = sum(1 for a in analyzed if a.get("sentiment") == "NEUTRAL")

    stats = {
        "status":      "done",
        "raw":         len(all_articles),
        "fresh":       len(fresh_articles),
        "inserted":    total_inserted,
        "sentiment":   {"POSITIVE": pos, "NEGATIVE": neg, "NEUTRAL": neu},
        "tickers":     len(tickers),
    }

    log.info("=== News Fetcher DONE ===")
    log.info(
        f"Raw={stats['raw']} | Fresh={stats['fresh']} | "
        f"Inserted={stats['inserted']} | "
        f"POS={pos} NEG={neg} NEU={neu}"
    )
    return stats


# ══════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    result = run_news_fetcher()
    # Exit code non-zero jika ada error (untuk GitHub Actions)
    if result.get("status") not in ("done", "skipped"):
        raise SystemExit(1)
