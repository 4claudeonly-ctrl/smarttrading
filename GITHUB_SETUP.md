# SmartTrading — GitHub Actions Setup Guide

## Prasyarat
- Akun GitHub (repo public = GitHub Actions gratis unlimited)
- Akun Supabase free tier (sudah setup schema)
- Akun Groq (ambil API key di console.groq.com — gratis)

---

## Langkah 1: Buat GitHub Repository

```bash
# Di folder smarttrading:
git init
git remote add origin https://github.com/USERNAME/smarttrading.git
git add .
git commit -m "feat: initial SmartTrading engine"
git push -u origin main
```

---

## Langkah 2: Set GitHub Secrets

Buka: `GitHub Repo → Settings → Secrets and variables → Actions → New repository secret`

| Secret Name | Nilai | Cara Dapat |
|-------------|-------|------------|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Supabase → Settings → API |
| `SUPABASE_SERVICE_KEY` | `eyJ...` | Supabase → Settings → API → service_role key |
| `GROQ_API_KEY` | `gsk_...` | console.groq.com → API Keys |

**PENTING:** Gunakan `service_role` key (bukan `anon` key) agar bisa INSERT ke tabel.

---

## Langkah 3: Aktifkan GitHub Actions

Setelah push, buka tab **Actions** di repo GitHub.
Workflows akan aktif otomatis. Cron mulai berjalan sesuai jadwal.

---

## Jadwal Workflow

| Workflow | Cron (UTC) | WIB | Frekuensi |
|----------|-----------|-----|-----------|
| `signal_engine.yml` | `0,15,30,45 2-8 * * 1-5` | 09:00-15:45 | tiap 15 menit |
| `news_fetcher.yml` | `0,30 2-8 * * 1-5` | 09:00-15:30 | tiap 30 menit |
| `cleanup.yml` | `0 9 * * 1-5` | 16:00 | sekali sehari |

---

## Run Manual (Testing)

Buka: `Actions → pilih workflow → Run workflow`

Untuk signal_engine: bisa isi `ticker_override=BBCA,TLKM` untuk test saham tertentu.
Untuk cleanup: centang `dry_run=true` untuk lihat preview tanpa hapus data.

---

## Struktur File

```
smarttrading/
├── .github/
│   └── workflows/
│       ├── signal_engine.yml   # Core BUY/HOLD/SELL, */15 menit
│       ├── news_fetcher.yml    # RSS news cache, */30 menit
│       └── cleanup.yml         # DB cleanup + evaluate, harian
├── signal_engine.py            # Pipeline utama
├── news_fetcher.py             # RSS fetcher (TODO: next session)
├── cleanup.py                  # Cleanup + signal evaluator
├── schema_supabase.sql         # Schema DB (jalankan 1x di Supabase SQL editor)
└── requirements.txt            # Python dependencies
```

---

## Monitoring

- **Logs real-time:** Actions → pilih run → klik job
- **Artifacts:** Log disimpan 2-7 hari per workflow
- **Alert gagal:** GitHub kirim email otomatis jika workflow error
- **Supabase dashboard:** Pantau jumlah rows di tabel signals

---
*SmartTrading v1.0 | 01 Apr 2026*
