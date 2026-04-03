import { useState, useEffect } from 'react'
import { TopBar, LiveDot } from '../components/TopBar'
import SignalCard from '../components/SignalCard'
import { getLatestSignals, getActiveMacroEvents } from '../lib/api'

const MARKET = [
  { label: 'IHSG',    value: '7.124',  chg: '-1.82%', neg: true },
  { label: 'USD/IDR', value: '16.340', chg: '+0.43%', neg: true },
  { label: 'Emas/gr', value: '1.892K', chg: '+0.71%', neg: false },
]

// Warna severity untuk macro event banner
const severityStyle = {
  HIGH:   { bg: '#2E0A0D', border: '#FF4455', color: '#FF4455', text: '#C47A7E' },
  MEDIUM: { bg: '#2E1A00', border: '#F5A623', color: '#F5A623', text: '#C4967A' },
  LOW:    { bg: '#0A1E14', border: '#00C896', color: '#00C896', text: '#7AC4A8' },
}

export default function HomeScreen() {
  const [signals,      setSignals]      = useState([])
  const [macroEvents,  setMacroEvents]  = useState([])
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    // Fetch signals + macro events paralel
    Promise.all([
      getLatestSignals(10).catch(() => []),
      getActiveMacroEvents().catch(() => []),
    ]).then(([sigs, events]) => {
      setSignals(sigs)
      setMacroEvents(events)
    }).finally(() => setLoading(false))
  }, [])

  // Tentukan apakah perlu banner defense (IHSG < -1% ATAU ada macro HIGH)
  const hasHighMacro = macroEvents.some(e => e.severity === 'HIGH')
  const showDefense  = true // TODO: connect ke live IHSG delta

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right={<><LiveDot />Live</>} />

      {/* ── Defense / Macro Banners ── */}
      {macroEvents.length > 0
        ? macroEvents.slice(0, 2).map((ev, i) => {
            const s = severityStyle[ev.severity] || severityStyle.MEDIUM
            return (
              <div key={i} style={{
                background: s.bg, borderLeft: `3px solid ${s.border}`,
                margin: i === 0 ? '12px 12px 4px' : '0 12px 4px',
                borderRadius: 8, padding: '9px 12px',
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: s.color, marginBottom: 2 }}>
                  {ev.event_label}
                </div>
                <div style={{ fontSize: 10, color: s.text, lineHeight: 1.5 }}>
                  {ev.affected_sectors?.length
                    ? `Sektor terdampak: ${ev.affected_sectors.join(', ')}`
                    : 'Perhatikan kondisi makro sebelum entry posisi baru.'}
                </div>
              </div>
            )
          })
        : showDefense && (
          <div style={{
            background: '#2D0A0D', borderLeft: '3px solid #FF4455',
            margin: 12, borderRadius: 8, padding: '10px 12px',
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: '#FF4455', marginBottom: 3 }}>
              Kondisi pasar waspada
            </div>
            <div style={{ fontSize: 11, color: '#C47A7E', lineHeight: 1.5 }}>
              IHSG turun 1.8% hari ini. Pertimbangkan menahan posisi baru sampai kondisi stabil.
            </div>
          </div>
        )
      }

      <div style={{ padding: '14px 16px 0' }}>

        {/* ── Market Pulse ── */}
        <div className="section-label">Market Pulse</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {MARKET.map(m => (
            <div key={m.label} className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500 }}>{m.value}</div>
              <div style={{
                fontFamily: 'var(--mono)', fontSize: 10, marginTop: 2,
                color: m.neg ? '#FF4455' : '#00C896',
              }}>{m.chg}</div>
            </div>
          ))}
        </div>

        {/* ── Top Picks ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Top Picks Hari Ini</div>
          {signals.length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              {signals.filter(s => s.signal_type === 'BUY').length} BUY ·{' '}
              {signals.filter(s => s.signal_type === 'SELL').length} SELL
            </span>
          )}
        </div>

        {loading
          ? <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
              Memuat sinyal...
            </div>
          : signals.length
            ? signals.map(s => <SignalCard key={s.id} signal={s} />)
            : <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                Belum ada sinyal hari ini
              </div>
        }
      </div>
    </div>
  )
}
