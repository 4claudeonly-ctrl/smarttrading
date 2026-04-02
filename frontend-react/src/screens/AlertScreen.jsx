import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { getLatestSignals } from '../lib/api'

const FILTERS = ['Semua', 'BUY', 'HOLD', 'SELL']

export default function AlertScreen() {
  const [tab, setTab]         = useState('feed')
  const [signals, setSignals] = useState([])
  const [filter, setFilter]   = useState('Semua')
  const [priceAlerts, setPriceAlerts] = useState([
    { ticker: 'BBCA', type: 'above', price: 10500, status: 'active' },
    { ticker: 'ASII', type: 'below', price: 5000,  status: 'active' },
    { ticker: 'TLKM', type: 'above', price: 3500,  status: 'triggered' },
  ])
  const [form, setForm] = useState({ ticker: '', type: 'above', price: '' })

  useEffect(() => {
    getLatestSignals(20).then(setSignals).catch(() => {})
  }, [])

  const filtered = filter === 'Semua' ? signals : signals.filter(s => s.signal_type === filter)

  const sigCol = t => t === 'BUY' ? '#00C896' : t === 'SELL' ? '#FF4455' : '#F5A623'
  const sigBg  = t => t === 'BUY' ? '#0A2E22' : t === 'SELL' ? '#2E0A0D' : '#1E1500'

  const addAlert = () => {
    if (!form.ticker || !form.price) return
    setPriceAlerts(prev => [...prev, { ...form, price: parseInt(form.price), status: 'active' }])
    setForm({ ticker: '', type: 'above', price: '' })
  }
  const delAlert = (i) => setPriceAlerts(prev => prev.filter((_, idx) => idx !== i))

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Alert" />
      <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        {['feed', 'price'].map(t => (
          <div key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: '10px 0', textAlign: 'center', fontSize: 11, cursor: 'pointer',
            color: tab === t ? 'var(--buy)' : 'var(--muted)',
            borderBottom: tab === t ? '2px solid var(--buy)' : '2px solid transparent',
          }}>{t === 'feed' ? 'Feed Sinyal' : 'Price Alert'}</div>
        ))}
      </div>

      {tab === 'feed' && (
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {FILTERS.map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                background: filter === f ? '#0A2E22' : 'transparent',
                color: filter === f ? 'var(--buy)' : 'var(--muted)',
                border: `1px solid ${filter === f ? 'var(--buy)' : 'var(--border)'}`,
              }}>{f}</button>
            ))}
          </div>
          {filtered.map(s => (
            <div key={s.id} className="card" style={{ display: 'flex', padding: 0, overflow: 'hidden' }}>
              <div style={{ width: 4, background: sigCol(s.signal_type), flexShrink: 0 }} />
              <div style={{ flex: 1, padding: '11px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.emiten_name}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{s.ticker}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                    background: sigBg(s.signal_type), color: sigCol(s.signal_type) }}>{s.signal_type}</span>
                </div>
                <div style={{ fontSize: 11, color: '#C8D4E8', lineHeight: 1.55, marginBottom: 6 }}>
                  {s.verdict_text?.slice(0, 90)}...
                </div>
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                  {new Date(s.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                </div>
              </div>
            </div>
          ))}
          {!filtered.length && (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>
              Belum ada sinyal
            </div>
          )}
        </div>
      )}

      {tab === 'price' && (
        <div style={{ padding: '14px 16px' }}>
          <div className="section-label">Set Alert Baru</div>
          <div className="card" style={{ marginBottom: 14 }}>
            {[
              { label: 'Ticker', el: <input value={form.ticker} onChange={e => setForm(p => ({ ...p, ticker: e.target.value.toUpperCase() }))} placeholder="BBCA" maxLength={6} style={{ width: '100%', background: '#0F1219', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)', outline: 'none' }} /> },
              { label: 'Jenis', el: <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} style={{ width: '100%', background: '#0F1219', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}><option value="above">Naik di atas</option><option value="below">Turun di bawah</option></select> },
              { label: 'Harga (Rp)', el: <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="10500" style={{ width: '100%', background: '#0F1219', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)', outline: 'none' }} /> },
            ].map(({ label, el }) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>
                {el}
              </div>
            ))}
            <button onClick={addAlert} style={{ width: '100%', background: '#0A2E22', border: '1px solid var(--buy)', color: 'var(--buy)', borderRadius: 10, padding: 12, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>
              + Tambah Alert
            </button>
          </div>

          <div className="section-label">Alert Aktif</div>
          <div className="card">
            {priceAlerts.map((a, i) => {
              const isAbove = a.type === 'above'
              const isTriggered = a.status === 'triggered'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderBottom: i < priceAlerts.length - 1 ? '1px solid #1E2535' : 'none' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 600, width: 48, color: isAbove ? '#00C896' : '#FF4455' }}>{a.ticker}</span>
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: isAbove ? '#0A2E22' : '#2E0A0D', color: isAbove ? '#00C896' : '#FF4455' }}>{isAbove ? 'Naik >' : 'Turun <'}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12, flex: 1 }}>Rp {a.price.toLocaleString()}</span>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 500, background: isTriggered ? '#1E1500' : '#0A2E22', color: isTriggered ? '#F5A623' : '#00C896' }}>{isTriggered ? 'Triggered' : 'Aktif'}</span>
                  <button onClick={() => delAlert(i)} style={{ fontSize: 14, color: 'var(--dim)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>&#10005;</button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
