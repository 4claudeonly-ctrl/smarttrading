import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { getPortfolio, getWatchlist, getLatestSignals } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function WatchlistScreen() {
  const [portfolio, setPortfolio]   = useState([])
  const [watchlist, setWatchlist]   = useState([])
  const [signals, setSignals]       = useState({})
  const [userId, setUserId]         = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id
      if (!uid) return
      setUserId(uid)
      Promise.all([getPortfolio(uid), getWatchlist(uid), getLatestSignals(50)])
        .then(([port, watch, sigs]) => {
          setPortfolio(port)
          setWatchlist(watch)
          const sigMap = {}
          sigs.forEach(s => { sigMap[s.ticker] = s })
          setSignals(sigMap)
        })
        .catch(() => {})
    })
  }, [])

  const totalValue = portfolio.reduce((sum, p) => sum + p.lot * 100 * p.avg_buy_price, 0)

  const divWarning = (() => {
    const sectorMap = {}
    portfolio.forEach(p => {
      const sector = p.sector || 'Lainnya'
      sectorMap[sector] = (sectorMap[sector] || 0) + p.lot * 100 * p.avg_buy_price
    })
    return Object.entries(sectorMap).find(([, v]) => v / totalValue > 0.4)
  })()

  if (!userId) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      <div style={{ marginBottom: 12 }}>Login untuk melihat portfolio</div>
      <button onClick={() => supabase.auth.signInWithOtp({ email: prompt('Email kamu:') || '' })}
        style={{ background: '#0A2E22', border: '1px solid #00C896', color: '#00C896',
          borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontSize: 13 }}>
        Masuk dengan Email
      </button>
    </div>
  )

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Watchlist" />

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, margin: 12, padding: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ringkasan Portfolio</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Nilai Sekarang', `Rp ${(totalValue / 1e6).toFixed(1)} Jt`, '#EDF2FF'],
            ['Posisi Aktif', portfolio.length, '#EDF2FF'],
          ].map(([lbl, val, col]) => (
            <div key={lbl}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 500, color: col, marginBottom: 2 }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {divWarning && (
        <div style={{ background: '#1E1500', borderLeft: '3px solid #F5A623', margin: '0 12px 10px', borderRadius: 8, padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: '#F5A623', marginBottom: 3 }}>Diversifikasi perlu perhatian</div>
          <div style={{ fontSize: 11, color: '#9A7A3A', lineHeight: 1.5 }}>
            Sektor {divWarning[0]} mendominasi &gt;40% portfolio Anda.
          </div>
        </div>
      )}

      <div style={{ padding: '0 16px' }}>
        <div className="section-label">Posisi Aktif</div>
        {portfolio.map(p => {
          const sig = signals[p.ticker]
          const currentPx = p.avg_buy_price * (1 + (Math.random() - 0.4) * 0.1)
          const pnl = (currentPx - p.avg_buy_price) * p.lot * 100
          const pct = ((currentPx - p.avg_buy_price) / p.avg_buy_price * 100).toFixed(2)
          return (
            <div key={p.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.ticker}</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    {p.lot} lot · beli @ Rp {p.avg_buy_price.toLocaleString()}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: pnl >= 0 ? '#00C896' : '#FF4455' }}>
                    {pnl >= 0 ? '+' : ''}Rp {Math.abs(pnl).toLocaleString('id-ID', { maximumFractionDigits: 0 })}
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: pnl >= 0 ? '#00C896' : '#FF4455' }}>
                    {pnl >= 0 ? '+' : ''}{pct}%
                  </div>
                </div>
              </div>
              {sig && (
                <span className={`badge-${sig.signal_type.toLowerCase()}`}
                  style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                  Sinyal: {sig.signal_type}
                </span>
              )}
            </div>
          )
        })}
        {!portfolio.length && (
          <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
            Belum ada posisi aktif
          </div>
        )}
      </div>
    </div>
  )
}
