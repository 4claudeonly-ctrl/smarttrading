-- schema_goreng_detector.sql
-- Tabel untuk menyimpan hasil goreng detector
-- Apply di Supabase SQL Editor

-- ══════════════════════════════════════════════════════════════
-- TABEL: goreng_alerts
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS goreng_alerts (
    id              bigserial PRIMARY KEY,
    ticker          text NOT NULL UNIQUE,
    phase           text NOT NULL,        -- CLEAN|AKUMULASI|PUMP_AWAL|PUMP_PUNCAK|DISTRIBUSI|DUMP
    phase_label     text,
    warning_level   text NOT NULL,        -- NONE|WATCH|RIDE|EXIT_NOW|DANGER
    pump_score      numeric(5,1),         -- 0-100
    dump_risk       numeric(5,1),         -- 0-100
    gagal_pct       numeric(5,1),         -- % kemungkinan gagal goreng
    bandar_strength text,                 -- WEAK|MEDIUM|STRONG|KONGLOMERAT|UNKNOWN
    bandar_group    text,
    legit_catalyst  boolean DEFAULT false,
    narasi          text,
    saran           text,
    vol_ratio       numeric(6,2),
    ret7d           numeric(6,2),
    ret30d          numeric(6,2),
    last_price      numeric(12,2),
    rsi             numeric(5,1),
    analyzed_at     timestamptz DEFAULT now(),
    expires_at      timestamptz,
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now()
);

-- Index untuk query cepat
CREATE INDEX IF NOT EXISTS idx_goreng_phase   ON goreng_alerts(phase);
CREATE INDEX IF NOT EXISTS idx_goreng_warning ON goreng_alerts(warning_level);
CREATE INDEX IF NOT EXISTS idx_goreng_pump    ON goreng_alerts(pump_score DESC);
CREATE INDEX IF NOT EXISTS idx_goreng_updated ON goreng_alerts(updated_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_goreng_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_goreng_updated ON goreng_alerts;
CREATE TRIGGER trg_goreng_updated
    BEFORE UPDATE ON goreng_alerts
    FOR EACH ROW EXECUTE FUNCTION update_goreng_updated_at();

-- RLS
ALTER TABLE goreng_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goreng_public_read" ON goreng_alerts
    FOR SELECT USING (true);
CREATE POLICY "goreng_service_write" ON goreng_alerts
    FOR ALL USING (auth.role() = 'service_role');

-- ══════════════════════════════════════════════════════════════
-- TABEL: goreng_history
-- Riwayat fase per ticker (untuk track record prediksi)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS goreng_history (
    id          bigserial PRIMARY KEY,
    ticker      text NOT NULL,
    phase       text NOT NULL,
    pump_score  numeric(5,1),
    dump_risk   numeric(5,1),
    last_price  numeric(12,2),
    recorded_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ghistory_ticker ON goreng_history(ticker, recorded_at DESC);
ALTER TABLE goreng_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ghistory_public_read" ON goreng_history FOR SELECT USING (true);
CREATE POLICY "ghistory_service_write" ON goreng_history FOR ALL USING (auth.role() = 'service_role');

-- ══════════════════════════════════════════════════════════════
-- VIEW: v_active_goreng_alerts
-- Hanya tampilkan alert aktif + bukan CLEAN, diurutkan pump_score
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW v_active_goreng_alerts AS
SELECT
    ticker, phase, phase_label, warning_level,
    pump_score, dump_risk, gagal_pct,
    bandar_strength, bandar_group, legit_catalyst,
    narasi, saran, vol_ratio, ret7d, ret30d,
    last_price, rsi, analyzed_at
FROM goreng_alerts
WHERE phase != 'CLEAN'
  AND (expires_at IS NULL OR expires_at > now())
ORDER BY
    CASE warning_level
        WHEN 'DANGER'   THEN 1
        WHEN 'EXIT_NOW' THEN 2
        WHEN 'RIDE'     THEN 3
        WHEN 'WATCH'    THEN 4
        ELSE 5
    END,
    pump_score DESC;

-- Keamanan view
ALTER VIEW v_active_goreng_alerts OWNER TO postgres;
GRANT SELECT ON v_active_goreng_alerts TO anon, authenticated;
