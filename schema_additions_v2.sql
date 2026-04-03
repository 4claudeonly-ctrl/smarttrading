-- ============================================================
-- SMARTTRADING — Schema Additions v2.0
-- Tanggal: 03 Apr 2026
-- Deskripsi: Tambahan untuk backend expansion (PENDING-B)
--   1. ALTER TABLE signals — tambah 4 kolom baru
--   2. TABEL baru: phase_history
--   3. TABEL baru: broker_flow
--   4. TABEL baru: macro_events
-- Cara apply: jalankan file ini di Supabase SQL Editor
--   (aman dijalankan berkali-kali — semua pakai IF NOT EXISTS / DO NOTHING)
-- ============================================================

-- ============================================================
-- BAGIAN 1: ALTER TABLE signals — kolom baru v2.0
-- ============================================================

-- Kolom 1: fase cacing/naga saat signal dibuat
ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS phase TEXT
        CHECK (phase IN ('AKUMULASI','DISTRIBUSI','DUMP','UNKNOWN'));

-- Kolom 2: skor cacing (0.0–1.0) — kekuatan fase akumulasi
ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS cacing_score NUMERIC(5,3)
        CHECK (cacing_score BETWEEN 0 AND 1);

-- Kolom 3: flag macro event yang aktif saat signal dibuat
-- Contoh: ['FED_HAWKISH', 'RUPIAH_LEMAH']
ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS macro_flag TEXT[] DEFAULT '{}';

-- Kolom 4: penalty poin akibat FOMO sosmed (0–30)
ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS fomo_penalty INTEGER DEFAULT 0
        CHECK (fomo_penalty BETWEEN 0 AND 30);

-- Index tambahan untuk filter fase
CREATE INDEX IF NOT EXISTS idx_signals_phase
    ON signals(phase)
    WHERE phase IS NOT NULL;

-- Index untuk macro_flag (GIN untuk array search)
CREATE INDEX IF NOT EXISTS idx_signals_macro_flag
    ON signals USING GIN(macro_flag);

COMMENT ON COLUMN signals.phase        IS 'Fase cacing/naga saat signal: AKUMULASI | DISTRIBUSI | DUMP | UNKNOWN';
COMMENT ON COLUMN signals.cacing_score IS 'Kekuatan fase akumulasi 0.0-1.0 dari phase_detector.py';
COMMENT ON COLUMN signals.macro_flag   IS 'Array flag macro event aktif saat signal dibuat';
COMMENT ON COLUMN signals.fomo_penalty IS 'Penalty poin confidence akibat FOMO sosmed (0-30)';


-- ============================================================
-- BAGIAN 2: TABEL BARU — phase_history
-- Deskripsi: Riwayat deteksi fase cacing/naga per ticker per hari
-- Update   : Setiap run signal_engine (1x/15 menit saat market hours)
-- ============================================================
CREATE TABLE IF NOT EXISTS phase_history (
    id              BIGSERIAL PRIMARY KEY,
    ticker          TEXT NOT NULL REFERENCES emiten_meta(ticker),
    phase           TEXT NOT NULL CHECK (phase IN ('AKUMULASI','DISTRIBUSI','DUMP','UNKNOWN')),
    cacing_score    NUMERIC(5,3) CHECK (cacing_score BETWEEN 0 AND 1),
    naga_score      NUMERIC(5,3) CHECK (naga_score BETWEEN 0 AND 1),
    rsi_at_detect   NUMERIC(5,2),              -- RSI saat fase terdeteksi
    vol_ratio_avg   NUMERIC(7,3),              -- rata-rata volume ratio 5 hari
    price_change_30d NUMERIC(7,2),             -- % perubahan harga 30 hari
    detected_at     TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT                        -- keterangan tambahan (manual override, dll)
);

CREATE INDEX IF NOT EXISTS idx_phase_ticker  ON phase_history(ticker);
CREATE INDEX IF NOT EXISTS idx_phase_phase   ON phase_history(phase);
CREATE INDEX IF NOT EXISTS idx_phase_date    ON phase_history(detected_at DESC);
-- Index gabungan untuk query "fase terbaru per ticker"
CREATE INDEX IF NOT EXISTS idx_phase_latest  ON phase_history(ticker, detected_at DESC);

COMMENT ON TABLE phase_history IS
    'Riwayat deteksi fase cacing/naga per ticker. Dibuat oleh phase_detector.py v2.0. '
    'AKUMULASI = bandar sedang kumpul, DISTRIBUSI = bandar sedang buang, DUMP = sudah jual habis.';


-- ============================================================
-- BAGIAN 3: TABEL BARU — broker_flow
-- Deskripsi: Data konsentrasi broker beli/jual dari IDX summary
-- Update   : Setiap run signal_engine (diambil dari broker_flow.py)
-- ============================================================
CREATE TABLE IF NOT EXISTS broker_flow (
    id                  BIGSERIAL PRIMARY KEY,
    ticker              TEXT NOT NULL REFERENCES emiten_meta(ticker),
    trade_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    -- Metrik konsentrasi broker beli
    top_buyer_broker    TEXT,                   -- kode broker terbesar (beli)
    top_buyer_pct       NUMERIC(5,2),           -- % volume beli oleh top broker
    buy_hhi             NUMERIC(7,4),           -- Herfindahl-Hirschman Index sisi beli
    buy_concentration   TEXT CHECK (buy_concentration IN ('HIGH','MEDIUM','LOW')),
    -- Metrik konsentrasi broker jual
    top_seller_broker   TEXT,                   -- kode broker terbesar (jual)
    top_seller_pct      NUMERIC(5,2),           -- % volume jual oleh top broker
    sell_hhi            NUMERIC(7,4),           -- HHI sisi jual
    sell_concentration  TEXT CHECK (sell_concentration IN ('HIGH','MEDIUM','LOW')),
    -- Flag deteksi pola
    is_accumulation_pattern BOOLEAN DEFAULT FALSE,  -- konsentrasi beli > 60%
    is_block_sell_pattern   BOOLEAN DEFAULT FALSE,  -- pola dump block > 45%
    raw_data            JSONB,                  -- data broker mentah (opsional, untuk audit)
    recorded_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(ticker, trade_date)                  -- 1 record per ticker per hari
);

CREATE INDEX IF NOT EXISTS idx_brokerflow_ticker ON broker_flow(ticker);
CREATE INDEX IF NOT EXISTS idx_brokerflow_date   ON broker_flow(trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_brokerflow_accum  ON broker_flow(ticker, trade_date DESC)
    WHERE is_accumulation_pattern = TRUE;
CREATE INDEX IF NOT EXISTS idx_brokerflow_dump   ON broker_flow(ticker, trade_date DESC)
    WHERE is_block_sell_pattern = TRUE;

COMMENT ON TABLE broker_flow IS
    'Konsentrasi broker beli/jual per ticker. Dianalisis oleh broker_flow.py v2.0. '
    'HHI > 0.6 = konsentrasi tinggi (satu broker dominan). '
    'is_accumulation_pattern: sinyal bandar sedang kumpul. '
    'is_block_sell_pattern: sinyal distribusi/dump aktif.';


-- ============================================================
-- BAGIAN 4: TABEL BARU — macro_events
-- Deskripsi: Event makro yang terdeteksi dari RSS feed
-- Update   : Setiap run news_fetcher (15-30 menit)
-- ============================================================
CREATE TABLE IF NOT EXISTS macro_events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      TEXT NOT NULL,
    -- Contoh event_type: FED_HAWKISH, FED_DOVISH, BI_RATE_NAIK, BI_RATE_TURUN,
    --   CUKAI_ROKOK_NAIK, CUKAI_ROKOK_TURUN, HORMUZ_TENSION, CHINA_STIMULUS,
    --   RUPIAH_LEMAH, RUPIAH_KUAT, SHORT_REPORT, FOMO_SOSMED, CYBER_ATTACK
    event_label     TEXT NOT NULL,             -- label human-readable
    severity        TEXT CHECK (severity IN ('HIGH','MEDIUM','LOW')) DEFAULT 'MEDIUM',
    affected_tickers TEXT[],                   -- ticker yang langsung terdampak (array)
    affected_sectors TEXT[],                   -- sektor yang terdampak
    impact_direction TEXT CHECK (impact_direction IN ('POSITIVE','NEGATIVE','NEUTRAL')),
    confidence_adjustment NUMERIC(5,1),        -- poin +/- untuk confidence signal
    source_title    TEXT,                       -- judul artikel sumber
    source_url      TEXT,
    source_name     TEXT,                       -- "Kontan", "CNBC ID", "Reuters", dll
    raw_keywords    TEXT[],                     -- keyword yang memicu deteksi
    is_active       BOOLEAN DEFAULT TRUE,       -- FALSE saat event sudah berlalu
    detected_at     TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '72 hours'),
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_macroev_type     ON macro_events(event_type);
CREATE INDEX IF NOT EXISTS idx_macroev_active   ON macro_events(is_active, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_macroev_tickers  ON macro_events USING GIN(affected_tickers);
CREATE INDEX IF NOT EXISTS idx_macroev_sectors  ON macro_events USING GIN(affected_sectors);
CREATE INDEX IF NOT EXISTS idx_macroev_expires  ON macro_events(expires_at);

COMMENT ON TABLE macro_events IS
    'Event makro yang terdeteksi oleh macro_trigger.py dari RSS feed. '
    'is_active=TRUE berarti event masih relevan untuk scoring. '
    'confidence_adjustment: positif = boost, negatif = penalty. '
    'SHORT_REPORT selalu override confidence ke 0 (lihat signal_engine.py guardrail).';

-- Auto-expire macro events yang sudah lewat
-- (bisa dijalankan oleh cleanup.py atau pg_cron)
-- UPDATE macro_events SET is_active = FALSE WHERE expires_at < NOW();


-- ============================================================
-- BAGIAN 5: VIEWS BARU v2.0
-- ============================================================

-- View: sinyal terbaru dengan info fase + macro
CREATE OR REPLACE VIEW v_latest_signals_v2 AS
SELECT DISTINCT ON (s.ticker)
    s.id,
    s.ticker,
    s.signal_type,
    s.confidence,
    s.price_at_signal,
    s.price_low,
    s.price_high,
    s.verdict_text,
    s.timeframe,
    s.created_at,
    -- kolom baru v2.0
    s.phase,
    s.cacing_score,
    s.macro_flag,
    s.fomo_penalty,
    -- dari emiten_meta
    e.name AS emiten_name,
    e.sector,
    -- fase terbaru dari phase_history
    ph.naga_score
FROM signals s
JOIN emiten_meta e ON s.ticker = e.ticker
LEFT JOIN LATERAL (
    SELECT naga_score
    FROM phase_history
    WHERE ticker = s.ticker
    ORDER BY detected_at DESC
    LIMIT 1
) ph ON TRUE
WHERE s.confidence >= 70
  AND s.expires_at > NOW()
ORDER BY s.ticker, s.created_at DESC;

-- View: ringkasan macro events aktif + dampaknya
CREATE OR REPLACE VIEW v_active_macro_events AS
SELECT
    event_type,
    event_label,
    severity,
    impact_direction,
    confidence_adjustment,
    affected_sectors,
    source_name,
    detected_at,
    expires_at
FROM macro_events
WHERE is_active = TRUE
  AND expires_at > NOW()
ORDER BY severity DESC, detected_at DESC;

-- View: summary konsentrasi broker terbaru (3 hari)
CREATE OR REPLACE VIEW v_broker_flow_recent AS
SELECT
    bf.ticker,
    e.name AS emiten_name,
    bf.trade_date,
    bf.top_buyer_broker,
    bf.top_buyer_pct,
    bf.buy_concentration,
    bf.is_accumulation_pattern,
    bf.top_seller_broker,
    bf.top_seller_pct,
    bf.is_block_sell_pattern
FROM broker_flow bf
JOIN emiten_meta e ON bf.ticker = e.ticker
WHERE bf.trade_date >= CURRENT_DATE - INTERVAL '3 days'
ORDER BY bf.ticker, bf.trade_date DESC;

-- ============================================================
-- END OF SCHEMA ADDITIONS v2.0
-- SmartTrading v2.0 | 03 Apr 2026
-- Total additions:
--   - ALTER TABLE signals: +4 kolom (phase, cacing_score, macro_flag, fomo_penalty)
--   - CREATE TABLE phase_history (12 kolom + 4 index)
--   - CREATE TABLE broker_flow (17 kolom + 4 index)
--   - CREATE TABLE macro_events (17 kolom + 5 index)
--   - CREATE VIEW v_latest_signals_v2
--   - CREATE VIEW v_active_macro_events
--   - CREATE VIEW v_broker_flow_recent
-- ============================================================

