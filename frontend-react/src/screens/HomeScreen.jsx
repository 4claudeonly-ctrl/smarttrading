import { useState, useEffect } from 'react'
import { TopBar, LiveDot } from '../components/TopBar'
import SignalCard from '../components/SignalCard'
import { getLatestSignals, getActiveMacroEvents } from '../lib/api'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const severityStyle = {
  HIGH:   { bg: '#2E0A0D', border: '#FF4455', color: '#FF4455', text: '#C47A7E' },
  MEDIUM: { bg: '#2E1A00', border: '#F5A623', color: '#F5A623', text: '#C4967A' },
  LOW:    { bg: '#0A1E14', border: '#00C896', color: '#00C896', text: '#7AC4A8' },
}

async function fetchMarketData() {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-market-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({}),
  })
  const json = await res.json()
  return json.success ? json.data : null
}

function fmt(val, decimals = 2) {
  if (val == null) return '–'
  return typeof val === 'number' ? val.toFixed(decimals) : val
}
function fmtChg(pct) {
  if (pct == null) return '–'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}

export default function HomeScreen() {
  const [signals,     setSignals]     = useState([])
  const [macroEvents, setMacroEvents] = useState([])
  const [market,      setMarket]      = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [mktLoading,  setMktLoading]  = useState(true)

  useEffect(() => {
    Promise.all([
      getLatestSignals(10).catch(() => []),
      getActiveMacroEvents().catch(() => []),
    ]).then(([sigs, events]) => {
      setSignals(sigs); setMacroEvents(events)
    }).finally(() => setLoading(false))

    fetchMarketData()
      .then(d => setMarket(d))
      .catch(() => {})
      .finally(() => setMktLoading(false))
  }, [])

  // Defense banner logic: IHSG turun > 1% ATAU ada HIGH macro event
  const ihsgChg    = market?.ihsg?.changePct ?? 0
  const hasHighMacro = macroEvents.some(e => e.severity === 'HIGH')
  const showDefense  = ihsgChg < -1 || hasHighMacro

  // Market bar data dari live API
  const MARKET = market ? [
    {
      label: 'IHSG',
      value: market.ihsg?.price ? market.ihsg.price.toLocaleString('id-ID', {maximumFractionDigits: 0}) : '–',
      chg:   fmtChg(market.ihsg?.changePct),
      neg:   (market.ihsg?.changePct ?? 0) < 0,
    },
    {
      label: 'USD/IDR',
      value: market.usdidr?.price ? market.usdidr.price.toLocaleString('id-ID', {maximumFractionDigits: 0}) : '–',
      chg:   fmtChg(market.usdidr?.changePct),
      neg:   (market.usdidr?.changePct ?? 0) > 0, // IDR melemah = negatif
    },
    {
      label: 'Emas/oz',
      value: market.emas?.price ? `$${market.emas.price.toLocaleString('en-US', {maximumFractionDigits: 0})}` : '–',
      chg:   fmtChg(market.emas?.changePct),
      neg:   (market.emas?.changePct ?? 0) < 0,
    },
  ] : [
    { label: 'IHSG',    value: '–', chg: '–', neg: false },
    { label: 'USD/IDR', value: '–', chg: '–', neg: false },
    { label: 'Emas/oz', value: '–', chg: '–', neg: false },
  ]

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right={<><LiveDot />Live</>} />

      {/* ── Defense Banner ── */}
      {showDefense && !macroEvents.length && (
        <div style={{ background:'#2E0A0D', borderLeft:'3px solid #FF4455',
          margin:'12px 12px 4px', padding:'10px 12px', borderRadius:8 }}>
          <div style={{ color:'#FF4455', fontSize:11, fontWeight:700, marginBottom:3 }}>
            ⚠️ DEFENSE MODE
          </div>
          <div style={{ color:'#C47A7E', fontSize:11, lineHeight:1.6 }}>
            IHSG turun {Math.abs(ihsgChg).toFixed(2)}%. Hindari posisi baru, prioritaskan lindung nilai.
          </div>
        </div>
      )}

      {/* ── Macro Event Banners ── */}
      {macroEvents.slice(0, 2).map((ev, i) => {
        const s = severityStyle[ev.severity] || severityStyle.MEDIUM
        return (
          <div key={i} style={{ background:s.bg, borderLeft:`3px solid ${s.border}`,
            margin: i===0 ? '12px 12px 4px' : '0 12px 4px',
            padding:'10px 12px', borderRadius:8 }}>
            <div style={{ color:s.color, fontSize:11, fontWeight:700, marginBottom:3 }}>
              {ev.severity === 'HIGH' ? '🚨' : ev.severity === 'MEDIUM' ? '⚡' : 'ℹ️'} {ev.title}
            </div>
            <div style={{ color:s.text, fontSize:11, lineHeight:1.6 }}>{ev.description}</div>
          </div>
        )
      })}

      {/* ── Market Ticker ── */}
      <div style={{ display:'flex', gap:0, padding:'10px 12px 6px',
        overflowX:'auto', borderBottom:'1px solid var(--border)' }}>
        {MARKET.map(({ label, value, chg, neg }) => (
          <div key={label} style={{ flex:'0 0 auto', marginRight:20 }}>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:2, textTransform:'uppercase',
              letterSpacing:'0.08em' }}>{label}</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:13, fontWeight:600,
              color: mktLoading ? 'var(--muted)' : 'var(--text)' }}>{value}</div>
            <div style={{ fontFamily:'var(--mono)', fontSize:10,
              color: neg ? '#FF4455' : '#00C896' }}>{chg}</div>
          </div>
        ))}
      </div>

      {/* ── Signal Cards ── */}
      <div style={{ padding:'10px 12px 0' }}>
        <div style={{ fontSize:10, color:'var(--muted)', fontWeight:600,
          letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:8 }}>
          Top Picks Hari Ini
        </div>

        {loading ? (
          <div style={{ padding:'40px 0', textAlign:'center', color:'var(--muted)', fontSize:12 }}>
            ⏳ Memuat sinyal...
          </div>
        ) : signals.length === 0 ? (
          <div style={{ padding:'40px 0', textAlign:'center' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📡</div>
            <div style={{ color:'var(--muted)', fontSize:12, marginBottom:4 }}>Belum ada sinyal hari ini</div>
            <div style={{ color:'var(--muted)', fontSize:10, opacity:0.6, lineHeight:1.7 }}>
              Signal Engine berjalan setiap 15 menit<br/>saat jam bursa aktif (09:00–15:45 WIB)
            </div>
          </div>
        ) : (
          signals.map(sig => <SignalCard key={sig.id ?? sig.ticker} signal={sig} />)
        )}
      </div>
    </div>
  )
}
