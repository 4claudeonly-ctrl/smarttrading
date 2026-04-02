import { TopBar, LiveDot } from '../components/TopBar'
import { getGlobalNews } from '../lib/api'
import { useState, useEffect } from 'react'

const SCORE = 47

export default function GlobalPulseScreen() {
  const [news, setNews] = useState([])
  useEffect(() => { getGlobalNews(6).then(setNews).catch(() => {}) }, [])

  const pct    = SCORE / 100
  const arcLen = 251.3
  const offset = arcLen * (1 - pct)
  const needle = -90 + pct * 180
  const fgCol  = SCORE <= 25 ? '#FF4455' : SCORE <= 45 ? '#FF8C42' : SCORE <= 55 ? '#F5A623' : '#00C896'
  const fgLbl  = SCORE <= 25 ? 'Extreme Fear' : SCORE <= 45 ? 'Fear' : SCORE <= 55 ? 'Neutral' : SCORE <= 75 ? 'Greed' : 'Extreme Greed'

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right={<><LiveDot />Global Pulse</>} />

      <div style={{ padding: '14px 16px 0' }}>
        <div className="section-label">Kripto Utama</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { sym: 'BTC', price: '$82.340', chg: '+2.14%', pos: true, whale: 'Netral' },
            { sym: 'ETH', price: '$1.812',  chg: '-1.38%', pos: false, whale: 'Jual'  },
          ].map(c => (
            <div key={c.sym} className="card">
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: c.pos ? '#00C896' : '#FF4455', marginBottom: 4 }}>{c.sym}/USD</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 17, fontWeight: 500, color: c.pos ? '#00C896' : '#FF4455' }}>{c.price}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: c.pos ? '#00C896' : '#FF4455', margin: '3px 0 8px' }}>{c.chg}</div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8, fontSize: 10, color: 'var(--muted)' }}>
                Sinyal whale: <span style={{ color: c.whale === 'Jual' ? '#FF4455' : '#F5A623' }}>{c.whale}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="section-label">Fear &amp; Greed Index</div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingBottom: 14 }}>
          <svg width="200" height="110" viewBox="0 0 200 110">
            <defs>
              <linearGradient id="gGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FF4455" />
                <stop offset="50%" stopColor="#F5A623" />
                <stop offset="100%" stopColor="#00C896" />
              </linearGradient>
            </defs>
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#252D3D" strokeWidth="14" strokeLinecap="round" />
            <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="url(#gGrad)" strokeWidth="14" strokeLinecap="round"
              strokeDasharray={arcLen} strokeDashoffset={offset} />
            <line x1="100" y1="100" x2="100" y2="28" stroke="#EDF2FF" strokeWidth="2.5" strokeLinecap="round"
              transform={`rotate(${needle}, 100, 100)`} />
            <circle cx="100" cy="100" r="5" fill="#EDF2FF" />
          </svg>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 600, color: fgCol }}>{SCORE}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{fgLbl}</div>
        </div>

        <div className="section-label" style={{ marginTop: 14 }}>Berita Global</div>
        {news.length
          ? news.map(n => (
            <div key={n.id} className="card">
              <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.5, marginBottom: 5 }}>{n.title}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{n.source}</span>
                <span style={{
                  fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                  background: n.sentiment === 'POSITIVE' ? '#0A2E22' : n.sentiment === 'NEGATIVE' ? '#2E0A0D' : '#1E1500',
                  color: n.sentiment === 'POSITIVE' ? '#00C896' : n.sentiment === 'NEGATIVE' ? '#FF4455' : '#F5A623',
                }}>{n.sentiment}</span>
              </div>
            </div>
          ))
          : <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Memuat berita global...</div>
        }
      </div>
    </div>
  )
}
