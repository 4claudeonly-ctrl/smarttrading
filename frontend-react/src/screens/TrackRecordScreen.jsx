import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { getAccuracy } from '../lib/api'
import { supabase } from '../lib/supabase'

const HISTORY_MOCK = [
  { date: '01 Apr', ticker: 'BBCA', signal: 'BUY',  conf: 87, outcome: 'WIN',   pct: +3.2 },
  { date: '01 Apr', ticker: 'ASII', signal: 'SELL', conf: 76, outcome: 'WIN',   pct: -2.1 },
  { date: '31 Mar', ticker: 'TLKM', signal: 'BUY',  conf: 74, outcome: 'WIN',   pct: +1.9 },
  { date: '31 Mar', ticker: 'INDF', signal: 'HOLD', conf: 71, outcome: 'NEUT',  pct: +0.1 },
  { date: '30 Mar', ticker: 'BBRI', signal: 'BUY',  conf: 73, outcome: 'LOSS',  pct: -1.4 },
  { date: '30 Mar', ticker: 'HMSP', signal: 'SELL', conf: 80, outcome: 'WIN',   pct: -3.5 },
  { date: '29 Mar', ticker: 'KLBF', signal: 'BUY',  conf: 72, outcome: 'WIN',   pct: +2.8 },
  { date: '29 Mar', ticker: 'PTBA', signal: 'BUY',  conf: 85, outcome: 'WIN',   pct: +4.1 },
]

const sigCol = t => t === 'BUY' ? '#00C896' : t === 'SELL' ? '#FF4455' : '#F5A623'
const sigBg  = t => t === 'BUY' ? '#0A2E22' : t === 'SELL' ? '#2E0A0D' : '#1E1500'

export default function TrackRecordScreen() {
  const [accuracy, setAccuracy] = useState([])
  const [filter, setFilter]     = useState('Semua')

  useEffect(() => {
    getAccuracy().then(setAccuracy).catch(() => {})
  }, [])

  const totalWins   = 97
  const totalLoss   = 29
  const totalNeu    = 16
  const totalAll    = totalWins + totalLoss + totalNeu
  const winRateAll  = Math.round(totalWins / totalAll * 100)

  const BY_SIG = [
    { sig: 'BUY',  wr: 72, count: 58 },
    { sig: 'HOLD', wr: 61, count: 46 },
    { sig: 'SELL', wr: 71, count: 38 },
  ]

  const filtered = filter === 'Semua' ? HISTORY_MOCK
    : filter === 'WIN' ? HISTORY_MOCK.filter(h => h.outcome === 'WIN')
    : HISTORY_MOCK.filter(h => h.signal === filter)

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Track Record 30 Hari" />
      <div style={{ padding: '14px 16px 0' }}>

        <div className="section-label">Ringkasan 30 Hari</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
          {[
            { num: `${winRateAll}%`, lbl: 'Win Rate', col: '#00C896' },
            { num: totalAll,         lbl: 'Total Sinyal', col: '#EDF2FF' },
            { num: totalWins,        lbl: 'WIN', col: '#00C896' },
            { num: totalLoss,        lbl: 'LOSS / Netral', col: '#FF4455' },
          ].map(({ num, lbl, col }) => (
            <div key={lbl} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700, color: col, marginBottom: 4 }}>{num}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{lbl}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>Distribusi hasil — {totalAll} sinyal</div>
          <div style={{ display: 'flex', gap: 2, height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ flex: totalWins, background: '#00C896' }} />
            <div style={{ flex: totalLoss,  background: '#FF4455' }} />
            <div style={{ flex: totalNeu,   background: '#F5A623' }} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {[['#00C896','WIN',totalWins],['#FF4455','LOSS',totalLoss],['#F5A623','Netral',totalNeu]].map(([col, lbl, n]) => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--muted)' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: col }} />
                {lbl} ({n})
              </div>
            ))}
          </div>
        </div>

        <div className="section-label">Akurasi per Jenis Sinyal</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
          {BY_SIG.map(({ sig, wr, count }) => (
            <div key={sig} className="card" style={{ textAlign: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 4, marginBottom: 8, display: 'inline-block', background: sigBg(sig), color: sigCol(sig) }}>{sig}</span>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700, color: wr >= 65 ? '#00C896' : '#F5A623' }}>{wr}%</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{count} sinyal</div>
            </div>
          ))}
        </div>

        <div className="section-label" style={{ marginBottom: 6 }}>Riwayat Sinyal</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {['Semua','BUY','HOLD','SELL','WIN'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 11, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
              background: filter === f ? '#0A2E22' : 'transparent',
              color: filter === f ? 'var(--buy)' : 'var(--muted)',
              border: `1px solid ${filter === f ? 'var(--buy)' : 'var(--border)'}`,
            }}>{f}</button>
          ))}
        </div>
        <div className="card" style={{ padding: '4px 14px' }}>
          <div style={{ display: 'flex', padding: '6px 0', borderBottom: '1px solid var(--border)', marginBottom: 2 }}>
            {['Tgl','Ticker','Sinyal','Conf','Hasil','%'].map((h, i) => (
              <div key={h} style={{ fontSize: 10, color: 'var(--dim)', flex: i === 0 ? '0 0 48px' : i === 1 ? '0 0 44px' : i === 2 ? '0 0 52px' : i === 3 ? '0 0 38px' : i === 4 ? '0 0 62px' : 1 }}>{h}</div>
            ))}
          </div>
          {filtered.map((h, i) => {
            const outCol = h.outcome === 'WIN' ? '#00C896' : h.outcome === 'LOSS' ? '#FF4455' : '#F5A623'
            const outBg  = h.outcome === 'WIN' ? '#0A2E22' : h.outcome === 'LOSS' ? '#2E0A0D' : '#1E1500'
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '9px 0', borderBottom: i < filtered.length - 1 ? '1px solid #1E2535' : 'none', fontSize: 11 }}>
                <div style={{ flex: '0 0 48px', color: 'var(--dim)', fontFamily: 'var(--mono)', fontSize: 10 }}>{h.date}</div>
                <div style={{ flex: '0 0 44px', fontFamily: 'var(--mono)', fontWeight: 600 }}>{h.ticker}</div>
                <div style={{ flex: '0 0 52px' }}><span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: sigBg(h.signal), color: sigCol(h.signal) }}>{h.signal}</span></div>
                <div style={{ flex: '0 0 38px', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{h.conf}%</div>
                <div style={{ flex: '0 0 62px' }}><span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, background: outBg, color: outCol }}>{h.outcome}</span></div>
                <div style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 11, textAlign: 'right', color: h.pct >= 0 ? '#00C896' : '#FF4455' }}>{h.pct >= 0 ? '+' : ''}{h.pct.toFixed(1)}%</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
