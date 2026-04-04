import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

async function fetchMarketData() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-market-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({}),
  })
  const json = await res.json()
  return json.success ? json.data : null
}

function fmtChg(pct) {
  if (pct == null) return '–'
  return `${pct > 0 ? '+' : ''}${Number(pct).toFixed(2)}%`
}
function fmtPrice(p, prefix = '') {
  if (p == null) return '–'
  return `${prefix}${Number(p).toLocaleString('en-US')}`
}

// Fear & Greed gauge SVG
function FearGreedGauge({ score, label }) {
  const angle = score != null ? -90 + (score / 100) * 180 : -90
  const col = score >= 75 ? '#00C896' : score >= 55 ? '#7BC97A' : score >= 45 ? '#F5A623' : score >= 25 ? '#E07A30' : '#FF4455'
  const r = 60, cx = 80, cy = 75
  const toRad = d => d * Math.PI / 180
  const arcX = (deg) => cx + r * Math.cos(toRad(deg - 180))
  const arcY = (deg) => cy - r * Math.sin(toRad(deg - 180))
  const needleX = cx + (r - 8) * Math.cos(toRad(angle - 180))
  const needleY = cy - (r - 8) * Math.sin(toRad(angle - 180))
  return (
    <svg viewBox="0 0 160 95" style={{ width: '100%', maxWidth: 200 }}>
      {/* track */}
      <path d={`M ${arcX(0)} ${arcY(0)} A ${r} ${r} 0 0 1 ${arcX(180)} ${arcY(180)}`}
        fill="none" stroke="#252D3D" strokeWidth="12" strokeLinecap="round"/>
      {/* fill */}
      {score != null && (
        <path d={`M ${arcX(0)} ${arcY(0)} A ${r} ${r} 0 0 1 ${arcX(score * 1.8)} ${arcY(score * 1.8)}`}
          fill="none" stroke={col} strokeWidth="12" strokeLinecap="round"/>
      )}
      {/* needle */}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY}
        stroke={col} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="4" fill={col}/>
      {/* labels */}
      <text x={cx} y={cy + 18} textAnchor="middle" fill={col}
        fontSize="16" fontWeight="bold" fontFamily="JetBrains Mono, monospace">
        {score ?? '–'}
      </text>
      <text x={cx} y={cy + 30} textAnchor="middle" fill={col} fontSize="7.5">
        {label ?? 'Loading...'}
      </text>
    </svg>
  )
}

function CryptoRow({ name, price, changePct, prefix = '$' }) {
  const pos = (changePct ?? 0) >= 0
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
      padding:'10px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ fontSize:13, fontWeight:600 }}>{name}</span>
      <div style={{ textAlign:'right' }}>
        <div style={{ fontFamily:'var(--mono)', fontSize:14, fontWeight:700 }}>
          {fmtPrice(price, prefix)}
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:11,
          color: pos ? '#00C896' : '#FF4455' }}>{fmtChg(changePct)}</div>
      </div>
    </div>
  )
}

export default function GlobalPulseScreen() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [lastUpd, setLastUpd] = useState(null)

  const load = () => {
    setLoading(true); setError(null)
    fetchMarketData()
      .then(d => { setData(d); setLastUpd(new Date()) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const fng   = data?.fear_greed
  const btc   = data?.btc
  const eth   = data?.eth
  const ihsg  = data?.ihsg
  const usdidr = data?.usdidr
  const emas  = data?.emas

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Global Pulse" />

      {/* Header + refresh */}
      <div style={{ padding:'10px 16px 6px', display:'flex',
        justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ fontSize:10, color:'var(--muted)' }}>
          {loading ? 'Memuat...' : lastUpd ? `Update: ${lastUpd.toLocaleTimeString('id-ID')}` : ''}
          {data?.cached ? ' · cache' : ''}
        </span>
        <button onClick={load} disabled={loading}
          style={{ background:'transparent', border:'1px solid var(--border)',
            color:'var(--muted)', borderRadius:6, padding:'4px 10px',
            cursor:'pointer', fontSize:10 }}>
          {loading ? '⏳' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ margin:'8px 16px', padding:10, background:'#2E0A0D',
          border:'1px solid #FF4455', borderRadius:8, fontSize:11, color:'#C47A7E' }}>
          ⚠️ Gagal memuat data: {error}
        </div>
      )}

      <div style={{ padding:'0 16px' }}>

        {/* ── Fear & Greed ── */}
        <div className="card" style={{ marginBottom:12, textAlign:'center', paddingTop:16 }}>
          <div className="section-label" style={{ textAlign:'left' }}>Fear & Greed Index — Kripto Global</div>
          <div style={{ display:'flex', justifyContent:'center', margin:'8px 0 0' }}>
            <FearGreedGauge score={fng?.score} label={fng?.label} />
          </div>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:9,
            color:'var(--muted)', padding:'0 8px 8px', marginTop:4 }}>
            <span>Extreme Fear</span><span>Fear</span>
            <span>Netral</span><span>Greed</span><span>Extreme Greed</span>
          </div>
        </div>

        {/* ── Crypto Prices ── */}
        <div className="card" style={{ marginBottom:12 }}>
          <div className="section-label">Harga Kripto (USD)</div>
          <CryptoRow name="Bitcoin (BTC)"  price={btc?.price}  changePct={btc?.changePct}  />
          <CryptoRow name="Ethereum (ETH)" price={eth?.price}  changePct={eth?.changePct}  />
        </div>

        {/* ── Indikator Makro IDX ── */}
        <div className="card" style={{ marginBottom:12 }}>
          <div className="section-label">Indikator Makro Indonesia</div>
          {[
            ['IHSG',    ihsg?.price  ? ihsg.price.toLocaleString('id-ID',{maximumFractionDigits:0})  : '–', ihsg?.changePct],
            ['USD/IDR', usdidr?.price ? usdidr.price.toLocaleString('id-ID',{maximumFractionDigits:0}) : '–', usdidr?.changePct],
            ['Emas (Rp/oz)', emas?.price ? `$${emas.price.toLocaleString('en-US',{maximumFractionDigits:0})}` : '–', emas?.changePct],
          ].map(([lbl, val, chg]) => (
            <div key={lbl} style={{ display:'flex', justifyContent:'space-between',
              alignItems:'center', padding:'9px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontSize:12 }}>{lbl}</span>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600 }}>{val}</div>
                <div style={{ fontFamily:'var(--mono)', fontSize:10,
                  color: chg >= 0 ? '#00C896' : '#FF4455' }}>{fmtChg(chg)}</div>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
