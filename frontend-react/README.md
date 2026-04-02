# SmartTrading Frontend React — Setup Guide

## Prasyarat
- Node.js 18+ (`node -v`)
- Supabase project sudah dibuat + schema di-apply
- Groq API key tersedia

---

## Setup Lokal (5 menit)

### 1. Install dependencies
```bash
cd smarttrading/frontend-react
npm install
```

### 2. Buat file .env.local
```bash
cp .env.example .env.local
# Edit .env.local — isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON
```

### 3. Jalankan dev server
```bash
npm run dev
# Buka http://localhost:3000
```

---

## Deploy ke Cloudflare Pages

### 1. Push ke GitHub
```bash
git add . && git commit -m "feat: SmartTrading frontend React"
git push origin main
```

### 2. Buat Cloudflare Pages project
- Buka dash.cloudflare.com → Pages → Create project
- Connect GitHub repo
- Framework preset: **Vite**
- Build command: `npm run build`
- Build output dir: `dist`
- Root directory: `smarttrading/frontend-react`

### 3. Set Environment Variables di Cloudflare
Settings → Environment variables → Add:
| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON` | `eyJ...` (anon key — READ ONLY) |

### 4. Deploy
Cloudflare auto-deploy setiap kali push ke main.

---

## Struktur Folder
```
src/
├── lib/
│   ├── supabase.js       # Supabase client
│   └── api.js            # Semua query ke DB
├── components/
│   ├── SignalCard.jsx     # Card reusable untuk sinyal
│   ├── BottomNav.jsx      # Navigasi bawah
│   └── TopBar.jsx         # Header app
├── screens/
│   ├── HomeScreen.jsx         # Market Pulse + Top Picks
│   ├── WatchlistScreen.jsx    # Portfolio + P&L
│   ├── DeepDiveScreen.jsx     # Search + analisis emiten
│   ├── GlobalPulseScreen.jsx  # Kripto + Fear&Greed + Makro
│   ├── AlertScreen.jsx        # Feed sinyal + Price alert
│   └── TrackRecordScreen.jsx  # Akurasi 30 hari
├── App.jsx    # Router + layout
├── main.jsx   # Entry point
└── index.css  # Design tokens + global styles
```

---
*SmartTrading v1.0 | Cloudflare Pages + Supabase + Groq*
