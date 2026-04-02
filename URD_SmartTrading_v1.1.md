# URD — SmartTrading
**User Requirements Document**
**Versi:** 1.1
**Tanggal:** 01 Apr 2026
**Status:** AKTIF

---

## CHANGELOG v1.0 → v1.1

| # | Tipe | Item | Detail |
|---|------|------|--------|
| 1 | REVISI | FR-002 | Hapus Alpha Vantage → pandas-ta open source (no API limit) |
| 2 | REVISI | FR-037, FR-038 | Hapus Twitter/X API → Google News RSS (gratis, lebih actionable) |
| 3 | REVISI | FR-041 | Whale activity scope-down: semua kripto → BTC + ETH saja |
| 4 | REVISI | Tech Stack | PostgreSQL lokal → Supabase free tier |
| 5 | REVISI | Tech Stack | PM2 + Nginx → GitHub Actions + Cloudflare Pages |
| 6 | TAMBAH | Tech Stack | Groq API (Llama 3.3 70B), pandas-ta |
| 7 | TAMBAH | FR-050 | P&L Unrealized Tracker |
| 8 | TAMBAH | FR-051 | Risk Sizing Calculator |
| 9 | TAMBAH | FR-052 | Signal History + Track Record Dashboard |
| 10 | TAMBAH | FR-053 | IDX Trading Calendar Awareness |
| 11 | TAMBAH | FR-054 | Diversification Checker |
| 12 | TAMBAH | NFR-008 | Confidence threshold minimum 70% |

---

## 1. RINGKASAN EKSEKUTIF

SmartTrading adalah aplikasi web mobile-first yang berfungsi sebagai **penasihat saham senior berbasis AI** untuk investor retail Indonesia pemula. Aplikasi ini BUKAN platform trading — tidak terhubung ke broker, tidak bisa melakukan order beli/jual. SmartTrading memberikan rekomendasi BUY/HOLD/SELL dalam bahasa manusia yang mudah dipahami, kemudian user mengeksekusi sendiri di platform pilihan mereka (Ajaib, Stockbit, Mirae, dll).

**Filosofi inti:** "Seperti punya teman yang ahli saham — kasih saran jelas, bukan lempar angka teknikal."

**Target user:** Investor retail Indonesia yang sudah punya akun broker, ingin panduan analisis, tapi tidak punya waktu atau kemampuan membaca chart teknikal sendiri.

---

## 2. ARSITEKTUR ZERO-COST

Seluruh infrastruktur dibangun dari layanan gratis permanen (bukan trial).

| Layer | Teknologi | Biaya | Limit |
|-------|-----------|-------|-------|
| Data OHLCV | yfinance (Yahoo Finance) | Gratis | ~900 emiten IDX |
| Indikator teknikal | pandas-ta (Python lib) | Gratis | Tidak ada limit |
| Berita & sentimen | Google News RSS | Gratis | Tidak ada limit |
| Data kripto | CoinGecko API | Gratis | 30 req/menit |
| LLM narasi | Groq API (Llama 3.3 70B) | Gratis | 14.400 req/hari |
| Database | Supabase free tier | Gratis | 500MB storage |
| Scheduler | GitHub Actions cron | Gratis | Unlimited (public repo) |
| Frontend hosting | Cloudflare Pages | Gratis | Unlimited bandwidth |
| Push notifikasi | Web Push API + VAPID | Gratis | Self-hosted |
| **TOTAL BIAYA** | | **Rp 0** | |

### 2.1 Jadwal Otomatis (GitHub Actions)

| Workflow | Jadwal | Tugas |
|----------|--------|-------|
| signal_engine.yml | Setiap 15 menit, Senin-Jumat 09:00-15:45 WIB | Core BUY/HOLD/SELL |
| news_fetcher.yml | Setiap 30 menit, Senin-Jumat 09:00-15:30 WIB | Fetch + cache berita |
| cleanup.yml | Setiap hari 16:00 WIB | Prune DB + evaluasi WIN/LOSS |

### 2.2 Pipeline Signal Engine

```
yfinance OHLCV 60d
      ↓
pandas-ta: RSI + MACD + EMA20/50 + Bollinger + Volume
      ↓
score_signal(): -6 s/d +6 → BUY/HOLD/SELL + confidence %
      ↓
Filter: confidence >= 70% (NFR-008)
      ↓
Groq Llama 3.3 70B: narasi bahasa manusia
      ↓
Supabase INSERT → tabel signals
```

---

## 3. FUNCTIONAL REQUIREMENTS

### MODUL A — MARKET PULSE (Halaman Home)

**FR-001** Tampilkan indikator pasar utama secara real-time: IHSG, USD/IDR, Harga Emas.
**FR-002** *(REVISI v1.1)* Data teknikal dihitung menggunakan **pandas-ta** (Python open-source library). Alpha Vantage dihapus karena limit 25 req/hari tidak memadai untuk 900+ emiten IDX.
**FR-003** Tampilkan "Top Picks Hari Ini" — maksimal 5 saham dengan confidence tertinggi di atas threshold.
**FR-004** Tampilkan "Defense Banner" secara kondisional jika IHSG turun >1.5% atau kondisi pasar bearish terdeteksi. Banner tidak bisa di-dismiss manual oleh user.
**FR-005** Tampilkan feed berita pasar terkini (dari news_cache Supabase).
**FR-006** Setiap Signal Card menampilkan: nama emiten, ticker, jenis sinyal (BUY/HOLD/SELL), confidence bar (visual, bukan angka mentah), dan perubahan harga hari ini.

---

### MODUL B — WATCHLIST & PORTFOLIO

**FR-010** User dapat menambah/hapus saham ke daftar watchlist pribadi (disimpan per user_id Supabase Auth).
**FR-011** Watchlist menampilkan sinyal terbaru untuk setiap saham yang dipantau.
**FR-012** Tampilkan ringkasan P&L unrealized seluruh portfolio di bagian atas halaman.
**FR-013** Setiap posisi portfolio menampilkan: ticker, lot, harga beli rata-rata, harga saat ini, untung/rugi Rp dan %.

**FR-050** *(BARU v1.1)* **P&L Unrealized Tracker:** User dapat input posisi aktif (ticker + lot + harga beli rata-rata + tanggal beli). Sistem menghitung dan menampilkan P&L unrealized secara otomatis berdasarkan harga terkini dari yfinance.

**FR-051** *(BARU v1.1)* **Risk Sizing Calculator:** Berdasarkan total modal yang diinput user, sistem memberikan saran maksimum lot per saham menggunakan formula: maks. 5% modal per posisi. Contoh: modal Rp 10 juta → maks. Rp 500.000 per saham = ~X lot berdasarkan harga saat ini.

**FR-054** *(BARU v1.1)* **Diversification Checker:** Sistem otomatis menampilkan warning jika satu sektor mendominasi >40% dari total nilai portfolio user. Warning ditampilkan di halaman Watchlist, tidak bisa di-dismiss selama kondisi masih berlaku.

---

### MODUL C — SIGNAL DETAIL MODAL

Signal Detail Modal muncul saat user mengetuk saham mana pun. Filosofi: **penasihat senior, bukan terminal trading.**

**FR-020** Tampilkan verdict dalam narasi panjang bahasa manusia (dihasilkan Groq LLM). Contoh: *"BBCA saat ini layak untuk dipertimbangkan. Harga baru saja melewati area support dengan volume yang meningkat dua kali lipat dari rata-rata, mengindikasikan investor besar mulai mengakumulasi."*

**FR-021** Tampilkan "Panduan untuk Broker" — range harga wajar (bukan exact order price) yang bisa user sampaikan ke broker atau input manual di app mereka.

**FR-022** Tampilkan bagian "Kenapa?" — terjemahan indikator teknikal ke bahasa awam. TIDAK boleh menampilkan angka RSI/MACD/EMA secara mentah. Contoh yang benar: *"Volume 2x lipat = investor besar mulai masuk"*, bukan *"RSI: 58.4"*.

**FR-023** Tampilkan bagian "Yang bisa membuat analisis ini salah" — risiko eksplisit minimal 1 poin per signal.

**FR-024** Tombol CTA: **[Salin Ringkasan untuk Broker]** — menyalin teks plain (narasi + range harga + risiko) ke clipboard. TIDAK ADA tombol Beli/Jual/Order dalam bentuk apapun.

**FR-025** Tampilkan confidence bar visual (bukan angka persen mentah) disertai label kontekstual: "Keyakinan Rendah / Sedang / Tinggi / Sangat Tinggi".


---

### MODUL D — DEEP DIVE (Analisis Mendalam per Emiten)

**FR-030** User dapat search ticker atau nama perusahaan secara bebas.
**FR-031** Tampilkan profil singkat emiten: nama, sektor, market cap tier (LQ45/IDX80/SMALL/MICRO).
**FR-032** Tampilkan siklus bisnis historis — apakah emiten ini musiman? Kapan biasanya peak performance?
**FR-033** Tampilkan price target kualitatif berbasis analisis fundamental sederhana (P/E relatif sektoral).
**FR-034** Tampilkan risiko regulasi yang relevan untuk sektor emiten tersebut (dari event_playbook).
**FR-035** Tampilkan riwayat sinyal 30 hari terakhir untuk emiten tersebut beserta outcome WIN/LOSS-nya.

---

### MODUL E — GLOBAL PULSE (Sentimen Makro & Kripto)

**FR-037** *(REVISI v1.1)* Berita makro global diambil dari **Google News RSS** (feed: bisnis, ekonomi, pasar). Twitter/X API dihapus karena berbayar ($100/bulan sejak 2023).
**FR-038** *(REVISI v1.1)* Sentimen berita dianalisis oleh **Groq LLM** (bukan Twitter sentiment API).
**FR-039** Tampilkan Fear & Greed Index visual berbasis gauge chart — sumber: CoinGecko API (gratis).
**FR-040** Tampilkan events geopolitik/makro yang sedang berlangsung dan dampak historisnya pada IHSG (dari tabel event_playbook).
**FR-041** *(REVISI v1.1)* Pantau aktivitas whale kripto hanya untuk **BTC** (via blockchain.info) dan **ETH** (via Etherscan public API). Scope 50+ kripto dihapus karena tidak ada sumber data gratis yang reliable.

---

### MODUL F — ALERT & NOTIFIKASI

**FR-045** Kirim push notification (Web Push API) saat ada sinyal baru dengan confidence ≥ 70% untuk saham di watchlist user.
**FR-046** Kirim alert khusus jika Defense Banner aktif (kondisi pasar bearish mendadak).
**FR-047** User dapat set preferensi notifikasi: jenis sinyal apa saja yang ingin diterima (BUY only / semua).
**FR-048** Notifikasi berisi: ticker, jenis sinyal, confidence label, dan preview 1 kalimat narasi.

---

### MODUL G — TRACK RECORD & KALENDER

**FR-052** *(BARU v1.1)* **Signal History + Track Record Dashboard:** Halaman khusus yang menampilkan akurasi sinyal sistem 30 hari terakhir. Breakdown per jenis sinyal (BUY/HOLD/SELL): total signal, WIN, LOSS, win rate %. Data dari tabel signal_history + view v_signal_accuracy_30d.

**FR-053** *(BARU v1.1)* **IDX Trading Calendar:** Sistem aware terhadap hari libur nasional Indonesia dan half-day trading. Signal engine tidak berjalan di hari libur nasional. Tampilkan informasi "Market tutup" di halaman Home pada hari libur.


---

## 4. NON-FUNCTIONAL REQUIREMENTS

**NFR-001** Aplikasi mobile-first, responsif di layar 360px–430px (ukuran smartphone Indonesia umum).
**NFR-002** Waktu load halaman Home < 3 detik pada koneksi 4G rata-rata Indonesia.
**NFR-003** Supabase free tier 500MB harus cukup. Strategi penghematan: news_cache auto-expire 24h, signals auto-prune >7 hari (via cleanup.yml).
**NFR-004** Signal engine harus selesai dalam < 8 menit per run (batas timeout GitHub Actions job = 10 menit).
**NFR-005** Semua data user (watchlist, portfolio) dilindungi Row Level Security (RLS) Supabase — user hanya bisa akses data miliknya.
**NFR-006** Tidak ada penyimpanan password di aplikasi — autentikasi via Supabase Auth (email magic link atau OAuth Google).
**NFR-007** Aplikasi harus tetap bisa digunakan (read-only mode) jika GitHub Actions sedang down — tampilkan sinyal terakhir yang tersedia di Supabase.
**NFR-008** *(BARU v1.1)* **Confidence threshold minimum 70%.** Sinyal dengan confidence < 70% tidak boleh masuk halaman Home, Watchlist, atau dikirim sebagai notifikasi. Parameter ini disimpan di tabel system_config (key: `confidence_threshold`) dan bisa diubah tanpa deploy ulang.

---

## 5. SCHEMA DATABASE (Supabase)

8 tabel utama — detail lengkap di file `schema_supabase.sql`:

| Tabel | Tipe | Deskripsi |
|-------|------|-----------|
| emiten_meta | Statis | Master data ~900 emiten IDX |
| signals | Dinamis | Output BUY/HOLD/SELL + narasi LLM, update tiap 15 menit |
| news_cache | Dinamis | Cache berita RSS, TTL 24 jam |
| watchlist | User data | Daftar pantauan per user (RLS aktif) |
| portfolio | User data | Posisi + P&L tracker per user (RLS aktif) |
| signal_history | Historis | Track record WIN/LOSS per signal |
| event_playbook | Statis | Template strategi per kondisi makro |
| system_config | Config | Parameter runtime (threshold, TTL, dll) |

**Views tersedia:**
- `v_latest_signals` — sinyal terbaru per ticker, confidence ≥ 70%, belum expired
- `v_signal_accuracy_30d` — akurasi WIN rate per jenis sinyal, 30 hari terakhir


---

## 6. UI/UX DESIGN SPECIFICATION

### 6.1 Design Philosophy
Aesthetic: **Dark Financial Terminal** — terasa profesional dan serius, tapi tetap bisa dipahami pemula.

### 6.2 Color System

| Token | Hex | Penggunaan |
|-------|-----|-----------|
| `bg-primary` | `#0B0D12` | Background utama (charcoal gelap) |
| `signal-buy` | `#00C896` | Sinyal BUY, positive P&L (neon teal) |
| `signal-hold` | `#F5A623` | Sinyal HOLD, netral (amber) |
| `signal-sell` | `#FF4455` | Sinyal SELL, negative P&L (crimson) |
| `text-primary` | `#EDF2FF` | Teks utama |
| `text-secondary` | `#8B95A8` | Label, metadata |
| `surface` | `#161B25` | Card, modal background |
| `border` | `#252D3D` | Divider, border card |

**Font angka:** JetBrains Mono (monospace) — untuk harga, persentase, confidence.
**Font teks:** Inter atau sistem sans-serif.

### 6.3 Lima Screen Utama

| # | Screen | Fungsi Utama |
|---|--------|-------------|
| 1 | **Home** | Market Pulse (IHSG/USD/Emas) + Top Picks + Defense Banner + Berita |
| 2 | **Watchlist** | Posisi portfolio + P&L Summary + Diversification Warning |
| 3 | **Deep Dive** | Search emiten + profil + siklus + risiko regulasi |
| 4 | **Global Pulse** | Kripto BTC+ETH + Fear & Greed gauge + Events makro |
| 5 | **Alert** | Feed notifikasi color-coded + Track Record dashboard |

### 6.4 Komponen Kunci

**Signal Card**
- Left accent bar: warna sesuai jenis sinyal (teal/amber/crimson)
- Baris 1: Nama emiten + ticker
- Baris 2: Label sinyal + confidence bar visual (bukan angka)
- Baris 3: Harga saat ini + perubahan % hari ini

**Signal Detail Modal** (muncul saat tap saham)
- Header: nama + jenis sinyal + confidence label
- Bagian VERDICT: narasi panjang bahasa manusia (3-4 kalimat)
- Bagian KENAPA: terjemahan indikator ke awam (bullet 2-3 poin)
- Bagian PANDUAN UNTUK BROKER: range harga + konteks
- Bagian RISIKO: 1-2 poin risiko eksplisit
- CTA: [Salin Ringkasan untuk Broker] — copy ke clipboard
- **TIDAK ADA** tombol Beli / Jual / Order dalam bentuk apapun

**Defense Banner**
- Tampil kondisional di atas halaman Home
- Background: `#FF4455` dengan ikon peringatan
- Pesan: penjelasan kondisi pasar + saran defensif
- Tidak bisa di-dismiss manual

**Confidence Bar**
- Visual bar fill (0-100%)
- Label: Rendah (<50%) / Sedang (50-69%) / Tinggi (70-84%) / Sangat Tinggi (≥85%)
- Warna bar mengikuti warna sinyal


---

## 7. ROADMAP BUILD

Urutan build yang direkomendasikan berdasarkan dependency:

```
Phase 1 — Backend Foundation (SELESAI ✅)
  ├── B) Schema Database Supabase     ✅ schema_supabase.sql
  ├── C) Signal Engine Python         ✅ signal_engine.py
  └── D) GitHub Actions Workflow      ✅ .github/workflows/

Phase 2 — Dokumentasi (SELESAI ✅)
  └── A) URD v1.1                     ✅ URD_SmartTrading_v1.1.md (ini)

Phase 3 — Frontend (BERIKUTNYA)
  ├── E) Update Desain Home + Watchlist  ← NEXT
  ├── news_fetcher.py (stub tersedia)
  └── React + Cloudflare Pages deploy

Phase 4 — Fitur Lanjutan
  ├── FR-050: P&L Tracker UI
  ├── FR-051: Risk Sizing Calculator UI
  ├── FR-052: Track Record Dashboard
  ├── FR-053: IDX Calendar integration
  └── FR-054: Diversification Checker logic
```

---

## 8. STATUS DELIVERABLE SESI 1 APR 2026

| Deliverable | File | Status |
|-------------|------|--------|
| Schema Database | `schema_supabase.sql` | ✅ DONE |
| Signal Engine | `signal_engine.py` | ✅ DONE |
| GitHub Actions | `.github/workflows/*.yml` | ✅ DONE |
| Cleanup Script | `cleanup.py` | ✅ DONE |
| Setup Guide | `GITHUB_SETUP.md` | ✅ DONE |
| URD v1.1 | `URD_SmartTrading_v1.1.md` | ✅ DONE |
| Desain Home + Watchlist (update) | TBD | ⏳ NEXT |
| news_fetcher.py (full) | TBD | ⏳ PENDING |

---

## 9. CATATAN IMPLEMENTASI PENTING

1. **Groq API limit:** 14.400 req/hari. Dengan MAX_TICKERS_RUN=50 dan 26 run/hari (tiap 15 menit, 6,5 jam market), kebutuhan maksimal = 50 × 26 = 1.300 req/hari. Jauh di bawah limit. ✅

2. **Supabase 500MB:** Estimasi ukuran per hari: signals ~500 row × 2KB = 1MB/hari. Dengan prune 7 hari = maks. 7MB untuk signals. News cache ~200 entry × 1KB = 200KB/hari, auto-expire 24h. Total aman. ✅

3. **yfinance rate limit:** Tidak ada limit resmi, tapi praktik baik pakai sleep 0.5s antar ticker. Dengan 50 ticker = 25 detik total fetch time per run. Dalam batas timeout 10 menit GitHub Actions. ✅

4. **RLS Supabase:** Pastikan anon key yang dipakai di frontend hanya READ untuk tabel publik. Service role key HANYA untuk GitHub Actions (backend), tidak boleh ada di kode frontend.

---

*URD SmartTrading v1.1 | Ditulis: 01 Apr 2026 | Session: 01Apr2026-Session*
*Revisi berikutnya: setelah Phase 3 Frontend selesai → URD v1.2*
