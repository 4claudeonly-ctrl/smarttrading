// analyze-ticker Edge Function v1.0
// Pipeline: Yahoo Finance OHLCV → TA manual → Scoring → Groq hedge fund prompt → Supabase upsert
// Deno/TypeScript — no external TA libraries

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

    // ── 1. Fetch OHLCV 90 hari dari Yahoo Finance ──────────────────────────
    const ohlcv = await fetchYahooOHLCV(yahooSym)
    if (!ohlcv || ohlcv.closes.length < 30) {
      return jsonErr(`Data tidak cukup untuk ${sym}. Pastikan kode saham benar (contoh: BBCA, TLKM).`, 422)
    }

    // ── 2. Hitung Technical Indicators ─────────────────────────────────────
    const ind = calcIndicators(ohlcv)

    // ── 3. Deterministic Scoring ────────────────────────────────────────────
    const { signal, confidence, scoreDetail } = calcScore(ind, ohlcv)

    // ── 4. Fetch profil emiten dari Supabase ────────────────────────────────
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

    // ── 5. Groq hedge fund prompt ───────────────────────────────────────────
    const verdict = await callGroq(sym, name, sector, ind, ohlcv, signal, confidence)


    // ── 6. Upsert ke signals table ──────────────────────────────────────────
    const signalRow = {
      ticker: sym,
      signal,
      confidence,
      verdict,
      indicators: ind,
      current_price: ohlcv.lastClose,
      change_pct:    ohlcv.changePct,
      data_date:     ohlcv.lastDate,
      generated_at:  new Date().toISOString(),
      expires_at:    new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }
    await supabase.from('signals').upsert(signalRow, { onConflict: 'ticker,data_date' })

    // ── 7. Return payload ke frontend ───────────────────────────────────────
    const payload = {
      ticker:        sym,
      name,
      sector,
      current_price: ohlcv.lastClose,
      change_pct:    ohlcv.changePct,
      ret5d:         ohlcv.ret5d,
      ret30d:        ohlcv.ret30d,
      support:       ind.support,
      resistance:    ind.resistance,
      signal,
      confidence,
      verdict,
      indicators:    ind,
      score_detail:  scoreDetail,
      data_date:     ohlcv.lastDate,
    }
    return new Response(JSON.stringify({ success: true, data: payload }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })

  } catch (e) {
    console.error('analyze-ticker error:', e)
    return jsonErr(e.message ?? 'Internal error', 500)
  }
})


// ═══════════════════════════════════════════════════════════════════
// HELPER: Yahoo Finance OHLCV fetch
// ═══════════════════════════════════════════════════════════════════
interface OHLCVData {
  dates: string[]
  closes: number[]
  highs: number[]
  lows: number[]
  volumes: number[]
  lastClose: number
  prevClose: number
  changePct: number
  ret5d: number
  ret30d: number
  lastDate: string
  high52w: number
  low52w: number
}

async function fetchYahooOHLCV(symbol: string): Promise<OHLCVData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=1d&range=3mo&events=history`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 SmartTrading/1.0' },
    })
    if (!res.ok) return null
    const json = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return null

    const timestamps: number[]  = result.timestamp ?? []
    const q = result.indicators?.quote?.[0] ?? {}
    const rawCloses  = (q.close  ?? []).map((v: number | null) => v ?? 0)
    const rawHighs   = (q.high   ?? []).map((v: number | null) => v ?? 0)
    const rawLows    = (q.low    ?? []).map((v: number | null) => v ?? 0)
    const rawVolumes = (q.volume ?? []).map((v: number | null) => v ?? 0)

    // Filter null/zero entries
    const valid = timestamps
      .map((ts, i) => ({ ts, c: rawCloses[i], h: rawHighs[i], l: rawLows[i], v: rawVolumes[i] }))
      .filter(x => x.c > 0 && x.h > 0 && x.l > 0)

    if (valid.length < 20) return null

    const closes  = valid.map(x => x.c)
    const highs   = valid.map(x => x.h)
    const lows    = valid.map(x => x.l)
    const volumes = valid.map(x => x.v)
    const dates   = valid.map(x => new Date(x.ts * 1000).toISOString().slice(0, 10))


    const lastClose  = closes[closes.length - 1]
    const prevClose  = closes[closes.length - 2] ?? lastClose
    const changePct  = +((lastClose - prevClose) / prevClose * 100).toFixed(2)

    const close5dAgo  = closes[closes.length - 6]  ?? closes[0]
    const close30dAgo = closes[closes.length - 31] ?? closes[0]
    const ret5d  = +((lastClose - close5dAgo)  / close5dAgo  * 100).toFixed(2)
    const ret30d = +((lastClose - close30dAgo) / close30dAgo * 100).toFixed(2)

    const high52w = Math.max(...highs)
    const low52w  = Math.min(...lows)

    return {
      dates, closes, highs, lows, volumes,
      lastClose, prevClose, changePct,
      ret5d, ret30d,
      lastDate: dates[dates.length - 1],
      high52w, low52w,
    }
  } catch (_e) {
    return null
  }
}


// ═══════════════════════════════════════════════════════════════════
// HELPER: Technical Indicators (manual, no external lib)
// ═══════════════════════════════════════════════════════════════════
interface Indicators {
  rsi: number
  macdHist: number
  macdLine: number
  macdSignal: number
  ema20: number
  ema50: number
  bbUpper: number
  bbLower: number
  bbMid: number
  bbPct: number      // 0=at lower, 100=at upper, <20 = near support
  volRatio: number   // today vs 20d avg
  support: number
  resistance: number
  trend: 'UP' | 'DOWN' | 'SIDEWAYS'
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
  let avgGain = gains / period
  let avgLoss = losses / period
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return +(100 - 100 / (1 + rs)).toFixed(1)
}


function calcIndicators(ohlcv: OHLCVData): Indicators {
  const { closes, highs, lows, volumes } = ohlcv

  // RSI-14
  const rsi = closes.length >= 15 ? calcRSI(closes) : 50

  // EMA
  const ema20arr = ema(closes, 20)
  const ema50arr = ema(closes, 50)
  const ema20 = +(ema20arr[ema20arr.length - 1] ?? closes[closes.length - 1]).toFixed(2)
  const ema50 = +(ema50arr[ema50arr.length - 1] ?? closes[closes.length - 1]).toFixed(2)

  // MACD (12, 26, 9)
  const ema12arr = ema(closes, 12)
  const ema26arr = ema(closes, 26)
  const macdLineArr: number[] = []
  const offset = ema12arr.length - ema26arr.length
  for (let i = 0; i < ema26arr.length; i++) {
    macdLineArr.push(+(ema12arr[i + offset] - ema26arr[i]).toFixed(4))
  }
  const macdSignalArr = ema(macdLineArr, 9)
  const macdLine   = macdLineArr[macdLineArr.length - 1] ?? 0
  const macdSig    = macdSignalArr[macdSignalArr.length - 1] ?? 0
  const macdHist   = +(macdLine - macdSig).toFixed(4)

  // Bollinger Bands (20, 2)
  const bb20 = closes.slice(-20)
  const bbMidRaw = bb20.reduce((a, b) => a + b, 0) / 20
  const stddev = Math.sqrt(bb20.reduce((s, c) => s + (c - bbMidRaw) ** 2, 0) / 20)
  const bbMid   = +bbMidRaw.toFixed(2)
  const bbUpper = +(bbMidRaw + 2 * stddev).toFixed(2)
  const bbLower = +(bbMidRaw - 2 * stddev).toFixed(2)
  const lastClose = ohlcv.lastClose
  const bbPct = stddev > 0 ? +((lastClose - bbLower) / (bbUpper - bbLower) * 100).toFixed(1) : 50

  // Volume ratio
  const vol20avg = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20
  const volRatio = vol20avg > 0 ? +(volumes[volumes.length - 1] / vol20avg).toFixed(2) : 1

  // Support / Resistance (20-day low/high)
  const support    = +Math.min(...lows.slice(-20)).toFixed(0)
  const resistance = +Math.max(...highs.slice(-20)).toFixed(0)

  // Trend
  const trend: 'UP' | 'DOWN' | 'SIDEWAYS' =
    lastClose > ema20 && ema20 > ema50 ? 'UP' :
    lastClose < ema20 && ema20 < ema50 ? 'DOWN' : 'SIDEWAYS'

  return { rsi, macdHist, macdLine, macdSignal: macdSig, ema20, ema50,
    bbUpper, bbLower, bbMid, bbPct, volRatio, support, resistance, trend }
}


// ═══════════════════════════════════════════════════════════════════
// HELPER: Deterministic Scoring
// ═══════════════════════════════════════════════════════════════════
function calcScore(ind: Indicators, ohlcv: OHLCVData) {
  let score = 0
  const detail: Record<string, number> = {}

  // RSI
  if (ind.rsi < 35)      { score += 2; detail.rsi = +2 }
  else if (ind.rsi < 45) { score += 1; detail.rsi = +1 }
  else if (ind.rsi > 70) { score -= 2; detail.rsi = -2 }
  else if (ind.rsi > 60) { score -= 1; detail.rsi = -1 }
  else                   { detail.rsi = 0 }

  // MACD histogram direction
  if (ind.macdHist > 0)  { score += 1; detail.macd = +1 }
  else                   { score -= 1; detail.macd = -1 }

  // Trend (EMA20 vs EMA50)
  if (ind.trend === 'UP')   { score += 2; detail.trend = +2 }
  else if (ind.trend === 'DOWN') { score -= 2; detail.trend = -2 }
  else                          { detail.trend = 0 }

  // Bollinger position
  if (ind.bbPct < 20)  { score += 2; detail.bb = +2 }  // near support
  else if (ind.bbPct > 80) { score -= 1; detail.bb = -1 } // near resistance
  else                     { detail.bb = 0 }

  // Volume amplifier
  if (ind.volRatio >= 1.5) {
    score = score > 0 ? score + 1 : score - 1
    detail.vol = ind.volRatio >= 1.5 ? (score > 0 ? +1 : -1) : 0
  }

  // Day change momentum
  if (ohlcv.changePct > 1.5)      { score += 1; detail.mom = +1 }
  else if (ohlcv.changePct < -1.5) { score -= 1; detail.mom = -1 }
  else                              { detail.mom = 0 }

  // Signal determination
  const signal: 'BUY' | 'HOLD' | 'SELL' =
    score >= 3 ? 'BUY' : score <= -3 ? 'SELL' : 'HOLD'

  // Confidence (base 55, scale ±5 per point)
  let confidence = 55 + Math.abs(score) * 5
  confidence = Math.min(confidence, 92)
  if (signal === 'HOLD') confidence = Math.min(confidence, 70)

  return { signal, confidence, scoreDetail: { total: score, ...detail } }
}


// ═══════════════════════════════════════════════════════════════════
// HELPER: Groq AI — Hedge Fund Grade Analysis
// ═══════════════════════════════════════════════════════════════════
async function callGroq(
  ticker: string, name: string, sector: string,
  ind: Indicators, ohlcv: OHLCVData,
  signal: string, confidence: number,
): Promise<string> {
  const groqKey = Deno.env.get('GROQ_API_KEY')
  if (!groqKey) return ''

  const trendDesc = ind.trend === 'UP' ? 'uptrend (harga di atas EMA20 dan EMA50)' :
    ind.trend === 'DOWN' ? 'downtrend (harga di bawah EMA20 dan EMA50)' : 'sideways'
  const rsiDesc = ind.rsi < 35 ? 'oversold' : ind.rsi > 70 ? 'overbought' : 'netral'
  const macdDesc = ind.macdHist > 0 ? 'positif (momentum bullish)' : 'negatif (momentum bearish)'
  const bbDesc = ind.bbPct < 20 ? 'mendekati lower band (area support)' :
    ind.bbPct > 80 ? 'mendekati upper band (area resistance)' : `di tengah (${ind.bbPct}%)`
  const volDesc = ind.volRatio >= 2 ? `meledak ${ind.volRatio}x rata-rata 20 hari` :
    ind.volRatio >= 1.5 ? `tinggi ${ind.volRatio}x rata-rata` :
    ind.volRatio < 0.7 ? 'sepi/rendah dari rata-rata' : `normal ${ind.volRatio}x`

  const prompt = `Kamu adalah Direktur Riset sebuah hedge fund tier-1 Indonesia dengan 20 tahun pengalaman di BEI.
Tugas: Buat analisis SWING TRADE untuk saham ${ticker} (${name}, sektor ${sector}) berdasarkan data teknikal berikut.

DATA TEKNIKAL (REALTIME):
- Harga sekarang: Rp ${ohlcv.lastClose.toLocaleString('id-ID')} (${ohlcv.changePct > 0 ? '+' : ''}${ohlcv.changePct}% hari ini)
- Return 5 hari: ${ohlcv.ret5d > 0 ? '+' : ''}${ohlcv.ret5d}%
- Return 30 hari: ${ohlcv.ret30d > 0 ? '+' : ''}${ohlcv.ret30d}%
- RSI(14): ${ind.rsi} — ${rsiDesc}
- MACD histogram: ${ind.macdHist} — ${macdDesc}
- Trend: ${trendDesc}
- Posisi Bollinger: ${bbDesc}
- Volume hari ini: ${volDesc}
- Support 20H: Rp ${ind.support.toLocaleString('id-ID')}
- Resistance 20H: Rp ${ind.resistance.toLocaleString('id-ID')}
- 52W High: Rp ${ohlcv.high52w.toLocaleString('id-ID')} | 52W Low: Rp ${ohlcv.low52w.toLocaleString('id-ID')}
- Sinyal sistem: ${signal} (keyakinan: ${confidence}%)

INSTRUKSI FORMAT — wajib ikuti persis, 5 section, bahasa Indonesia awam:

[KONDISI PASAR]
2 kalimat: jelaskan kondisi teknikal saat ini dalam bahasa yang bisa dipahami awam. Terjemahkan indikator ke narasi manusia.

[THESIS]
2-3 kalimat: kenapa saham ini layak/tidak layak untuk swing trade saat ini. Sebutkan katalis utama.

[LEVEL ENTRY]
1-2 kalimat: range harga masuk yang disarankan berdasarkan support/Bollinger. Sebutkan angka spesifik.

[SKENARIO RISIKO]
2 skenario konkret yang bisa membuat thesis ini salah. Format: "Jika X terjadi, maka..."

[HORIZON]
1 kalimat: estimasi durasi swing trade dan target harga jika thesis berjalan sesuai rencana.`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 700,
        temperature: 0.4,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return ''
    const json = await res.json()
    return json.choices?.[0]?.message?.content?.trim() ?? ''
  } catch (_e) {
    return ''
  }
}

// ── Utility ──────────────────────────────────────────────────────────
function jsonErr(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
