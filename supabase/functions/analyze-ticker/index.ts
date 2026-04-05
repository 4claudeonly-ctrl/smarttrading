// analyze-ticker Edge Function v4.0
// FIX: upsert remapped ke schema tabel signals yang benar
// Kolom benar: signal_type, price_at_signal, price_low, price_high, verdict_text, reasoning_raw
// onConflict: ticker (overwrite sinyal lama per emiten)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { ticker } = await req.json()
    if (!ticker || typeof ticker !== 'string') {
      return jsonErr('ticker wajib diisi', 400)
    }
    const sym = ticker.toUpperCase().trim()
    const yahooSym = sym.endsWith('.JK') ? sym : `${sym}.JK`

    // 1. Fetch OHLCV 90 hari dari Yahoo Finance
    const ohlcv = await fetchYahooOHLCV(yahooSym)
    if (!ohlcv || ohlcv.closes.length < 30) {
      return jsonErr(`Data tidak cukup untuk ${sym}. Pastikan kode saham benar.`, 422)
    }

    // 2. Hitung Technical Indicators
    const ind = calcIndicators(ohlcv)

    // 3. Deterministic Scoring
    const { signal, confidence, scoreDetail } = calcScore(ind, ohlcv)

    // 4. Fetch profil emiten dari Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: meta } = await supabase
      .from('emiten_meta')
      .select('name, sector, sub_sector, market_cap_tier')
      .eq('ticker', sym)
      .maybeSingle()

    const name   = meta?.name ?? sym
    const sector = meta?.sector ?? 'Unknown'

    // 5. Groq hedge fund prompt
    const verdict = await callGroq(sym, name, sector, ind, ohlcv, signal, confidence)

    // 6. UPSERT KE signals TABLE — SCHEMA YANG BENAR (v4 FIX)
    // Tabel punya: signal_type, price_at_signal, price_low, price_high, verdict_text, reasoning_raw
    // v3 salah pakai: signal, current_price, change_pct, data_date (kolom tidak ada)
    const signalRow = {
      ticker:          sym,
      signal_type:     signal,           // FIX: was 'signal'
      confidence:      confidence,
      price_at_signal: ohlcv.lastClose,  // FIX: was 'current_price'
      price_low:       ind.support,      // NEW: 20d support
      price_high:      ind.resistance,   // NEW: 20d resistance
      verdict_text:    verdict,          // FIX: was 'verdict'
      reasoning_raw: {               // NEW: structured reasoning
        score_detail: scoreDetail,
        change_pct:   ohlcv.changePct,
        data_date:    ohlcv.lastDate,
        ret5d:        ohlcv.ret5d,
        ret30d:       ohlcv.ret30d,
        high52w:      ohlcv.high52w,
        low52w:       ohlcv.low52w,
      },
      indicators:    ind,
      timeframe:     'SWING',
      expires_at:    new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }

    const { error: upsertErr } = await supabase
      .from('signals')
      .upsert(signalRow, { onConflict: 'ticker' })

    if (upsertErr) {
      console.error('upsert error:', JSON.stringify(upsertErr))
    }

    // 7. Return payload ke frontend
    return new Response(JSON.stringify({
      success: true,
      data: {
        ticker: sym, name, sector,
        current_price: ohlcv.lastClose,
        change_pct:    ohlcv.changePct,
        ret5d:         ohlcv.ret5d,
        ret30d:        ohlcv.ret30d,
        support:       ind.support,
        resistance:    ind.resistance,
        signal, confidence, verdict,
        indicators:    ind,
        score_detail:  scoreDetail,
        data_date:     ohlcv.lastDate,
        upsert_ok:     !upsertErr,
      }
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (e) {
    console.error('analyze-ticker error:', e)
    return jsonErr(e.message ?? 'Internal error', 500)
  }
})


// ── Yahoo Finance OHLCV ───────────────────────────────────────────────────────
interface OHLCVData {
  dates: string[]; closes: number[]; highs: number[]; lows: number[]
  volumes: number[]; lastClose: number; prevClose: number; changePct: number
  ret5d: number; ret30d: number; lastDate: string; high52w: number; low52w: number
}

async function fetchYahooOHLCV(symbol: string): Promise<OHLCVData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo&events=history`
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 SmartTrading/1.0' } })
    if (!res.ok) return null
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return null
    const timestamps: number[] = result.timestamp ?? []
    const q = result.indicators?.quote?.[0] ?? {}
    const rawCloses  = (q.close  ?? []).map((v: number|null) => v ?? 0)
    const rawHighs   = (q.high   ?? []).map((v: number|null) => v ?? 0)
    const rawLows    = (q.low    ?? []).map((v: number|null) => v ?? 0)
    const rawVolumes = (q.volume ?? []).map((v: number|null) => v ?? 0)
    const valid = timestamps
      .map((ts, i) => ({ ts, c: rawCloses[i], h: rawHighs[i], l: rawLows[i], v: rawVolumes[i] }))
      .filter(x => x.c > 0 && x.h > 0 && x.l > 0)
    if (valid.length < 20) return null
    const closes  = valid.map(x => x.c)
    const highs   = valid.map(x => x.h)
    const lows    = valid.map(x => x.l)
    const volumes = valid.map(x => x.v)
    const dates   = valid.map(x => new Date(x.ts * 1000).toISOString().slice(0, 10))
    const lastClose = closes[closes.length - 1]
    const prevClose = closes[closes.length - 2] ?? lastClose
    const changePct  = +((lastClose - prevClose) / prevClose * 100).toFixed(2)
    const close5dAgo  = closes[closes.length - 6]  ?? closes[0]
    const close30dAgo = closes[closes.length - 31] ?? closes[0]
    const ret5d  = +((lastClose - close5dAgo)  / close5dAgo  * 100).toFixed(2)
    const ret30d = +((lastClose - close30dAgo) / close30dAgo * 100).toFixed(2)
    return { dates, closes, highs, lows, volumes, lastClose, prevClose, changePct,
      ret5d, ret30d, lastDate: dates[dates.length - 1],
      high52w: Math.max(...highs), low52w: Math.min(...lows) }
  } catch (_e) { return null }
}

// ── Technical Indicators ──────────────────────────────────────────────────────
interface Indicators {
  rsi: number; macdHist: number; macdLine: number; macdSignal: number
  ema20: number; ema50: number; bbUpper: number; bbLower: number
  bbMid: number; bbPct: number; volRatio: number
  support: number; resistance: number; trend: 'UP' | 'DOWN' | 'SIDEWAYS'
}

function ema(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = []
  let prev = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k)
    result.push(+prev.toFixed(4))
  }
  return result
}

function calcRSI(closes: number[], period = 14): number {
  let gains = 0, losses = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains += diff; else losses -= diff
  }
  let avgGain = gains / period, avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) return 100
  return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1)
}

function calcIndicators(ohlcv: OHLCVData): Indicators {
  const { closes, highs, lows, volumes } = ohlcv
  const rsi     = closes.length >= 15 ? calcRSI(closes) : 50
  const ema20arr = ema(closes, 20)
  const ema50arr = ema(closes, 50)
  const ema20   = +(ema20arr[ema20arr.length - 1] ?? closes[closes.length - 1]).toFixed(2)
  const ema50   = +(ema50arr[ema50arr.length - 1] ?? closes[closes.length - 1]).toFixed(2)
  const ema12arr = ema(closes, 12)
  const ema26arr = ema(closes, 26)
  const macdLineArr: number[] = []
  const offset = ema12arr.length - ema26arr.length
  for (let i = 0; i < ema26arr.length; i++) {
    macdLineArr.push(+(ema12arr[i + offset] - ema26arr[i]).toFixed(4))
  }
  const macdSignalArr = ema(macdLineArr, 9)
  const macdLine  = macdLineArr[macdLineArr.length - 1] ?? 0
  const macdSig   = macdSignalArr[macdSignalArr.length - 1] ?? 0
  const macdHist  = +(macdLine - macdSig).toFixed(4)
  const bb20     = closes.slice(-20)
  const bbMidRaw = bb20.reduce((a, b) => a + b, 0) / 20
  const stddev   = Math.sqrt(bb20.reduce((s, c) => s + (c - bbMidRaw) ** 2, 0) / 20)
  const bbMid   = +bbMidRaw.toFixed(2)
  const bbUpper = +(bbMidRaw + 2 * stddev).toFixed(2)
  const bbLower = +(bbMidRaw - 2 * stddev).toFixed(2)
  const bbPct   = stddev > 0 ? +((ohlcv.lastClose - bbLower) / (bbUpper - bbLower) * 100).toFixed(1) : 50
  const vol20avg  = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
  const volRatio  = vol20avg > 0 ? +(volumes[volumes.length - 1] / vol20avg).toFixed(2) : 1
  const support    = +Math.min(...lows.slice(-20)).toFixed(0)
  const resistance = +Math.max(...highs.slice(-20)).toFixed(0)
  const trend: 'UP'|'DOWN'|'SIDEWAYS' =
    ohlcv.lastClose > ema20 && ema20 > ema50 ? 'UP' :
    ohlcv.lastClose < ema20 && ema20 < ema50 ? 'DOWN' : 'SIDEWAYS'
  return { rsi, macdHist, macdLine, macdSignal: macdSig, ema20, ema50,
    bbUpper, bbLower, bbMid, bbPct, volRatio, support, resistance, trend }
}

// ── Deterministic Scoring ─────────────────────────────────────────────────────
function calcScore(ind: Indicators, ohlcv: OHLCVData) {
  let score = 0
  const detail: Record<string, number> = {}
  if (ind.rsi < 35)       { score += 2; detail.rsi = +2 }
  else if (ind.rsi < 45)  { score += 1; detail.rsi = +1 }
  else if (ind.rsi > 70)  { score -= 2; detail.rsi = -2 }
  else if (ind.rsi > 60)  { score -= 1; detail.rsi = -1 }
  else                    { detail.rsi = 0 }
  if (ind.macdHist > 0)   { score += 1; detail.macd = +1 }
  else                    { score -= 1; detail.macd = -1 }
  if (ind.trend === 'UP')        { score += 2; detail.trend = +2 }
  else if (ind.trend === 'DOWN') { score -= 2; detail.trend = -2 }
  else                           { detail.trend = 0 }
  if (ind.bbPct < 20)      { score += 2; detail.bb = +2 }
  else if (ind.bbPct > 80) { score -= 1; detail.bb = -1 }
  else                     { detail.bb = 0 }
  if (ind.volRatio >= 1.5) {
    const boost = score > 0 ? +1 : -1
    score += boost; detail.vol = boost
  } else { detail.vol = 0 }
  if (ohlcv.changePct > 1.5)       { score += 1; detail.mom = +1 }
  else if (ohlcv.changePct < -1.5) { score -= 1; detail.mom = -1 }
  else                              { detail.mom = 0 }
  const signal: 'BUY'|'HOLD'|'SELL' = score >= 3 ? 'BUY' : score <= -3 ? 'SELL' : 'HOLD'
  let confidence = Math.min(55 + Math.abs(score) * 5, 92)
  if (signal === 'HOLD') confidence = Math.min(confidence, 70)
  return { signal, confidence, scoreDetail: { total: score, ...detail } }
}

// ── Groq Hedge Fund Grade ─────────────────────────────────────────────────────
async function callGroq(
  ticker: string, name: string, sector: string,
  ind: Indicators, ohlcv: OHLCVData, signal: string, confidence: number,
): Promise<string> {
  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) return ''
  const trendDesc = ind.trend === 'UP' ? 'uptrend (harga di atas EMA20 dan EMA50)' :
    ind.trend === 'DOWN' ? 'downtrend (harga di bawah EMA20 dan EMA50)' : 'sideways'
  const rsiDesc  = ind.rsi < 35 ? 'oversold' : ind.rsi > 70 ? 'overbought' : 'netral'
  const macdDesc = ind.macdHist > 0 ? 'positif (momentum bullish)' : 'negatif (momentum bearish)'
  const bbDesc   = ind.bbPct < 20 ? 'mendekati lower band (area support)' :
    ind.bbPct > 80 ? 'mendekati upper band (area resistance)' : `di tengah (${ind.bbPct}%)`
  const volDesc  = ind.volRatio >= 2 ? `meledak ${ind.volRatio}x rata-rata` :
    ind.volRatio >= 1.5 ? `tinggi ${ind.volRatio}x rata-rata` :
    ind.volRatio < 0.7 ? 'sepi dari rata-rata' : `normal ${ind.volRatio}x`
  const prompt = `Kamu adalah Direktur Riset hedge fund tier-1 Indonesia, 20 tahun pengalaman di BEI.
Tugas: Analisis SWING TRADE ${ticker} (${name}, sektor ${sector}).

DATA TEKNIKAL:
- Harga: Rp ${ohlcv.lastClose.toLocaleString('id-ID')} (${ohlcv.changePct > 0 ? '+' : ''}${ohlcv.changePct}% hari ini)
- Return 5H: ${ohlcv.ret5d > 0 ? '+' : ''}${ohlcv.ret5d}% | Return 30H: ${ohlcv.ret30d > 0 ? '+' : ''}${ohlcv.ret30d}%
- RSI(14): ${ind.rsi} (${rsiDesc}) | MACD: ${macdDesc}
- Trend: ${trendDesc} | Bollinger: ${bbDesc}
- Volume: ${volDesc}
- Support: Rp ${ind.support.toLocaleString('id-ID')} | Resistance: Rp ${ind.resistance.toLocaleString('id-ID')}
- 52W: High Rp ${ohlcv.high52w.toLocaleString('id-ID')} / Low Rp ${ohlcv.low52w.toLocaleString('id-ID')}
- Sinyal: ${signal} (keyakinan ${confidence}%)

FORMAT WAJIB — 5 section, bahasa Indonesia awam:

[KONDISI PASAR]
2 kalimat kondisi teknikal dalam bahasa awam.

[THESIS]
2-3 kalimat kenapa layak/tidak layak swing trade saat ini.

[LEVEL ENTRY]
1-2 kalimat range harga masuk spesifik berdasarkan support/Bollinger.

[SKENARIO RISIKO]
2 skenario: "Jika X terjadi, maka..."

[HORIZON]
1 kalimat durasi swing dan target harga.`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', max_tokens: 700, temperature: 0.4,
        messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) return ''
    const json = await res.json()
    return json.choices?.[0]?.message?.content?.trim() ?? ''
  } catch (_e) { return '' }
}

function jsonErr(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  })
}
