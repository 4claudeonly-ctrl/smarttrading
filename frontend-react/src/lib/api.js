import { supabase } from './supabase'

const MIN_CONFIDENCE = 50  // FIX: was 70, signals saat ini 55-65
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

// ── Edge Function: Market Data (public, no auth needed) ───────
export async function getMarketData() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-market-data`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON,  // FIX: Supabase butuh apikey header
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'get-market-data failed')
  return json.data
}

// ── Edge Function: Analyze Ticker (requires anon key) ─────────
export async function callAnalyzeTicker(ticker) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/analyze-ticker`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'apikey': SUPABASE_ANON,
    },
    body: JSON.stringify({ ticker }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (!json.success) throw new Error(json.error ?? 'analyze-ticker failed')
  return json.data
}

// ── Signals ──────────────────────────────────────────────────
// FIX: query langsung ke tabel signals, skip view yang punya hard filter confidence>=70
export async function getLatestSignals(limit = 20) {
  const { data, error } = await supabase
    .from('signals')
    .select('id, ticker, signal_type, confidence, price_at_signal, price_low, price_high, verdict_text, indicators, timeframe, created_at, expires_at, phase, cacing_score, macro_flag, fomo_penalty, emiten_meta(name, sector)')
    .gte('confidence', MIN_CONFIDENCE)
    .order('confidence', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function getSignalsByTicker(ticker) {
  const { data, error } = await supabase
    .from('signals')
    .select('id, ticker, signal_type, confidence, price_at_signal, price_low, price_high, verdict_text, indicators, created_at, expires_at, phase, cacing_score, macro_flag, fomo_penalty, emiten_meta(name, sector)')
    .eq('ticker', ticker)
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

// ── Watchlist & Portfolio ─────────────────────────────────────
export async function getWatchlist(userId) {
  const { data, error } = await supabase
    .from('watchlist')
    .select('ticker, added_at, emiten_meta(name, sector)')
    .eq('user_id', userId)
  if (error) throw error
  return data
}

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
  if (error) return []
  return data
}

export async function getSignalHistory(limit = 30) {
  const { data, error } = await supabase
    .from('signal_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return []
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
  if (error) return []
  return data
}

// ── [v2.0] Phase & Broker ─────────────────────────────────────
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

export async function getBrokerFlowRecent() {
  const { data, error } = await supabase
    .from('v_broker_flow_recent')
    .select('*')
    .eq('is_accumulation_pattern', true)
    .limit(10)
  if (error) return []
  return data
}
