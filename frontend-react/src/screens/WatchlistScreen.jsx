import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { getLatestSignals } from '../lib/api'
import { supabase } from '../lib/supabase'

export default function WatchlistScreen() {
  const [portfolio, setPortfolio]   = useState([])
  const [signals,   setSignals]     = useState({})
  const [userId,    setUserId]      = useState(null)
  const [loading,   setLoading]     = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const uid = data?.session?.user?.id
      setUserId(uid || null)
      if (uid) {
        Promise.all([getLatestSignals(50)])
          .then(([sigs]) => {
            const sigMap = {}
            sigs.forEach(s => { sigMap[s.ticker] = s })
            setSignals(sigMap)
          })
          .catch(() => {})
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const totalValue = portfolio.reduce((sum, p) => sum + p.lot * 100 * p.avg_buy_price, 0)

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Watchlist" />

      {/* Portfolio Summary */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, margin: 12, padding: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ringkasan Portfolio</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Nilai Sekarang', portfolio.length ? `Rp ${(totalValue/1e6).toFixed(1)} Jt` : 'Rp 0', '#EDF2FF'],
            ['Posisi Aktif', portfolio.length, '#EDF2FF'],
          ].map(([lbl, val]) => (
            <div key={lbl}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 500, color: '#EDF2FF', marginBottom: 2 }}>{val}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{lbl}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '0 16px' }}>
        <div className="section-label">Posisi Aktif</div>

        {/* Empty state */}
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            Belum ada posisi aktif
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
            Tambah posisi dari sinyal di tab Home<br/>untuk tracking P&amp;L otomatis
          </div>
          {!userId && (
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => {
                  const email = window.prompt('Masukkan email kamu:')
                  if (email) supabase.auth.signInWithOtp({ email })
                }}
                style={{
                  background: '#0A2E22', border: '1px solid #00C896',
                  color: '#00C896', borderRadius: 8, padding: '10px 20px',
                  cursor: 'pointer', fontSize: 13
                }}>
                Login untuk simpan portfolio
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
