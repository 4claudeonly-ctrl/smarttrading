import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { searchEmiten, getSignalsByTicker, getNewsByTicker } from '../lib/api'

export default function DeepDiveScreen() {
  const { ticker: paramTicker } = useParams()
  const navigate = useNavigate()
  const [query, setQuery]       = useState('')
  const [suggestions, setSugg]  = useState([])
  const [ticker, setTicker]     = useState(paramTicker || null)
  const [signals, setSignals]   = useState([])
  const [news, setNews]         = useState([])
  const [loading, setLoading]   = useState(false)

  useEffect(() => {
    if (!query.trim()) { setSugg([]); return }
    const t = setTimeout(() => {
      searchEmiten(query).then(setSugg).catch(() => setSugg([]))
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!ticker) return
    setLoading(true)
    Promise.all([getSignalsByTicker(ticker), getNewsByTicker(ticker)])
      .then(([sigs, nws]) => { setSignals(sigs); setNews(nws) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [ticker])

  const loadTicker = (t) => { setTicker(t); setSugg([]); setQuery(''); navigate(`/deepdive/${t}`) }

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Deep Dive" />
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Cari ticker atau nama emiten..."
          style={{
            width: '100%', background: '#161B25', border: '1px solid var(--border)',
            borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, outline: 'none',
          }}
        />
        {suggestions.length > 0 && (
          <div style={{ background: '#161B25', border: '1px solid var(--border)', borderRadius: 8, marginTop: 6 }}>
            {suggestions.map(s => (
              <div key={s.ticker} onClick={() => loadTicker(s.ticker)}
                style={{ padding: '9px 12px', display: 'flex', justifyContent: 'space-between',
                  cursor: 'pointer', borderBottom: '1px solid #1E2535', fontSize: 13 }}>
                <span>{s.name}</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{s.ticker}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {!ticker && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Cari nama atau ticker IDX<br />
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>Contoh: BBCA, Telkom, Astra</span>
        </div>
      )}

      {ticker && (
        <div style={{ padding: '14px 16px' }}>
          <div className="section-label">Sinyal Terbaru — {ticker}</div>
          {loading
            ? <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0' }}>Memuat...</div>
            : signals.map(s => (
              <div key={s.id} className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                    {new Date(s.created_at).toLocaleDateString('id-ID')}
                  </span>
                  <span className={`badge-${s.signal_type.toLowerCase()}`}
                    style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4 }}>
                    {s.signal_type}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.6 }}>{s.verdict_text}</div>
              </div>
            ))
          }

          {news.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 14 }}>Berita Terbaru</div>
              {news.map(n => (
                <div key={n.id} className="card">
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
