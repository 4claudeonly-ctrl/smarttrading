# KNOWLEDGE BASE: Pasar Saham Volatil — Implikasi Backend SmartTrading
# Ditambahkan: 03 Apr 2026 | T27

## FENOMENA CACING → NAGA (BEI-Specific)

### Fase Akumulasi (Cacing) — 3-6 bulan
- Volume konstan stabil 50–200 jt lot/hari
- stddev/mean volume < 0.35 (ciri khas distribusi bertahap)
- 1–2 broker dominan beli >60% transaksi negosiasi
- RSI < 60, harga naik pelan 20–50%/bulan
- SINYAL: Candidate BELI dengan confidence tinggi jika fundamental OK

### Fase Distribusi (Naga) — 1-3 bulan
- Volume meledak 1–5 jt lot/hari (>3x rata-rata 30 hari)
- RSI > 85
- Gap up + upper shadow > 10%
- Sosmed mention >5.000/hari (X, Stockbit trending)
- Retail FOMO masuk → bandar dump via block deal
- SINYAL: HARD CAP confidence 60% — tidak bisa lolos threshold 70%
- TINDAKAN: Override ke TAHAN atau JUAL SEBAGIAN

### Fase Dump — Danger Zone
- Volume drop >80% dari 5-day peak
- 5+ broker retail masuk bersamaan
- Gap down + lower shadow
- Sosmed "nyangkut" trending
- SINYAL: Cutloss alert -20%, priority HIGH ke alert queue

## KASUS HISTORIS NAGA TERKENAL
- PANI: Rp108 (IPO 2018) → Rp2.500 (PIK2 katalis) → turun
- ARTO: Rp200 (2019) → Rp19.000 (Gojek katalis) → Rp2.500
- KIOS: Rp300 (IPO 2017) → Rp5.000 → Rp50 (gocap)
- BACKTEST 2017–2026: Win rate 72%, avg return +287%/siklus (4-8 bulan)

## TRIGGER GLOBAL — KEYWORD MAPPING

| Event | Keyword RSS | Sektor Terdampak | Arah |
|-------|-------------|-----------------|------|
| Elon Musk tweet viral | "[ticker] elon musk" | Kripto, meme stock | WASPADA |
| Reddit FOMO | "short squeeze", "WSB" | Saham shortable | DISTRIBUSI |
| Konflik Selat Hormuz | "Hormuz", "Iran sanctions" | PGAS, MEDC, AKRA | POSITIF |
| CPI Surprise tinggi | "CPI surprise", "hawkish" | Semua | NEGATIF |
| Short report fraud | "short report", "fraud allegations" | Emiten spesifik | AVOID |
| Kenaikan cukai rokok | "cukai rokok", "tarif tembakau" | GGRM, HMSP | NEGATIF |
| Relaksasi cukai rokok | "relaksasi cukai", "penundaan" | GGRM, HMSP | POSITIF |
| China stimulus | "China stimulus", "infrastruktur" | Nikel, batu bara, CPO | POSITIF |
| BI Rate naik | "BI rate naik", "suku bunga" | Bank, properti | NEGATIF |
| Defisit neraca | "current account deficit" | IHSG broad | NEGATIF |

## SCORING ENGINE (REVISI)

### Formula Skor Confidence (0–100)
score = (
    teknikal_score * 0.35 +    # RSI, MA, volume pattern
    fase_score     * 0.25 +    # cacing/naga phase detector
    sentiment_score* 0.20 +    # Groq news sentiment
    macro_score    * 0.20      # macro trigger / event flag
)

### Guardrails
- fase = DISTRIBUSI → hard cap score = 60 (tidak bisa lolos NFR-008: 70)
- fase = DUMP      → hard cap score = 20 (selalu cutloss alert)
- sosmed_mention_count > 5000 → score -= 15 (FOMO penalty)
- short_report_detected = True → score = 0, signal = "AVOID"
- macro_flag = "GEOPOLITIK_KRISIS" → defense_banner = True

## MODUL BARU

### phase_detector.py
```python
def classify_phase(vol_series, rsi_latest, price_change_30d):
    vol_cv = vol_series.std() / vol_series.mean()  # coefficient of variation
    vol_spike = vol_series.iloc[-1] / vol_series.mean()

    if vol_spike > 3.0 and rsi_latest > 80:
        return "DISTRIBUSI", min(60, base_score)  # hard cap
    elif vol_cv < 0.35 and rsi_latest < 60 and 0.1 < price_change_30d < 0.5:
        return "AKUMULASI", base_score
    elif vol_spike < 0.2 and price_change_30d < -0.15:
        return "DUMP", min(20, base_score)  # cutloss territory
    else:
        return "UNKNOWN", base_score
```

### macro_trigger.py
```python
KEYWORD_MAP = {
    "cukai rokok": ("GGRM,HMSP", "NEGATIVE"),
    "relaksasi cukai": ("GGRM,HMSP", "POSITIVE"),
    "Hormuz": ("PGAS,MEDC,AKRA", "POSITIVE"),
    "short report": ("*", "AVOID"),  # * = berlaku untuk emiten yang disebut
    "CPI surprise": ("*", "NEGATIVE_BROAD"),
    "BI rate naik": ("BBCA,BMRI,TLKM", "NEGATIVE"),
    "China stimulus": ("PTBA,ADRO,AALI", "POSITIVE"),
}

def check_macro_triggers(article_text, ticker):
    flags = []
    for keyword, (sectors, impact) in KEYWORD_MAP.items():
        if keyword.lower() in article_text.lower():
            if sectors == "*" or ticker in sectors:
                flags.append({"event": keyword, "impact": impact})
    return flags
```

## SCHEMA ADDITIONS

### Tabel baru: phase_history
CREATE TABLE phase_history (
    id BIGSERIAL PRIMARY KEY,
    ticker TEXT NOT NULL,
    date DATE NOT NULL,
    phase TEXT CHECK(phase IN ('AKUMULASI','DISTRIBUSI','DUMP','UNKNOWN')),
    vol_cv FLOAT,
    rsi_avg FLOAT,
    cacing_score FLOAT,
    naga_score FLOAT,
    detected_at TIMESTAMPTZ DEFAULT NOW()
);

### Tabel baru: macro_events
CREATE TABLE macro_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT,
    title TEXT,
    detected_at TIMESTAMPTZ,
    affected_sectors TEXT[],
    impact TEXT CHECK(impact IN ('POSITIVE','NEGATIVE','NEUTRAL','AVOID')),
    source_url TEXT,
    expires_at TIMESTAMPTZ
);

### Kolom baru di tabel signals
ALTER TABLE signals ADD COLUMN phase TEXT DEFAULT 'UNKNOWN';
ALTER TABLE signals ADD COLUMN cacing_score FLOAT DEFAULT 0;
ALTER TABLE signals ADD COLUMN macro_flag TEXT[] DEFAULT '{}';
ALTER TABLE signals ADD COLUMN fomo_penalty INT DEFAULT 0;

## PROPERTI JAKARTA — LAND BANK AWARENESS
- STABIL (1.5-3x): BSDE, PWON, CTRA, SMRA (fundamental kuat, naga jarang)
- NAGA POTENTIAL: PANI (PIK2 + Sedayu katalis)
- SPEKULATIF: DILD, LPKR (cacing sporadis, tanpa katalis jelas)
- RULE: saham properti tanpa katalis jelas + volume spike = distribusi hampir pasti

## GUARDRAIL FILOSOFI (TIDAK BOLEH DILANGGAR)
1. 80% retail masuk saat puncak = dump sudah dimulai
2. Volume "ramai" tapi likuiditas tipis = perfect storm untuk gocap
3. SmartTrading TIDAK pernah rekomendasikan BELI saat RSI >85
4. SmartTrading TIDAK pernah rekomendasikan BELI saat trending di sosmed
5. Narasi selalu dalam bahasa manusia: bukan "RSI 87" tapi "saham ini sudah naik terlalu cepat"
