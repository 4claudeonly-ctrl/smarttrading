import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { getSignalsByTicker, getNewsByTicker } from '../lib/api'

const SUPABASE_URL = 'https://yflisnaaeqfzeyzmgymm.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlmbGlzbmFhZXFmemV5em1neW1tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyMzYyMzMsImV4cCI6MjA5MDgxMjIzM30.UKP1nDbaSulsKdki8E4Ig1U-ZNu5hDRe6vOwczduw_w'

async function fetchEmitenData(ticker) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/fetch-emiten`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON}`,
    },
    body: JSON.stringify({ ticker }),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Emiten tidak ditemukan')
  return json.data
}

function fmt(num, prefix = 'Rp ') {
  if (!num) return '-'
  if (num >= 1e12) return `${prefix}${(num / 1e12).toFixed(1)}T`
  if (num >= 1e9) return `${prefix}${(num / 1e9).toFixed(1)}M`
  return `${prefix}${num.toLocaleString('id-ID')}`
}

export default function DeepDiveScreen() {
  const { ticker: paramTicker } = useParams()
  const navigate = useNavigate()
  const [query, setQuery]       = useState(paramTicker || '')
  const [emiten, setEmiten]     = useState(null)
  const [signals, setSignals]   = useState([])
  const [news, setNews]         = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const doSearch = async (searchQuery) => {
    const q = searchQuery.trim().toUpperCase()
    if (!q) return
    setLoading(true)
    setError(null)
    setEmiten(null)
    setSignals([])
    setNews([])
    try {
      // 1. Fetch dari Yahoo Finance via Edge Function → simpan ke DB
      const data = await fetchEmitenData(q)
      setEmiten(data)
      navigate(`/deepdive/${q}`, { replace: true })
      // 2. Fetch signals + news dari DB (mungkin kosong, itu normal)
      const [sigs, nws] = await Promise.all([
        getSignalsByTicker(q).catch(() => []),
        getNewsByTicker(q).catch(() => []),
      ])
      setSignals(sigs)
      setNews(nws)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Auto-load jika ada ticker di URL
  useEffect(() => {
    if (paramTicker) doSearch(paramTicker)
  }, [])

  const handleKey = (e) => {
    if (e.key === 'Enter') doSearch(query)
  }

  const changePct = emiten?.change_pct
  const changeColor = changePct > 0 ? '#00C896' : changePct < 0 ? '#FF4455' : 'var(--muted)'

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Deep Dive" />

      {/* Search Bar */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value.toUpperCase())}
          onKeyDown={handleKey}
          placeholder="Ketik ticker IDX lalu tekan Enter..."
          style={{
            flex: 1, background: '#161B25', border: '1px solid var(--border)',
            borderRadius: 8, padding: '9px 12px', color: 'var(--text)',
            fontSize: 13, outline: 'none', fontFamily: 'var(--mono)',
            letterSpacing: '0.05em',
          }}
        />
        <button
          onClick={() => doSearch(query)}
          disabled={loading}
          style={{
            background: '#0A2E22', border: '1px solid #00C896', color: '#00C896',
            borderRadius: 8, padding: '9px 16px', cursor: 'pointer', fontSize: 12,
            fontWeight: 600, opacity: loading ? 0.6 : 1,
          }}>
          {loading ? '...' : 'Cari'}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: '#00C896', fontSize: 13, marginBottom: 8 }}>🔍 Fetching data dari Yahoo Finance...</div>
          <div style={{ color: 'var(--muted)', fontSize: 11 }}>Menyimpan ke database...</div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ margin: 16, padding: 14, background: '#2E0A0D', border: '1px solid #FF4455', borderRadius: 8 }}>
          <div style={{ color: '#FF4455', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Emiten tidak ditemukan</div>
          <div style={{ color: '#C47A7E', fontSize: 11 }}>{error}</div>
          <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 6 }}>
            Pastikan kode ticker benar (contoh: BBCA, TLKM, GOTO)
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !emiten && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Ketik kode saham IDX lalu tekan Enter<br />
          <span style={{ fontSize: 11, opacity: 0.6 }}>Contoh: BBCA, TLKM, ASII, GOTO</span>
        </div>
      )}

      {/* Emiten Detail */}
      {emiten && !loading && (
        <div style={{ padding: '14px 16px' }}>

          {/* Header kartu harga */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, letterSpacing: '0.05em' }}>
                  {emiten.ticker}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2, maxWidth: 200 }}>
                  {emiten.name}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600 }}>
                  {emiten.current_price ? `Rp ${emiten.current_price.toLocaleString('id-ID')}` : '-'}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: changeColor, marginTop: 2 }}>
                  {changePct ? `${changePct > 0 ? '+' : ''}${changePct}%` : '-'}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 10 }}>
              {[
                ['Sektor', emiten.sector || '-'],
                ['Market Cap', fmt(emiten.market_cap, '')],
                ['P/E Ratio', emiten.pe_ratio ? emiten.pe_ratio.toFixed(1) : '-'],
                ['Vol Hari Ini', fmt(emiten.volume, '')],
                ['52W High', emiten.week_52_high ? `Rp ${emiten.week_52_high.toLocaleString('id-ID')}` : '-'],
                ['52W Low', emiten.week_52_low ? `Rp ${emiten.week_52_low.toLocaleString('id-ID')}` : '-'],
              ].map(([label, val]) => (
                <div key={label} style={{ background: '#0B0D12', borderRadius: 6, padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500 }}>{val}</div>
                </div>
              ))}
            </div>
            {emiten.dividend_yield && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#00C896' }}>
                💰 Dividen yield: {emiten.dividend_yield}%
              </div>
            )}
          </div>

          {/* Deskripsi perusahaan */}
          {emiten.description && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div className="section-label" style={{ marginBottom: 8 }}>Tentang Perusahaan</div>
              <div style={{ fontSize: 11, color: '#C8D4E8', lineHeight: 1.7 }}>
                {emiten.description.length > 300
                  ? emiten.description.slice(0, 300) + '...'
                  : emiten.description}
              </div>
            </div>
          )}

          {/* Sinyal */}
          <div className="section-label">Sinyal AI Terbaru</div>
          {signals.length === 0
            ? <div style={{ color: 'var(--muted)', fontSize: 12, padding: '12px 0', textAlign: 'center', background: 'var(--surface)', borderRadius: 8, marginBottom: 12 }}>
                Belum ada sinyal untuk {emiten.ticker}.<br />
                <span style={{ fontSize: 10, opacity: 0.7 }}>Sinyal digenerate otomatis saat market hours.</span>
              </div>
            : signals.map(s => (
              <div key={s.id} className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    {new Date(s.created_at).toLocaleDateString('id-ID')}
                  </span>
                  <span className={`badge-${s.signal_type?.toLowerCase()}`}
                    style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                    {s.signal_type}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.6 }}>{s.verdict_text}</div>
              </div>
            ))
          }

          {/* Berita */}
          {news.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 14 }}>Berita Terkait</div>
              {news.map(n => (
                <div key={n.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.5, marginBottom: 4 }}>{n.title}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{n.source}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                      background: n.sentiment === 'POSITIVE' ? '#0A2E22' : n.sentiment === 'NEGATIVE' ? '#2E0A0D' : '#1E1500',
                      color: n.sentiment === 'POSITIVE' ? '#00C896' : n.sentiment === 'NEGATIVE' ? '#FF4455' : '#F5A623',
                    }}>{n.sentiment}</span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
