import { useNavigate } from 'react-router-dom'

const confLabel = (c) =>
  c >= 85 ? 'Sangat Tinggi' : c >= 70 ? 'Tinggi' : c >= 50 ? 'Sedang' : 'Rendah'

const sigColor = (s) =>
  s === 'BUY' ? '#00C896' : s === 'SELL' ? '#FF4455' : '#F5A623'

// [v2.0] Badge fase cacing/naga
const PhaseBadge = ({ phase, cacing_score }) => {
  if (!phase || phase === 'UNKNOWN') return null
  const cfg = {
    AKUMULASI:  { label: 'Akumulasi', bg: '#0A2E22', color: '#00C896', icon: 'A' },
    DISTRIBUSI: { label: 'Distribusi', bg: '#2E1A00', color: '#F5A623', icon: 'D' },
    DUMP:       { label: 'Dump', bg: '#2E0A0D', color: '#FF4455', icon: '!' },
  }[phase]
  if (!cfg) return null
  const scoreText = phase === 'AKUMULASI' && cacing_score
    ? ` ${Math.round(cacing_score * 100)}%` : ''
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
      background: cfg.bg, color: cfg.color, marginLeft: 4,
    }}>
      {cfg.icon} {cfg.label}{scoreText}
    </span>
  )
}

// [v2.0] Badge macro flag (tampilkan paling berbahaya)
const MacroBadge = ({ macro_flag }) => {
  if (!macro_flag?.length) return null
  const danger = macro_flag.find(f =>
    ['SHORT_REPORT', 'HORMUZ_TENSION', 'CYBER_ATTACK'].includes(f))
  const warning = macro_flag.find(f =>
    ['FED_HAWKISH', 'RUPIAH_LEMAH', 'CUKAI_ROKOK_NAIK', 'FOMO_SOSMED'].includes(f))
  const positive = macro_flag.find(f =>
    ['FED_DOVISH', 'CHINA_STIMULUS', 'BI_RATE_TURUN', 'RUPIAH_KUAT'].includes(f))
  const flag = danger || warning || positive
  if (!flag) return null
  const color = danger ? '#FF4455' : warning ? '#F5A623' : '#00C896'
  const bg    = danger ? '#2E0A0D' : warning ? '#2E1A00' : '#0A2E22'
  const label = flag.replace(/_/g, ' ')
  return (
    <span style={{
      fontSize: 9, fontWeight: 500, padding: '2px 6px', borderRadius: 3,
      background: bg, color, marginLeft: 4,
    }}>
      M {label}
    </span>
  )
}

export default function SignalCard({ signal }) {
  const navigate = useNavigate()
  const {
    ticker, emiten_name, signal_type, confidence,
    price_at_signal, verdict_text,
    phase, cacing_score, macro_flag, fomo_penalty,
  } = signal
  const chgPct = ((Math.random() - 0.3) * 3).toFixed(2) // placeholder
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

        {/* Header: nama + badge sinyal */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{emiten_name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 2 }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                {ticker}
              </span>
              <PhaseBadge phase={phase} cacing_score={cacing_score} />
              <MacroBadge macro_flag={macro_flag} />
            </div>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, height: 'fit-content',
            background: signal_type === 'BUY' ? '#0A2E22' : signal_type === 'SELL' ? '#2E0A0D' : '#1E1500',
            color,
          }}>{signal_type}</span>
        </div>

        {/* Verdict singkat */}
        <div style={{ fontSize: 11, color: '#C8D4E8', lineHeight: 1.55, marginBottom: 7 }}>
          {verdict_text?.slice(0, 90)}{verdict_text?.length > 90 ? '...' : ''}
        </div>

        {/* Confidence bar + label + perubahan harga */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, height: 4, background: '#252D3D', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${confidence}%`, height: '100%', background: color, borderRadius: 2 }} />
          </div>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{confLabel(confidence)}</span>
          {fomo_penalty > 0 && (
            <span style={{ fontSize: 9, color: '#F5A623' }}>FOMO -{fomo_penalty}</span>
          )}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: parseFloat(chgPct) >= 0 ? '#00C896' : '#FF4455' }}>
            {parseFloat(chgPct) >= 0 ? '+' : ''}{chgPct}%
          </span>
        </div>

      </div>
    </div>
  )
}
