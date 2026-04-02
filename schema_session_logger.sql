-- ============================================================
-- DUAL-LAYER SESSION GENOME — Table: data_response_statistic
-- ============================================================
-- Framework : Dual-Layer Session Genome
-- Layer A   : memory graph (MCP) = PETA / macro context
-- Layer B   : tabel ini = GPS COORDINATE / micro checkpoint
-- Fungsi 1  : Self-learning — belajar dari pattern sukses/gagal
-- Fungsi 2  : One-truth-source checkpoint untuk session recovery
-- Dibuat    : 01 Apr 2026
-- ============================================================

CREATE TABLE IF NOT EXISTS data_response_statistic (
    -- === IDENTITAS ROW ===
    id                      BIGSERIAL PRIMARY KEY,
    session_id              TEXT NOT NULL,          -- "01Apr2026-S3", "02Apr2026-S1"
    turn_number             INTEGER NOT NULL,        -- urutan turn dalam sesi (1, 2, 3...)
    project_id              TEXT DEFAULT 'SMARTTRADING', -- untuk multi-project support

    -- === TIMESTAMPS ===
    timestamp_user_msg      TIMESTAMPTZ,            -- saat user kirim pesan
    timestamp_claude_start  TIMESTAMPTZ,            -- saat Claude mulai respons
    timestamp_claude_end    TIMESTAMPTZ DEFAULT NOW(), -- saat Claude selesai respons
    duration_seconds        NUMERIC(8,2),           -- lama Claude merespons

    -- === KONTEN TURN ===
    user_message_summary    TEXT,                   -- ringkasan pesan user (max ~500 char)
    claude_response_summary TEXT,                   -- ringkasan respons Claude (bukan full text)
    response_types          TEXT[],                 -- {"text","code","file","diagram","tool_call"}

    -- === TOOL CALLS ===
    -- Array JSON: [{name, job_desc, status, result_summary, duration_ms}]
    tools_called            JSONB DEFAULT '[]'::jsonb,
    tools_count             INTEGER DEFAULT 0,      -- jumlah tool yang dipanggil di turn ini

    -- === PROGRESS & CHECKPOINT ===
    progress_status         TEXT DEFAULT 'DONE'
                            CHECK (progress_status IN ('DONE','PARTIAL','BLOCKED','PENDING','SKIPPED')),
    checkpoint_label        TEXT,                   -- "news_fetcher.py chunk 3/5 selesai"
    phase                   TEXT,                   -- "PHASE_1_BACKEND","PHASE_2_DOCS","PHASE_3_FRONTEND"
    priority_active         INTEGER,                -- prioritas yang sedang dikerjakan (1-5)
    next_action             TEXT,                   -- apa yang HARUS dikerjakan turn berikutnya
    files_created           TEXT[],                 -- file yang dibuat di turn ini
    files_modified          TEXT[],                 -- file yang dimodifikasi di turn ini

    -- === HAMBATAN & SOLUSI (self-learning core) ===
    has_blocker             BOOLEAN DEFAULT FALSE,
    blocker_description     TEXT,                   -- deskripsi masalah
    blocker_solution        TEXT,                   -- solusi yang berhasil
    retry_count             INTEGER DEFAULT 0,      -- berapa kali retry sebelum berhasil

    -- === TOKEN ESTIMATION ===
    estimated_tokens_input  INTEGER DEFAULT 0,      -- estimasi input tokens turn ini
    estimated_tokens_output INTEGER DEFAULT 0,      -- estimasi output tokens turn ini
    estimated_tokens_used   INTEGER DEFAULT 0,      -- total = input + output
    cumulative_tokens_session INTEGER DEFAULT 0,    -- akumulasi seluruh sesi
    context_window_pct      NUMERIC(5,2),           -- % context window terpakai (estimasi)

    -- === RECOVERY FLAGS ===
    is_emergency_recovery   BOOLEAN DEFAULT FALSE,  -- TRUE jika turn ini adalah recovery
    recovery_from_turn      INTEGER,                -- jika recovery, dari turn berapa
    recovery_reason         TEXT,                   -- "token_limit","crash","power_loss","manual"

    -- === SELF-LEARNING TAGS ===
    -- Tag untuk query pattern di masa depan
    -- Contoh: {"RSS_PARSE_OK","GROQ_BATCH_10","ENCODING_FIX_UTF8","SUPABASE_UPSERT"}
    self_learning_tags      TEXT[] DEFAULT '{}',

    -- === META ===
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- === INDEXES ===
CREATE INDEX idx_drs_session     ON data_response_statistic(session_id);
CREATE INDEX idx_drs_project     ON data_response_statistic(project_id);
CREATE INDEX idx_drs_turn        ON data_response_statistic(session_id, turn_number);
CREATE INDEX idx_drs_status      ON data_response_statistic(progress_status);
CREATE INDEX idx_drs_created     ON data_response_statistic(created_at DESC);
CREATE INDEX idx_drs_blocker     ON data_response_statistic(has_blocker) WHERE has_blocker = TRUE;
CREATE INDEX idx_drs_tags        ON data_response_statistic USING GIN(self_learning_tags);
CREATE INDEX idx_drs_next_action ON data_response_statistic(session_id, id DESC);

-- === VIEW: LAST CHECKPOINT ===
-- Dipakai oleh bootstrap_load.py untuk instant recovery
CREATE OR REPLACE VIEW v_last_checkpoint AS
SELECT
    session_id, turn_number, project_id,
    checkpoint_label, phase, priority_active,
    progress_status, next_action,
    files_created, files_modified,
    has_blocker, blocker_description, blocker_solution,
    estimated_tokens_used, cumulative_tokens_session, context_window_pct,
    is_emergency_recovery, recovery_reason,
    timestamp_claude_end AS last_activity,
    tools_count
FROM data_response_statistic
ORDER BY id DESC
LIMIT 1;

-- === VIEW: SESSION SUMMARY ===
CREATE OR REPLACE VIEW v_session_summary AS
SELECT
    session_id, project_id,
    COUNT(*) AS total_turns,
    COUNT(*) FILTER (WHERE progress_status = 'DONE')    AS done_turns,
    COUNT(*) FILTER (WHERE progress_status = 'PARTIAL') AS partial_turns,
    COUNT(*) FILTER (WHERE has_blocker = TRUE)          AS blocked_turns,
    SUM(tools_count)                                    AS total_tool_calls,
    MAX(cumulative_tokens_session)                      AS total_tokens,
    MAX(timestamp_claude_end)                           AS last_activity,
    MIN(timestamp_claude_start)                         AS session_start
FROM data_response_statistic
GROUP BY session_id, project_id
ORDER BY last_activity DESC;

-- === VIEW: SELF-LEARNING BLOCKERS ===
-- Dipakai untuk query: "pernah ketemu masalah ini sebelumnya?"
CREATE OR REPLACE VIEW v_blocker_solutions AS
SELECT DISTINCT
    self_learning_tags,
    blocker_description,
    blocker_solution,
    session_id,
    turn_number,
    timestamp_claude_end
FROM data_response_statistic
WHERE has_blocker = TRUE
  AND blocker_solution IS NOT NULL
ORDER BY timestamp_claude_end DESC;

-- ============================================================
-- END: schema_session_logger.sql
-- Dual-Layer Session Genome — SmartTrading + semua project
-- ============================================================
