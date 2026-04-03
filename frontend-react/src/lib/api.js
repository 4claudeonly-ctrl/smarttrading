import { supabase } from './supabase'

const MIN_CONFIDENCE = 70

// ── Signals ──────────────────────────────────────────────────
// v2.0: gunakan v_latest_signals_v2 (include phase + macro_flag)
export async function getLatestSignals(limit = 20) {
  const { data, error } = await supabase
    .from('v_latest_signals_v2')
    .select('*')
    .gte('confidence', MIN_CONFIDENCE)
    .order('confidence', { ascending: false })
    .limit(limit)
  // Fallback ke view v1 jika v2 belum ada (belum apply schema additions)
  if (error) {
    const { data: d2, error: e2 } = await supabase
      .from('v_latest_signals')
      .select('*')
      .gte('confidence', MIN_CONFIDENCE)
      .order('confidence', { ascending: false })
      .limit(limit)
    if (e2) throw e2
    return d2
  }
  return data
}

export async function getSignalsByTicker(ticker) {
  const { data, error } = await supabase
    .from('signals')
    .select('*, phase, cacing_score, macro_flag, fomo_penalty')
    .eq('ticker', ticker)
    .gte('confidence', MIN_CONFIDENCE)
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return data
}

// ── Emiten ───────────────────────────────────────────────────
export async function searchEmiten(query) {
  const { data, error } = await supabase
    .from('emiten_meta')
    .select('ticker, name, sector, market_cap_tier')
    .or(`ticker.ilike.%${query}%,name.ilike.%${query}%`)
    .eq('is_active', true)
    .limit(8)
  if (error) throw error
  return data
}

// ── News ─────────────────────────────────────────────────────
export async function getNewsByTicker(ticker, limit = 5) {
  const { data, error } = await supabase
    .from('news_cache')
    .select('*')
    .eq('ticker', ticker)
    .gt('expires_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function getGlobalNews(limit = 10) {
  const { data, error } = await supabase
    .from('news_cache')
    .select('*')
    .is('ticker', null)
    .gt('expires_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// ── Watchlist ────────────────────────────────────────────────
export async function getWatchlist(userId) {
  const { data, error } = await supabase
    .from('watchlist')
    .select('ticker, added_at, emiten_meta(name, sector)')
    .eq('user_id', userId)
  if (error) throw error
  return data
}

// ── Portfolio ────────────────────────────────────────────────
export async function getPortfolio(userId) {
  const { data, error } = await supabase
    .from('portfolio')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'OPEN')
  if (error) throw error
  return data
}

// ── Track Record ─────────────────────────────────────────────
export async function getAccuracy() {
  const { data, error } = await supabase
    .from('v_signal_accuracy_30d')
    .select('*')
  if (error) throw error
  return data
}

export async function getSignalHistory(limit = 30) {
  const { data, error } = await supabase
    .from('signal_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

// ── System Config ─────────────────────────────────────────────
export async function getConfig(key) {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', key)
    .single()
  if (error) throw error
  return data?.value
}

// ── [v2.0] Macro Events ───────────────────────────────────────
export async function getActiveMacroEvents() {
  const { data, error } = await supabase
    .from('v_active_macro_events')
    .select('*')
    .limit(5)
  if (error) return []   // tabel belum ada = kembalikan kosong (graceful)
  return data
}

// ── [v2.0] Phase History ──────────────────────────────────────
export async function getPhaseForTicker(ticker) {
  const { data, error } = await supabase
    .from('phase_history')
    .select('phase, cacing_score, naga_score, detected_at')
    .eq('ticker', ticker)
    .order('detected_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data
}

// ── [v2.0] Broker Flow ────────────────────────────────────────
export async function getBrokerFlowRecent() {
  const { data, error } = await supabase
    .from('v_broker_flow_recent')
    .select('*')
    .eq('is_accumulation_pattern', true)
    .limit(10)
  if (error) return []
  return data
}
