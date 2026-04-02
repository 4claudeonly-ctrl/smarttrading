const TOPBAR_STYLE = {
  background: 'var(--surface)', borderBottom: '1px solid var(--border)',
  padding: '12px 16px', display: 'flex', alignItems: 'center',
  justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 10,
}

export function TopBar({ title, right }) {
  return (
    <div style={TOPBAR_STYLE}>
      <div>
        <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: 1 }}>
          SMART<span style={{ color: 'var(--buy)' }}>TRADING</span>
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{right || title}</div>
    </div>
  )
}

export function LiveDot() {
  return (
    <span style={{
      display: 'inline-block', width: 6, height: 6,
      borderRadius: '50%', background: 'var(--buy)',
      marginRight: 5, animation: 'pulse 2s infinite',
    }} />
  )
}
