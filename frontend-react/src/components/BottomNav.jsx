import { NavLink } from 'react-router-dom'

const NAV = [
  { to: '/',            label: 'Home'      },
  { to: '/watchlist',   label: 'Watchlist' },
  { to: '/deepdive',    label: 'Deep Dive' },
  { to: '/global',      label: 'Global'    },
  { to: '/alert',       label: 'Alert'     },
]

export default function BottomNav() {
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 430, background: 'var(--surface)',
      borderTop: '1px solid var(--border)', display: 'flex', zIndex: 20,
    }}>
      {NAV.map(({ to, label }) => (
        <NavLink
          key={to} to={to} end={to === '/'}
          style={({ isActive }) => ({
            flex: 1, padding: '10px 0', textAlign: 'center',
            fontSize: 10, color: isActive ? 'var(--buy)' : 'var(--muted)',
            textDecoration: 'none',
            borderTop: isActive ? '2px solid var(--buy)' : '2px solid transparent',
          })}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
