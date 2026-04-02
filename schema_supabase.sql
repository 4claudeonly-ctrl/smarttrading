-- ============================================================
-- SMARTTRADING — Schema Database Supabase
-- Versi  : 1.0
-- Tanggal: 01 Apr 2026
-- Arch   : Supabase free tier (500MB), Zero-Cost
-- ============================================================

-- ============================================================
-- TABEL 1: emiten_meta
-- Deskripsi: Master data semua emiten IDX (~900 saham)
-- Update   : Sekali saat init, update manual jika ada IPO baru
-- ============================================================
CREATE TABLE IF NOT EXISTS emiten_meta (
    ticker          TEXT PRIMARY KEY,           -- "BBCA", "TLKM", dst
    name            TEXT NOT NULL,              -- "Bank Central Asia Tbk"
    sector          TEXT,                       -- "Perbankan", "Teknologi", dst
    industry        TEXT,                       -- sub-sektor
    market_cap_tier TEXT CHECK (market_cap_tier IN ('LQ45','IDX80','SMALL','MICRO')),
    listing_date    DATE,
    is_active       BOOLEAN DEFAULT TRUE,       -- FALSE jika delisting
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_emiten_sector ON emiten_meta(sector);
CREATE INDEX idx_emiten_tier   ON emiten_meta(market_cap_tier);

-- ============================================================
-- TABEL 2: signals
-- Deskripsi: Output utama signal engine — BUY/HOLD/SELL per emiten
-- Update   : Setiap 15 menit saat market hours (GitHub Actions)
-- ============================================================
CREATE TABLE IF NOT EXISTS signals (
    id              BIGSERIAL PRIMARY KEY,
    ticker          TEXT NOT NULL REFERENCES emiten_meta(ticker),
    signal_type     TEXT NOT NULL CHECK (signal_type IN ('BUY','HOLD','SELL')),
    confidence      NUMERIC(5,2) NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    price_at_signal NUMERIC(12,2),             -- harga saat signal dibuat
    price_low       NUMERIC(12,2),             -- range bawah untuk user
    price_high      NUMERIC(12,2),             -- range atas untuk user
    verdict_text    TEXT,                       -- narasi panjang bahasa manusia
    reasoning_raw   JSONB,                      -- raw output dari Groq LLM
    indicators      JSONB,                      -- RSI, MACD, volume, dst (internal)
    timeframe       TEXT DEFAULT 'SWING',       -- SCALP | SWING | POSITION
    expires_at      TIMESTAMPTZ,               -- kapan signal ini kadaluarsa
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_signals_ticker  ON signals(ticker);
CREATE INDEX idx_signals_type    ON signals(signal_type);
CREATE INDEX idx_signals_created ON signals(created_at DESC);
CREATE INDEX idx_signals_conf    ON signals(confidence DESC);

-- Hanya ambil signal dengan confidence >= 70 (NFR-008)
CREATE INDEX idx_signals_valid ON signals(ticker, created_at DESC)
    WHERE confidence >= 70;

-- ============================================================
-- TABEL 3: news_cache
-- Deskripsi: Cache berita dari Google News RSS per ticker
-- Update   : Setiap 15 menit, auto-expire 24 jam
-- ============================================================
CREATE TABLE IF NOT EXISTS news_cache (
    id          BIGSERIAL PRIMARY KEY,
    ticker      TEXT REFERENCES emiten_meta(ticker),  -- NULL = berita global/IHSG
    title       TEXT NOT NULL,
    source      TEXT,                                  -- "Kontan", "CNBC ID", dst
    url         TEXT,
    sentiment   TEXT CHECK (sentiment IN ('POSITIVE','NEUTRAL','NEGATIVE')),
    relevance   NUMERIC(3,2),                          -- 0.00 - 1.00
    published_at TIMESTAMPTZ,
    fetched_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_news_ticker    ON news_cache(ticker);
CREATE INDEX idx_news_published ON news_cache(published_at DESC);
CREATE INDEX idx_news_expires   ON news_cache(expires_at);

-- UNIQUE constraint untuk support upsert (hindari race condition concurrent runs)
ALTER TABLE news_cache ADD CONSTRAINT news_cache_url_unique UNIQUE (url);

-- Auto-delete berita expired (jalankan via cron atau trigger)
-- DELETE FROM news_cache WHERE expires_at < NOW();


-- ============================================================
-- TABEL 4: watchlist
-- Deskripsi: Daftar saham yang diikuti user (FR-010)
-- Scope    : Per user (gunakan Supabase Auth user_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS watchlist (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL,                 -- dari Supabase Auth
    ticker      TEXT NOT NULL REFERENCES emiten_meta(ticker),
    added_at    TIMESTAMPTZ DEFAULT NOW(),
    notes       TEXT,
    UNIQUE(user_id, ticker)
);

CREATE INDEX idx_watchlist_user ON watchlist(user_id);

-- ============================================================
-- TABEL 5: portfolio
-- Deskripsi: Posisi aktif user untuk P&L tracker (FR-050)
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL,
    ticker          TEXT NOT NULL REFERENCES emiten_meta(ticker),
    lot             INTEGER NOT NULL CHECK (lot > 0),  -- 1 lot = 100 lembar
    avg_buy_price   NUMERIC(12,2) NOT NULL,
    buy_date        DATE,
    status          TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
    sell_price      NUMERIC(12,2),
    sell_date       DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_portfolio_user   ON portfolio(user_id);
CREATE INDEX idx_portfolio_status ON portfolio(user_id, status);


-- ============================================================
-- TABEL 6: signal_history
-- Deskripsi: Track record akurasi signal (FR-052)
-- Update   : Saat signal expire, system evaluasi actual price
-- ============================================================
CREATE TABLE IF NOT EXISTS signal_history (
    id              BIGSERIAL PRIMARY KEY,
    signal_id       BIGINT REFERENCES signals(id),
    ticker          TEXT NOT NULL,
    signal_type     TEXT NOT NULL,
    confidence      NUMERIC(5,2),
    price_at_signal NUMERIC(12,2),
    price_at_expire NUMERIC(12,2),             -- harga saat signal kadaluarsa
    outcome         TEXT CHECK (outcome IN ('WIN','LOSS','NEUTRAL','PENDING')),
    pct_change      NUMERIC(7,2),              -- % perubahan harga
    evaluated_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sighistory_ticker  ON signal_history(ticker);
CREATE INDEX idx_sighistory_outcome ON signal_history(outcome);
CREATE INDEX idx_sighistory_created ON signal_history(created_at DESC);

-- ============================================================
-- TABEL 7: event_playbook
-- Deskripsi: Template strategi berdasarkan kondisi makro (FR-020)
-- Update   : Manual oleh admin — data statis
-- Contoh   : "Fed Rate Hike" -> SELL Properti, HOLD Perbankan
-- ============================================================
CREATE TABLE IF NOT EXISTS event_playbook (
    id              BIGSERIAL PRIMARY KEY,
    event_type      TEXT NOT NULL,             -- "FED_RATE_HIKE", "RUPIAH_WEAKENS", dst
    event_label     TEXT NOT NULL,             -- label display untuk user
    affected_sector TEXT,                      -- sektor yang terdampak
    impact          TEXT CHECK (impact IN ('POSITIVE','NEGATIVE','NEUTRAL')),
    recommendation  TEXT,                      -- narasi rekomendasi
    historical_ref  TEXT,                      -- referensi kejadian serupa
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_playbook_event  ON event_playbook(event_type);
CREATE INDEX idx_playbook_sector ON event_playbook(affected_sector);


-- ============================================================
-- TABEL 8: system_config
-- Deskripsi: Konfigurasi runtime sistem (threshold, flags, dll)
-- Update   : Manual admin atau via script
-- ============================================================
CREATE TABLE IF NOT EXISTS system_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Seed data konfigurasi awal
INSERT INTO system_config (key, value, description) VALUES
    ('confidence_threshold',  '70',    'Minimum confidence score (%) untuk masuk screener — NFR-008'),
    ('market_open_time',      '09:00', 'Jam buka BEI (WIB)'),
    ('market_close_time',     '15:30', 'Jam tutup BEI (WIB)'),
    ('signal_ttl_hours',      '4',     'Jam sebelum signal dianggap expired'),
    ('news_cache_ttl_hours',  '24',    'Jam sebelum cache berita dihapus'),
    ('crypto_tickers',        'BTC,ETH','Ticker kripto yang dipantau — G10 scope-down'),
    ('max_sector_pct',        '40',    'Batas % satu sektor di portfolio sebelum warning — FR-054'),
    ('idx_timezone',          'Asia/Jakarta', 'Timezone untuk semua kalkulasi waktu')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Aktifkan agar setiap user hanya bisa akses data sendiri
-- ============================================================

-- Aktifkan RLS pada tabel user-specific
ALTER TABLE watchlist  ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio  ENABLE ROW LEVEL SECURITY;

-- Policy watchlist: user hanya bisa CRUD data miliknya sendiri
CREATE POLICY watchlist_user_policy ON watchlist
    USING (user_id = auth.uid());

-- Policy portfolio: user hanya bisa CRUD data miliknya sendiri
CREATE POLICY portfolio_user_policy ON portfolio
    USING (user_id = auth.uid());

-- Tabel publik (semua user bisa READ, hanya service_role yang WRITE)
-- signals, news_cache, emiten_meta, event_playbook, signal_history, system_config
-- Tidak perlu RLS — Supabase anon key diset READ ONLY via dashboard


-- ============================================================
-- VIEWS BERGUNA
-- ============================================================

-- View: sinyal terbaru per ticker (confidence >= threshold)
CREATE OR REPLACE VIEW v_latest_signals AS
SELECT DISTINCT ON (ticker)
    s.id, s.ticker, s.signal_type, s.confidence,
    s.price_at_signal, s.price_low, s.price_high,
    s.verdict_text, s.timeframe, s.created_at,
    e.name AS emiten_name, e.sector
FROM signals s
JOIN emiten_meta e ON s.ticker = e.ticker
WHERE s.confidence >= 70
  AND s.expires_at > NOW()
ORDER BY ticker, created_at DESC;

-- View: akurasi signal 30 hari terakhir
CREATE OR REPLACE VIEW v_signal_accuracy_30d AS
SELECT
    signal_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE outcome = 'WIN')     AS wins,
    COUNT(*) FILTER (WHERE outcome = 'LOSS')    AS losses,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE outcome = 'WIN') / NULLIF(COUNT(*), 0),
        1
    ) AS win_rate_pct
FROM signal_history
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND outcome != 'PENDING'
GROUP BY signal_type;

-- ============================================================
-- END OF SCHEMA
-- SmartTrading v1.0 | 01 Apr 2026
-- ============================================================
