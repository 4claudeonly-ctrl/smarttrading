import { supabase } from './supabase'

const MIN_CONFIDENCE = 70

// ── Signals ──────────────────────────────────────────────────
export async function getLatestSignals(limit = 20) {
  const { data, error } = await supabase
    .from('v_latest_signals')
    .select('*')
    .gte('confidence', MIN_CONFIDENCE)
    .order('confidence', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data
}

export async function getSignalsByTicker(ticker) {
  const { data, error } = await supabase
    .from('signals')
    .select('*')
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

// ── System Config ────────────────────────────────────────────
export async function getConfig(key) {
  const { data, error } = await supabase
    .from('system_config')
    .select('value')
    .eq('key', key)
    .single()
  if (error) throw error
  return data?.value
}
