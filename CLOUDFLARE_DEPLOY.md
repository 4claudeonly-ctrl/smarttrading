# SmartTrading — Panduan Deploy Cloudflare Pages
**Versi:** 2.0 | 03 Apr 2026
**Estimasi waktu:** 15-20 menit (pertama kali) | ~5 menit (update berikutnya)

---

## Prasyarat

- [x] Akun GitHub (repo sudah ada atau baru buat)
- [x] Akun Cloudflare (gratis: https://dash.cloudflare.com)
- [x] Supabase project sudah running (URL + anon key tersedia)
- [x] Node.js 18+ terinstall di lokal (untuk test build)

---

## LANGKAH 1: Test Build Lokal (5 menit)

Sebelum deploy, pastikan build tidak error:

```bash
cd C:\FOLDER4CLAUDE\smarttrading\frontend-react

# Install dependencies
npm install

# Copy env example + isi nilai
copy .env.example .env.local
```

Isi `.env.local` dengan nilai dari Supabase Dashboard:
```
VITE_SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

```bash
# Jalankan dev server
npm run dev
# Buka http://localhost:5173 — pastikan tidak ada error merah

# Test build production
npm run build
# Harus muncul: dist/ folder berisi index.html + assets/
```

---

## LANGKAH 2: Push ke GitHub (3 menit)

```bash
cd C:\FOLDER4CLAUDE\smarttrading

# Inisialisasi repo (skip jika sudah ada)
git init
git remote add origin https://github.com/USERNAME/smarttrading.git

# Add semua file
git add .
git commit -m "feat: SmartTrading v2.0 — 4-komponen scoring engine"
git push -u origin main
```

> **PENTING:** Pastikan `.gitignore` sudah ada di frontend-react/
> File `.env.local` TIDAK boleh masuk git (sudah ada di .gitignore)


---

## LANGKAH 3: Setup Cloudflare Pages (7 menit)

### 3a. Buat Project Baru

1. Login ke https://dash.cloudflare.com
2. Sidebar kiri → **Workers & Pages**
3. Klik **Create application** → **Pages** → **Connect to Git**
4. Pilih **GitHub** → authorize Cloudflare
5. Pilih repo `smarttrading`
6. Klik **Begin setup**

### 3b. Konfigurasi Build

Isi form dengan nilai berikut:

| Field | Nilai |
|-------|-------|
| **Project name** | `smarttrading` (atau sesuka hati) |
| **Production branch** | `main` |
| **Framework preset** | `Vite` |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory** | `smarttrading/frontend-react` |

### 3c. Set Environment Variables

Masih di halaman setup yang sama, scroll ke bawah ke **Environment variables**:

Klik **+ Add variable** untuk masing-masing:

| Variable name | Value | Production | Preview |
|---------------|-------|------------|---------|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | ✅ | ✅ |
| `VITE_SUPABASE_ANON` | `eyJ...` (anon key) | ✅ | ✅ |

> **INGAT:**
> - Gunakan **anon key** (bukan service_role key)
> - Anon key = public, READ ONLY via RLS Supabase
> - Service key HANYA untuk GitHub Actions (backend), JANGAN taruh di frontend

### 3d. Deploy

Klik **Save and Deploy** → tunggu 2-3 menit → build selesai.

URL production akan berupa: `https://smarttrading.pages.dev`
(atau custom domain jika sudah dikonfigurasi)

---

## LANGKAH 4: Verifikasi Deploy

Buka URL production. Cek checklist ini:

```
[ ] Halaman Home termuat (tidak blank putih)
[ ] Market Pulse section tampil (3 kartu IHSG, USD/IDR, Emas)
[ ] Tidak ada error merah di browser console (F12)
[ ] Bottom navigation 5 tab bisa diklik
[ ] Deep Dive: search emiten bisa diketik
```

Jika ada error di console, lihat bagian **Troubleshooting** di bawah.

---

## LANGKAH 5: Auto-Deploy (Gratis — Sudah Aktif)

Setelah setup, setiap kali kamu push ke branch `main`:
```bash
git add .
git commit -m "fix: update signal card UI"
git push
```
Cloudflare Pages otomatis trigger build baru. Selesai dalam ~2 menit.

---


## Troubleshooting

### Build gagal: "Cannot find module"
```
Error: Cannot find module '@supabase/supabase-js'
```
**Solusi:** Pastikan Root directory di Cloudflare = `smarttrading/frontend-react`
dan bukan root repo. Build command `npm install && npm run build` jika perlu.

### Halaman blank putih setelah deploy
Buka F12 → Console. Biasanya:
- `VITE_SUPABASE_URL is not defined` → Environment variable belum diset di Cloudflare
- `Failed to fetch` → Supabase URL salah atau anon key expired

**Solusi:** Cloudflare Dashboard → Pages → smarttrading → Settings → Environment variables → edit nilai.

### React Router: halaman 404 saat refresh
Cloudflare Pages tidak tahu SPA routing secara default.

**Solusi:** Buat file `smarttrading/frontend-react/public/_redirects`:
```
/*  /index.html  200
```
Atau tambahkan `_headers` jika diperlukan.

### Data tidak muncul (sinyal kosong)
1. Cek Supabase — apakah tabel `signals` sudah ada data?
2. Cek RLS: anon key boleh SELECT dari tabel `signals`?
3. Di Supabase Dashboard → Authentication → Policies → pastikan ada policy READ untuk `signals`

---

## Struktur File Referensi

```
smarttrading/
├── frontend-react/          ← Root directory untuk Cloudflare
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   ├── .env.example         ← Copy ke .env.local untuk dev
│   ├── .gitignore           ← .env.local sudah dikecualikan
│   ├── public/
│   │   └── _redirects       ← Buat ini untuk SPA routing fix
│   └── src/
│       ├── lib/
│       │   ├── supabase.js  ← Supabase client
│       │   └── api.js       ← Semua query (v2.0)
│       ├── components/
│       │   ├── SignalCard.jsx  ← Badge fase + macro (v2.0)
│       │   ├── BottomNav.jsx
│       │   └── TopBar.jsx
│       └── screens/
│           ├── HomeScreen.jsx     ← Macro events banner (v2.0)
│           ├── WatchlistScreen.jsx
│           ├── DeepDiveScreen.jsx
│           ├── GlobalPulseScreen.jsx
│           ├── AlertScreen.jsx
│           └── TrackRecordScreen.jsx
├── signal_engine.py         ← v2.0, 4-komponen scoring
├── phase_detector.py        ← Cacing/naga detector
├── macro_trigger.py         ← RSS keyword → macro events
├── broker_flow.py           ← Konsentrasi broker HHI
├── schema_supabase.sql      ← Schema v1.0 (base)
├── schema_additions_v2.sql  ← Schema v2.0 (apply ini setelah v1.0)
└── GITHUB_SETUP.md          ← Panduan GitHub Actions backend
```

---

## Checklist Deployment Lengkap

```
BACKEND (GitHub Actions):
[ ] schema_supabase.sql dijalankan di Supabase SQL Editor
[ ] schema_additions_v2.sql dijalankan setelahnya
[ ] GitHub repo dibuat (public)
[ ] 3 GitHub Secrets diset: SUPABASE_URL, SUPABASE_SERVICE_KEY, GROQ_API_KEY
[ ] Workflow signal_engine.yml, news_fetcher.yml, cleanup.yml aktif

FRONTEND (Cloudflare Pages):
[ ] npm install + npm run build berhasil di lokal
[ ] Repo di-push ke GitHub
[ ] Cloudflare Pages project dibuat dengan konfigurasi Vite
[ ] 2 env vars diset: VITE_SUPABASE_URL + VITE_SUPABASE_ANON
[ ] Deploy berhasil, URL production aktif
[ ] public/_redirects dibuat untuk SPA routing
[ ] Verifikasi: Home screen tampil, navigation berfungsi
```

---
*SmartTrading v2.0 | 03 Apr 2026 | Zero-Cost Architecture*
