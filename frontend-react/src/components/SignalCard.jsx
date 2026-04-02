import { useNavigate } from 'react-router-dom'

const confLabel = (c) =>
  c >= 85 ? 'Sangat Tinggi' : c >= 70 ? 'Tinggi' : c >= 50 ? 'Sedang' : 'Rendah'

const sigColor = (s) =>
  s === 'BUY' ? '#00C896' : s === 'SELL' ? '#FF4455' : '#F5A623'

export default function SignalCard({ signal }) {
  const navigate = useNavigate()
  const { ticker, emiten_name, signal_type, confidence,
          price_at_signal, verdict_text } = signal
  const chgPct = ((Math.random() - 0.3) * 3).toFixed(2) // placeholder sampai harga live tersedia
  const color  = sigColor(signal_type)

  return (
    <div
      onClick={() => navigate(`/deepdive/${ticker}`)}
      style={{
        background: 'var(--surface)', borderRadius: 10,
        border: '1px solid var(--border)', marginBottom: 8,
        overflow: 'hidden', display: 'flex', cursor: 'pointer',
      }}
    >
      <div style={{ width: 4, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, padding: '11px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{emiten_name}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>{ticker}</div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
            background: signal_type === 'BUY' ? '#0A2E22' : signal_type === 'SELL' ? '#2E0A0D' : '#1E1500',
            color,
          }}>{signal_type}</span>
        </div>
        <div style={{ fontSize: 11, color: '#C8D4E8', lineHeight: 1.55, marginBottom: 7 }}>
          {verdict_text?.slice(0, 90)}{verdict_text?.length > 90 ? '...' : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, background: '#252D3D', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${confidence}%`, height: '100%', background: color, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{confLabel(confidence)}</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: parseFloat(chgPct) >= 0 ? '#00C896' : '#FF4455' }}>
            {parseFloat(chgPct) >= 0 ? '+' : ''}{chgPct}%
          </span>
        </div>
      </div>
    </div>
  )
}
