import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { getSignalsByTicker, getNewsByTicker, callAnalyzeTicker } from '../lib/api'

function SignalBadge({ type }) {
  const col = type === 'BUY' ? '#00C896' : type === 'SELL' ? '#FF4455' : '#F5A623'
  const bg  = type === 'BUY' ? '#0A2E22' : type === 'SELL' ? '#2E0A0D' : '#1E1500'
  return <span style={{ background: bg, color: col, border: `1px solid ${col}`,
    borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700,
    fontFamily: 'var(--mono)', letterSpacing: '0.08em' }}>{type}</span>
}

function ConfidenceBar({ value }) {
  const col = value >= 75 ? '#00C896' : value >= 60 ? '#F5A623' : '#FF4455'
  const label = value >= 75 ? 'Tinggi' : value >= 60 ? 'Moderat' : 'Rendah'
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>Keyakinan Analisis</span>
        <span style={{ fontSize: 10, color: col, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ height: 4, background: '#252D3D', borderRadius: 2 }}>
        <div style={{ height: 4, width: `${value}%`, background: col, borderRadius: 2, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

// Parse verdict 5-section dari Groq
function parseVerdict(text) {
  if (!text) return null
  const sections = {}
  const tags = ['KONDISI PASAR','THESIS','LEVEL ENTRY','SKENARIO RISIKO','HORIZON']
  tags.forEach((tag, i) => {
    const start = text.indexOf(`[${tag}]`)
    if (start === -1) return
    const nextTag = tags[i + 1] ? text.indexOf(`[${tags[i + 1]}]`) : text.length
    sections[tag] = text.slice(start + tag.length + 2, nextTag > -1 ? nextTag : undefined).trim()
  })
  return Object.keys(sections).length >= 3 ? sections : null
}

function VerdictSection({ title, content, color = '#C8D4E8', icon }) {
  return (
    <div style={{ marginBottom: 12, background: '#0B0D12', borderRadius: 8, padding: '10px 12px',
      borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color, letterSpacing: '0.08em',
        marginBottom: 6, textTransform: 'uppercase' }}>{icon} {title}</div>
      <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.7 }}>{content}</div>
    </div>
  )
}

export default function DeepDiveScreen() {
  const { ticker: paramTicker } = useParams()
  const navigate = useNavigate()
  const [query, setQuery]   = useState(paramTicker || '')
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState(null)
  const [news, setNews]     = useState([])

  const doSearch = async (q) => {
    const ticker = q.trim().toUpperCase()
    if (!ticker) return
    setLoading(true); setError(null); setData(null); setNews([])
    try {
      const result = await analyzeTicker(ticker)
      setData(result)
      navigate(`/deepdive/${ticker}`, { replace: true })
      getNewsByTicker(ticker).then(setNews).catch(() => {})
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (paramTicker) doSearch(paramTicker) }, [])

  const handleKey = (e) => { if (e.key === 'Enter') doSearch(query) }
  const chgColor = data?.change_pct > 0 ? '#00C896' : data?.change_pct < 0 ? '#FF4455' : 'var(--muted)'
  const verdict  = data ? parseVerdict(data.verdict) : null

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Deep Dive" />

      {/* Search */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input value={query} onChange={e => setQuery(e.target.value.toUpperCase())}
          onKeyDown={handleKey} placeholder="Ketik kode saham IDX + Enter..."
          style={{ flex: 1, background: '#161B25', border: '1px solid var(--border)',
            borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13,
            outline: 'none', fontFamily: 'var(--mono)', letterSpacing: '0.06em' }} />
        <button onClick={() => doSearch(query)} disabled={loading}
          style={{ background: loading ? '#0A1E14' : '#0A2E22', border: '1px solid #00C896',
            color: '#00C896', borderRadius: 8, padding: '9px 18px', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, minWidth: 60 }}>
          {loading ? '⏳' : 'Cari'}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: '50px 20px', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
          <div style={{ color: '#00C896', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Menganalisis {query}...
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 11, lineHeight: 1.8 }}>
            Mengambil data historis<br/>
            Menghitung RSI · MACD · Bollinger · EMA<br/>
            AI menyusun analisis hedge fund grade...
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ margin: 16, padding: 14, background: '#2E0A0D',
          border: '1px solid #FF4455', borderRadius: 8 }}>
          <div style={{ color: '#FF4455', fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
            Analisis Gagal
          </div>
          <div style={{ color: '#C47A7E', fontSize: 11, lineHeight: 1.6 }}>{error}</div>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && !data && (
        <div style={{ padding: '50px 20px', textAlign: 'center', color: 'var(--muted)' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📈</div>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Analisis saham IDX secara mendalam</div>
          <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.7 }}>
            Ketik kode saham lalu tekan Enter<br/>
            BBCA · TLKM · GOTO · ASII · BBRI
          </div>
        </div>
      )}

      {/* Result */}
      {data && !loading && (
        <div style={{ padding: '12px 16px' }}>

          {/* Header harga */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, letterSpacing: '0.06em' }}>
                  {data.ticker}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {data.name} · {data.sector}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600 }}>
                  Rp {data.current_price?.toLocaleString('id-ID')}
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: chgColor, marginTop: 2 }}>
                  {data.change_pct > 0 ? '+' : ''}{data.change_pct}%
                </div>
              </div>
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 10 }}>
              {[
                ['5H', `${data.ret5d > 0 ? '+' : ''}${data.ret5d}%`, data.ret5d > 0 ? '#00C896' : '#FF4455'],
                ['30H', `${data.ret30d > 0 ? '+' : ''}${data.ret30d}%`, data.ret30d > 0 ? '#00C896' : '#FF4455'],
                ['Vol', `${data.indicators?.volRatio?.toFixed(1)}x`, data.indicators?.volRatio >= 1.5 ? '#00C896' : 'var(--muted)'],
                ['RSI', data.indicators?.rsi, data.indicators?.rsi < 35 ? '#00C896' : data.indicators?.rsi > 65 ? '#FF4455' : 'var(--muted)'],
                ['Support', `Rp ${data.support?.toLocaleString('id-ID')}`, 'var(--muted)'],
                ['Resist.', `Rp ${data.resistance?.toLocaleString('id-ID')}`, 'var(--muted)'],
              ].map(([lbl, val, col]) => (
                <div key={lbl} style={{ background: '#0B0D12', borderRadius: 6, padding: '7px 10px' }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>{lbl}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 600, color: col }}>{val}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <SignalBadge type={data.signal} />
              <div style={{ flex: 1 }}><ConfidenceBar value={data.confidence} /></div>
            </div>
          </div>

          {/* Verdict 5-section */}
          {verdict ? (
            <div style={{ marginBottom: 12 }}>
              <div className="section-label">Analisis AI — Hedge Fund Grade</div>
              <VerdictSection title="Kondisi Pasar" icon="📊"
                content={verdict['KONDISI PASAR']} color="#00C896" />
              <VerdictSection title="Thesis" icon="💡"
                content={verdict['THESIS']} color="#F5A623" />
              <VerdictSection title="Level Entry" icon="🎯"
                content={verdict['LEVEL ENTRY']} color="#00C896" />
              <VerdictSection title="Skenario Risiko" icon="⚠️"
                content={verdict['SKENARIO RISIKO']} color="#FF4455" />
              <VerdictSection title="Horizon & Target" icon="🕐"
                content={verdict['HORIZON']} color="#7B8FCC" />
            </div>
          ) : data.verdict ? (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div className="section-label">Analisis AI</div>
              <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.8, whiteSpace: 'pre-line' }}>
                {data.verdict}
              </div>
            </div>
          ) : null}

          {/* Disclaimer */}
          <div style={{ margin: '0 0 12px', padding: '8px 12px', background: '#0B0D12',
            borderRadius: 6, border: '1px solid #252D3D' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
              ℹ️ Analisis ini hanya untuk referensi. Eksekusi di platform broker Anda (Ajaib, Stockbit, Mirae, dll).
              Data per: {data.data_date}
            </div>
          </div>

          {/* Berita */}
          {news.length > 0 && (
            <>
              <div className="section-label">Berita Terkait</div>
              {news.map(n => (
                <div key={n.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#C8D4E8', lineHeight: 1.5, marginBottom: 4 }}>{n.title}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{n.source}</span>
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                      background: n.sentiment==='POSITIVE'?'#0A2E22':n.sentiment==='NEGATIVE'?'#2E0A0D':'#1E1500',
                      color: n.sentiment==='POSITIVE'?'#00C896':n.sentiment==='NEGATIVE'?'#FF4455':'#F5A623',
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
