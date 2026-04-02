import { useState, useEffect } from 'react'
import { TopBar, LiveDot } from '../components/TopBar'
import SignalCard from '../components/SignalCard'
import { getLatestSignals } from '../lib/api'

const MARKET = [
  { label: 'IHSG', value: '7.124', chg: '-1.82%', neg: true },
  { label: 'USD/IDR', value: '16.340', chg: '+0.43%', neg: true },
  { label: 'Emas/gr', value: '1.892K', chg: '+0.71%', neg: false },
]

export default function HomeScreen() {
  const [signals, setSignals] = useState([])
  const [loading, setLoading] = useState(true)
  const [defense, setDefense] = useState(true)

  useEffect(() => {
    getLatestSignals(10)
      .then(setSignals)
      .catch(() => setSignals([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right={<><LiveDot />Live</>} />

      {defense && (
        <div style={{ background: '#2D0A0D', borderLeft: '3px solid #FF4455', margin: 12, borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: '#FF4455', marginBottom: 3 }}>Kondisi pasar waspada</div>
          <div style={{ fontSize: 11, color: '#C47A7E', lineHeight: 1.5 }}>
            IHSG turun 1.8% hari ini. Pertimbangkan menahan posisi baru sampai kondisi stabil.
          </div>
        </div>
      )}

      <div style={{ padding: '14px 16px 0' }}>
        <div className="section-label">Market Pulse</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {MARKET.map(m => (
            <div key={m.label} className="card" style={{ padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{m.label}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 500 }}>{m.value}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: m.neg ? '#FF4455' : '#00C896', marginTop: 2 }}>{m.chg}</div>
            </div>
          ))}
        </div>

        <div className="section-label">Top Picks Hari Ini</div>
        {loading
          ? <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Memuat sinyal...</div>
          : signals.length
            ? signals.map(s => <SignalCard key={s.id} signal={s} />)
            : <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Belum ada sinyal hari ini</div>
        }
      </div>
    </div>
  )
}
