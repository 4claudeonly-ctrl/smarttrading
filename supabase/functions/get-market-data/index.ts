// get-market-data Edge Function v1.0
// Fetch real-time: IHSG, USD/IDR, Emas, BTC, ETH, Fear&Greed Index
// Cache 5 menit di system_config Supabase

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 menit

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Cek cache ────────────────────────────────────────────────
    const { data: cached } = await supabase
      .from('system_config')
      .select('value, updated_at')
      .eq('key', 'market_data_cache')
      .maybeSingle()

    if (cached?.value && cached?.updated_at) {
      const age = Date.now() - new Date(cached.updated_at).getTime()
      if (age < CACHE_TTL_MS) {
        const payload = typeof cached.value === 'string'
          ? JSON.parse(cached.value)
          : cached.value
        return jsonOk({ ...payload, cached: true, cache_age_sec: Math.floor(age / 1000) })
      }
    }


    // ── Fetch paralel semua sumber ───────────────────────────────
    const [yahooData, cryptoData, fngData] = await Promise.allSettled([
      fetchYahooMulti(['^JKSE', 'USDIDR=X', 'GC=F']),
      fetchCoinGecko(),
      fetchFearGreed(),
    ])

    const yahoo  = yahooData.status  === 'fulfilled' ? yahooData.value  : null
    const crypto = cryptoData.status === 'fulfilled' ? cryptoData.value : null
    const fng    = fngData.status    === 'fulfilled' ? fngData.value    : null

    const payload = {
      ihsg: yahoo?.jkse ?? null,
      usdidr: yahoo?.usdidr ?? null,
      emas: yahoo?.gold ?? null,
      btc: crypto?.btc ?? null,
      eth: crypto?.eth ?? null,
      fear_greed: fng ?? null,
      timestamp: new Date().toISOString(),
      cached: false,
      cache_age_sec: 0,
    }

    // ── Tulis ke cache ────────────────────────────────────────────
    await supabase.from('system_config').upsert(
      { key: 'market_data_cache', value: JSON.stringify(payload), updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )

    return jsonOk(payload)

  } catch (e) {
    console.error('get-market-data error:', e)
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})


// ═══════════════════════════════════════════════════════════════════
// HELPER: Yahoo Finance — ambil beberapa simbol sekaligus
// ═══════════════════════════════════════════════════════════════════
interface QuoteResult { price: number; change: number; changePct: number; name?: string }

async function fetchYahooMulti(symbols: string[]) {
  const joined = symbols.join(',')
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(joined)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 SmartTrading/1.0' },
  })
  if (!res.ok) return null
  const json = await res.json()
  const results: Record<string, QuoteResult> = {}
  for (const q of json?.quoteResponse?.result ?? []) {
    const sym = q.symbol as string
    results[sym] = {
      price:     +(q.regularMarketPrice ?? 0).toFixed(2),
      change:    +(q.regularMarketChange ?? 0).toFixed(2),
      changePct: +(q.regularMarketChangePercent ?? 0).toFixed(2),
      name:      q.shortName ?? sym,
    }
  }
  return {
    jkse:  results['^JKSE']   ?? null,
    usdidr: results['USDIDR=X'] ?? null,
    gold:  results['GC=F']    ?? null,
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: CoinGecko — BTC & ETH (CORS-free, gratis)
// ═══════════════════════════════════════════════════════════════════
async function fetchCoinGecko() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true'
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
  if (!res.ok) return null
  const json = await res.json()
  return {
    btc: {
      price:     +(json?.bitcoin?.usd ?? 0).toFixed(0),
      changePct: +(json?.bitcoin?.usd_24h_change ?? 0).toFixed(2),
    },
    eth: {
      price:     +(json?.ethereum?.usd ?? 0).toFixed(0),
      changePct: +(json?.ethereum?.usd_24h_change ?? 0).toFixed(2),
    },
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Alternative.me Fear & Greed Index
// ═══════════════════════════════════════════════════════════════════
async function fetchFearGreed() {
  const res = await fetch('https://api.alternative.me/fng/?limit=1&format=json')
  if (!res.ok) return null
  const json = await res.json()
  const d = json?.data?.[0]
  if (!d) return null
  return {
    score:       +d.value,
    label:       d.value_classification,  // e.g. "Fear", "Greed", "Extreme Fear"
    timestamp:   d.timestamp,
  }
}

// ── Utility ──────────────────────────────────────────────────────────
function jsonOk(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
