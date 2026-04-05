import { useState, useEffect, useCallback } from 'react'
import { TopBar } from '../components/TopBar'
import { getLatestSignals } from '../lib/api'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const FILTERS = ['Semua', 'BUY', 'HOLD', 'SELL']

// Generate / load session_id persisten di localStorage
function getSessionId() {
  let sid = localStorage.getItem('st_session_id')
  if (!sid) {
    sid = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    localStorage.setItem('st_session_id', sid)
  }
  return sid
}

async function apiFetch(action, body = {}) {
  const sid = getSessionId()
  const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
  const url = `${SUPABASE_URL}/functions/v1/manage-alerts?action=${action}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON,
    },
    body: JSON.stringify({ session_id: sid, ...body }),
  })
  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Request gagal')
  return json.data
}

export default function AlertScreen() {
  const [tab, setTab]         = useState('feed')
  const [signals, setSignals] = useState([])
  const [filter, setFilter]   = useState('Semua')
  const [alerts, setAlerts]   = useState([])
  const [alertLoading, setAlertLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({ ticker: '', type: 'above', price: '' })

  useEffect(() => {
    getLatestSignals(20).then(setSignals).catch(() => {})
  }, [])

  const loadAlerts = useCallback(async () => {
    setAlertLoading(true)
    try {
      const data = await apiFetch('list')
      setAlerts(data)
    } catch { setAlerts([]) }
    finally { setAlertLoading(false) }
  }, [])

  useEffect(() => { if (tab === 'price') loadAlerts() }, [tab])

  const addAlert = async () => {
    if (!form.ticker || !form.price) return
    setSaving(true)
    try {
      const newAlert = await apiFetch('add', {
        ticker: form.ticker, type: form.type, price: parseInt(form.price),
      })
      setAlerts(prev => [newAlert, ...prev])
      setForm({ ticker: '', type: 'above', price: '' })
    } catch (e) { alert('Gagal simpan: ' + e.message) }
    finally { setSaving(false) }
  }

  const delAlert = async (id) => {
    try {
      await apiFetch('delete', { id })
      setAlerts(prev => prev.filter(a => a.id !== id))
    } catch (e) { alert('Gagal hapus: ' + e.message) }
  }

  const filtered = filter === 'Semua' ? signals : signals.filter(s => s.signal_type === filter)
  const sigCol = t => t === 'BUY' ? '#00C896' : t === 'SELL' ? '#FF4455' : '#F5A623'
  const sigBg  = t => t === 'BUY' ? '#0A2E22' : t === 'SELL' ? '#2E0A0D' : '#1E1500'

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
          {filtered.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '30px 0', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
              Belum ada sinyal. Signal Engine berjalan setiap 15 menit saat jam bursa.
            </div>
          )}
          {filtered.map(s => (
            <div key={s.id} className="card" style={{ display: 'flex', padding: 0, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: 4, background: sigCol(s.signal_type), flexShrink: 0 }} />
              <div style={{ flex: 1, padding: '11px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{s.emiten_meta?.name ?? s.ticker}</div>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{s.ticker}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                    background: sigBg(s.signal_type), color: sigCol(s.signal_type) }}>{s.signal_type}</span>
                </div>
                <div style={{ fontSize: 11, color: '#C8D4E8', lineHeight: 1.55, marginBottom: 6 }}>
                  {s.verdict_text?.slice(0, 100)}...
                </div>
                <div style={{ fontSize: 10, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>
                  {new Date(s.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'price' && (
        <div style={{ padding: '14px 16px' }}>
          <div className="section-label">Set Price Alert</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
            Alert tersimpan ke server — tidak akan hilang walau browser ditutup.
          </div>
          <div className="card" style={{ marginBottom: 14 }}>
            {[
              { label: 'Kode Saham', el: <input value={form.ticker} onChange={e => setForm(p => ({ ...p, ticker: e.target.value.toUpperCase() }))} placeholder="Contoh: BBCA" maxLength={6} style={{ width: '100%', background: '#0F1219', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)', outline: 'none', boxSizing: 'border-box' }} /> },
              { label: 'Kondisi', el: <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} style={{ width: '100%', background: '#0F1219', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, outline: 'none' }}><option value="above">Notif kalau harga naik di atas</option><option value="below">Notif kalau harga turun di bawah</option></select> },
              { label: 'Harga Target (Rp)', el: <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="10500" style={{ width: '100%', background: '#0F1219', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'var(--mono)', outline: 'none', boxSizing: 'border-box' }} /> },
            ].map(({ label, el }) => (
              <div key={label} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>{label}</div>
                {el}
              </div>
            ))}
            <button onClick={addAlert} disabled={saving || !form.ticker || !form.price}
              style={{ width: '100%', background: saving ? '#0F1219' : '#0A2E22',
                border: '1px solid var(--buy)', color: 'var(--buy)', borderRadius: 10,
                padding: 12, fontSize: 13, fontWeight: 500, cursor: saving ? 'not-allowed' : 'pointer',
                opacity: (!form.ticker || !form.price) ? 0.5 : 1 }}>
              {saving ? '⏳ Menyimpan...' : '+ Simpan Alert'}
            </button>
          </div>

          <div className="section-label">Alert Tersimpan ({alerts.length})</div>
          {alertLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>⏳ Memuat...</div>
          ) : alerts.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Belum ada alert. Buat yang pertama di atas.</div>
          ) : (
            <div className="card">
              {alerts.map((a, i) => {
                const isAbove = a.type === 'above'
                const isTriggered = a.status === 'triggered'
                return (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 0', borderBottom: i < alerts.length - 1 ? '1px solid #1E2535' : 'none' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
                      width: 52, color: isAbove ? '#00C896' : '#FF4455' }}>{a.ticker}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      background: isAbove ? '#0A2E22' : '#2E0A0D',
                      color: isAbove ? '#00C896' : '#FF4455' }}>
                      {isAbove ? '↑ >' : '↓ <'}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, flex: 1 }}>
                      Rp {Number(a.price).toLocaleString('id-ID')}
                    </span>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, fontWeight: 500,
                      background: isTriggered ? '#1E1500' : '#0A1E14',
                      color: isTriggered ? '#F5A623' : '#00C896' }}>
                      {isTriggered ? '✓ Triggered' : '● Aktif'}
                    </span>
                    <button onClick={() => delAlert(a.id)}
                      style={{ fontSize: 16, color: '#FF4455', background: 'none',
                        border: 'none', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
