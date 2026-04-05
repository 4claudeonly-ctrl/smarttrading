import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { getLatestSignals } from '../lib/api'
import { supabase } from '../lib/supabase'

// ── Auth Modal ────────────────────────────────────────────────────────────────
function AuthModal({ onClose }) {
  const [email,   setEmail]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const handleSend = async () => {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Masukkan alamat email yang valid'); return
    }
    setLoading(true); setError('')
    const { error: err } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { emailRedirectTo: window.location.origin }
    })
    setLoading(false)
    if (err) { setError('Gagal kirim email: ' + err.message); return }
    setSent(true)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.75)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 20
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#161B25', border: '1px solid var(--border)',
        borderRadius: 16, padding: 24, width: '100%', maxWidth: 360,
      }}>
        {!sent ? (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>Masuk ke SmartTrading</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 20 }}>
              Kami kirimkan <strong style={{color:'#00C896'}}>Magic Link</strong> ke email kamu.
              Klik link itu dan kamu langsung masuk — tanpa password.
            </div>

            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Alamat Email</div>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="contoh@gmail.com"
              autoFocus
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0B0D12', border: '1px solid var(--border)',
                borderRadius: 8, padding: '10px 12px',
                color: 'var(--text)', fontSize: 14, outline: 'none',
                marginBottom: error ? 8 : 16,
              }}
            />
            {error && (
              <div style={{ fontSize: 11, color: '#FF4455', marginBottom: 12 }}>{error}</div>
            )}

            <button
              onClick={handleSend}
              disabled={loading}
              style={{
                width: '100%', background: loading ? '#0A1E14' : '#0A2E22',
                border: '1px solid #00C896', color: '#00C896',
                borderRadius: 8, padding: '11px 0', cursor: loading ? 'default' : 'pointer',
                fontSize: 13, fontWeight: 700, marginBottom: 12,
              }}>
              {loading ? 'Mengirim...' : 'Kirim Magic Link'}
            </button>

            <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6, textAlign: 'center' }}>
              Belum punya akun? Tidak perlu daftar.<br/>
              Masukkan email baru = akun dibuat otomatis.
            </div>
          </>
        ) : (
          <>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📧</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Cek Email Kamu!</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                Magic Link sudah dikirim ke<br/>
                <strong style={{ color: '#00C896' }}>{email}</strong><br/><br/>
                Buka email tersebut dan klik linknya.<br/>
                Kamu akan langsung masuk ke SmartTrading.
              </div>
              <div style={{
                marginTop: 16, padding: '8px 12px',
                background: '#0B0D12', borderRadius: 8, fontSize: 11, color: 'var(--muted)'
              }}>
                Tidak menerima email? Cek folder Spam,<br/>atau{' '}
                <span
                  onClick={() => { setSent(false); setError('') }}
                  style={{ color: '#00C896', cursor: 'pointer', textDecoration: 'underline' }}>
                  kirim ulang
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function WatchlistScreen() {
  const [portfolio, setPortfolio] = useState([])
  const [signals,   setSignals]   = useState({})
  const [userId,    setUserId]    = useState(null)
  const [userEmail, setUserEmail] = useState('')
  const [loading,   setLoading]   = useState(true)
  const [showAuth,  setShowAuth]  = useState(false)

  useEffect(() => {
    // Cek session (termasuk setelah klik magic link dari email)
    supabase.auth.getSession().then(({ data }) => {
      const user = data?.session?.user
      if (user) {
        setUserId(user.id)
        setUserEmail(user.email ?? '')
        getLatestSignals(50).then(sigs => {
          const sigMap = {}
          sigs.forEach(s => { sigMap[s.ticker] = s })
          setSignals(sigMap)
        }).catch(() => {})
      }
    }).catch(() => {}).finally(() => setLoading(false))

    // Listen perubahan auth state (termasuk login dari magic link)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user
      if (user) {
        setUserId(user.id)
        setUserEmail(user.email ?? '')
        setShowAuth(false)
      } else {
        setUserId(null)
        setUserEmail('')
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setPortfolio([])
    setSignals({})
  }

  const totalValue = portfolio.reduce((sum, p) => sum + p.lot * 100 * p.avg_buy_price, 0)

  return (
    <div style={{ paddingBottom: 80 }}>
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      <TopBar right="Watchlist" />

      {/* ── Portfolio Summary ── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, margin: 12, padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Ringkasan Portfolio
          </div>
          {userId && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: '#00C896' }}>● {userEmail}</span>
              <button onClick={handleLogout} style={{
                background: 'none', border: '1px solid #252D3D', color: 'var(--muted)',
                borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 10,
              }}>Keluar</button>
            </div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            ['Nilai Sekarang', `Rp ${portfolio.length ? (totalValue/1e6).toFixed(1)+' Jt' : '0'}`],
            ['Posisi Aktif', portfolio.length],
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

        {/* ── Empty state ── */}
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
            Belum ada posisi aktif
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 16 }}>
            Tambah posisi dari sinyal di tab Home<br/>untuk tracking P&amp;L otomatis
          </div>

          {!userId && !loading && (
            <button
              onClick={() => setShowAuth(true)}
              style={{
                background: '#0A2E22', border: '1px solid #00C896',
                color: '#00C896', borderRadius: 8, padding: '11px 24px',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>
              Masuk / Daftar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
