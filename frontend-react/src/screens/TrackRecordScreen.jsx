import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { supabase } from '../lib/supabase'

const sigCol = t => t === 'BUY' ? '#00C896' : t === 'SELL' ? '#FF4455' : '#F5A623'
const sigBg  = t => t === 'BUY' ? '#0A2E22' : t === 'SELL' ? '#2E0A0D' : '#1E1500'

export default function TrackRecordScreen() {
  const [signals,  setSignals]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('Semua')

  useEffect(() => {
    // Ambil semua sinyal dari DB, tampilkan sebagai riwayat
    supabase
      .from('signals')
      .select('id, ticker, signal_type, confidence, price_at_signal, price_low, price_high, verdict_text, created_at, emiten_meta(name, sector)')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setSignals(data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Stats dari data real
  const total   = signals.length
  const buyCnt  = signals.filter(s => s.signal_type === 'BUY').length
  const sellCnt = signals.filter(s => s.signal_type === 'SELL').length
  const holdCnt = signals.filter(s => s.signal_type === 'HOLD').length
  const avgConf = total ? Math.round(signals.reduce((s, x) => s + Number(x.confidence), 0) / total) : 0

  const filtered = filter === 'Semua' ? signals
    : signals.filter(s => s.signal_type === filter)

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Track Record" />
      <div style={{ padding: '14px 16px 0' }}>

        {/* Stats real dari DB */}
        <div className="section-label">Sinyal Tercatat di DB</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { num: total,    lbl: 'Total Sinyal',  col: '#EDF2FF' },
            { num: `${avgConf}%`, lbl: 'Avg Keyakinan', col: avgConf >= 70 ? '#00C896' : '#F5A623' },
            { num: buyCnt,   lbl: 'BUY',  col: '#00C896' },
            { num: sellCnt,  lbl: 'SELL', col: '#FF4455' },
          ].map(({ num, lbl, col }) => (
            <div key={lbl} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700, color: col, marginBottom: 4 }}>{num}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{lbl}</div>
            </div>
          ))}
        </div>

        {/* Distribusi bar */}
        {total > 0 && (
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Distribusi sinyal</div>
            <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ flex: buyCnt  || 0.1, background: '#00C896' }} />
              <div style={{ flex: holdCnt || 0.1, background: '#F5A623' }} />
              <div style={{ flex: sellCnt || 0.1, background: '#FF4455' }} />
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {[['#00C896','BUY',buyCnt],['#F5A623','HOLD',holdCnt],['#FF4455','SELL',sellCnt]].map(([col,lbl,n]) => (
                <div key={lbl} style={{ display:'flex', alignItems:'center', gap:4, fontSize:10, color:'var(--muted)' }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:col }} />
                  {lbl} ({n})
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info disclaimer */}
        <div style={{ background:'#1A1500', border:'1px solid #F5A623', borderRadius:8,
          padding:'10px 12px', marginBottom:14, fontSize:10, color:'#C4967A', lineHeight:1.6 }}>
          ℹ️ <strong style={{color:'#F5A623'}}>Track Record Akurat</strong> akan tersedia setelah Signal Engine
          berjalan selama minimal 30 hari. Saat ini menampilkan sinyal yang sudah dibuat.
          WIN/LOSS dihitung otomatis setelah harga bergerak dari sinyal awal.
        </div>

        {/* Filter */}
        <div className="section-label" style={{ marginBottom: 6 }}>Riwayat Sinyal</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {['Semua','BUY','HOLD','SELL'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              background: filter === f ? '#0A2E22' : 'transparent',
              color: filter === f ? 'var(--buy)' : 'var(--muted)',
              border: `1px solid ${filter === f ? 'var(--buy)' : 'var(--border)'}`,
            }}>{f}</button>
          ))}
        </div>

        {/* Tabel sinyal real */}
        {loading ? (
          <div style={{ color:'var(--muted)', fontSize:12, padding:'30px 0', textAlign:'center' }}>⏳ Memuat...</div>
        ) : filtered.length === 0 ? (
          <div style={{ color:'var(--muted)', fontSize:12, padding:'30px 0', textAlign:'center' }}>
            <div style={{ fontSize:28, marginBottom:8 }}>📊</div>
            Belum ada sinyal dengan filter ini.
          </div>
        ) : (
          <div className="card" style={{ padding:'4px 14px' }}>
            <div style={{ display:'flex', padding:'6px 0', borderBottom:'1px solid var(--border)', marginBottom:2 }}>
              {['Emiten','Sinyal','Conf','Harga','Tgl'].map((h,i) => (
                <div key={h} style={{ fontSize:10, color:'var(--dim)',
                  flex: i===0?2 : i===1?'0 0 52px' : i===2?'0 0 40px' : i===3?'0 0 72px' : 1 }}>{h}</div>
              ))}
            </div>
            {filtered.map((s, i) => {
              const dateStr = new Date(s.created_at).toLocaleDateString('id-ID', { day:'2-digit', month:'short' })
              return (
                <div key={s.id} style={{ display:'flex', alignItems:'center', padding:'9px 0',
                  borderBottom: i < filtered.length-1 ? '1px solid #1E2535' : 'none', fontSize:11 }}>
                  <div style={{ flex:2 }}>
                    <div style={{ fontWeight:500, fontSize:12 }}>{s.emiten_meta?.name ?? s.ticker}</div>
                    <div style={{ fontFamily:'var(--mono)', fontSize:9, color:'var(--muted)' }}>{s.ticker}</div>
                  </div>
                  <div style={{ flex:'0 0 52px' }}>
                    <span style={{ fontSize:10, fontWeight:600, padding:'2px 6px', borderRadius:3,
                      background:sigBg(s.signal_type), color:sigCol(s.signal_type) }}>{s.signal_type}</span>
                  </div>
                  <div style={{ flex:'0 0 40px', fontFamily:'var(--mono)', fontSize:10, color:'var(--muted)' }}>
                    {Number(s.confidence).toFixed(0)}%
                  </div>
                  <div style={{ flex:'0 0 72px', fontFamily:'var(--mono)', fontSize:11 }}>
                    Rp {Number(s.price_at_signal).toLocaleString('id-ID')}
                  </div>
                  <div style={{ flex:1, fontSize:10, color:'var(--muted)', textAlign:'right' }}>{dateStr}</div>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
