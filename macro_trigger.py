"""
macro_trigger.py — Macro Event Detector & Sector Impact Engine
==============================================================
Monitor berita RSS untuk event geopolitik, kebijakan, dan corporate event
yang menggerakkan harga secara mendadak.

Pipeline:
  news_cache (Supabase) → keyword scan → macro_events table
  → signal_engine inject → Groq narasi disesuaikan

Contoh kasus nyata yang dihandle:
  - Cukai rokok 2024: GGRM -81%, HMSP -18%
  - Short report Hindenburg → Adani -50%
  - Selat Hormuz → minyak +40%
  - Reddit/WSB FOMO → confidence penalty
"""

import os, re, json
from datetime import datetime, timezone, timedelta
from typing import Optional
from dataclasses import dataclass, field


# ── Data structure ──────────────────────────────────────────────────

@dataclass
class MacroEvent:
    event_type: str
    title: str
    affected_tickers: list
    affected_sectors: list
    impact: str           # POSITIVE | NEGATIVE | NEUTRAL | AVOID
    severity: str         # LOW | MEDIUM | HIGH | CRITICAL
    confidence_modifier: int  # Tambah/kurangi dari base confidence
    narasi_hint: str      # Petunjuk untuk Groq prompt
    expires_hours: int = 24   # Berapa jam event ini relevan
    source_url: str = ""
    detected_at: str = ""

    def to_dict(self) -> dict:
        return {
            "event_type":          self.event_type,
            "title":               self.title,
            "affected_tickers":    self.affected_tickers,
            "affected_sectors":    self.affected_sectors,
            "impact":              self.impact,
            "severity":            self.severity,
            "confidence_modifier": self.confidence_modifier,
            "narasi_hint":         self.narasi_hint,
            "expires_at":          (
                datetime.now(timezone.utc) +
                timedelta(hours=self.expires_hours)
            ).isoformat(),
            "source_url":  self.source_url,
            "detected_at": self.detected_at or datetime.now(timezone.utc).isoformat(),
        }


# ── Keyword mapping table ───────────────────────────────────────────
# Format: keyword → (event_type, affected_tickers, affected_sectors,
#                     impact, severity, conf_modifier, narasi_hint, expires_h)

KEYWORD_RULES = [
    # ── CUKAI ROKOK ──────────────────────────────────────────────────
    {
        "keywords": ["kenaikan cukai rokok", "cukai tembakau naik",
                     "tarif cukai rokok", "pp cukai 2025", "pp cukai 2026"],
        "event_type":   "CUKAI_ROKOK_NAIK",
        "tickers":      ["GGRM", "HMSP", "WIIM"],
        "sectors":      ["ROKOK"],
        "impact":       "NEGATIVE",
        "severity":     "HIGH",
        "conf_modifier": -25,
        "narasi_hint":  "Pemerintah menaikkan cukai rokok — tekanan besar pada margin GGRM/HMSP. "
                        "Laba bisa tertekan signifikan seperti 2024 (GGRM -81%).",
        "expires_h":    72,
    },
    {
        "keywords": ["relaksasi cukai rokok", "penundaan cukai",
                     "cukai rokok tidak naik", "cukai rokok ditahan"],
        "event_type":   "CUKAI_ROKOK_RELAKSASI",
        "tickers":      ["GGRM", "HMSP", "WIIM"],
        "sectors":      ["ROKOK"],
        "impact":       "POSITIVE",
        "severity":     "MEDIUM",
        "conf_modifier": +20,
        "narasi_hint":  "Rumor/konfirmasi relaksasi cukai rokok — buy the rumor pattern. "
                        "Historis GGRM+HMSP bisa naik 20-22% dalam beberapa hari.",
        "expires_h":    48,
    },
    # ── GEOPOLITIK ───────────────────────────────────────────────────
    {
        "keywords": ["selat hormuz", "hormuz strait", "iran sanctions",
                     "iran blockade", "blokade hormuz"],
        "event_type":   "GEOPOLITIK_HORMUZ",
        "tickers":      ["PGAS", "MEDC", "AKRA", "ENRG"],
        "sectors":      ["ENERGI", "MINYAK"],
        "impact":       "POSITIVE",
        "severity":     "HIGH",
        "conf_modifier": +15,
        "narasi_hint":  "Ketegangan Selat Hormuz berpotensi mendorong harga minyak +40%. "
                        "Saham energi Indonesia (PGAS, MEDC) biasanya ikut menguat.",
        "expires_h":    48,
    },
    {
        "keywords": ["russia ukraine", "rusia ukraina", "nato conflict",
                     "war escalation", "konflik rusia"],
        "event_type":   "GEOPOLITIK_PERANG",
        "tickers":      ["ANTM", "MDKA", "UNTR"],
        "sectors":      ["LOGAM_MULIA", "PERTAMBANGAN"],
        "impact":       "POSITIVE",
        "severity":     "HIGH",
        "conf_modifier": +10,
        "narasi_hint":  "Eskalasi konflik geopolitik mendorong safe-haven. "
                        "Emas dan logam industri biasanya menguat.",
        "expires_h":    48,
    },
    # ── MAKRO GLOBAL ─────────────────────────────────────────────────
    {
        "keywords": ["cpi surprise", "inflasi as melonjak", "us inflation high",
                     "fed rate hike", "federal reserve hike", "hawkish fed"],
        "event_type":   "MAKRO_FED_HAWKISH",
        "tickers":      [],         # broad market
        "sectors":      ["SEMUA"],
        "impact":       "NEGATIVE",
        "severity":     "HIGH",
        "conf_modifier": -15,
        "narasi_hint":  "CPI/Fed hawkish mengancam arus modal keluar dari pasar berkembang. "
                        "IHSG rentan koreksi, hindari posisi baru hari ini.",
        "expires_h":    24,
    },
    {
        "keywords": ["fed rate cut", "federal reserve cut", "fed pivot",
                     "pemangkasan suku bunga as", "dovish fed"],
        "event_type":   "MAKRO_FED_DOVISH",
        "tickers":      [],
        "sectors":      ["BANK", "PROPERTI", "SEMUA"],
        "impact":       "POSITIVE",
        "severity":     "MEDIUM",
        "conf_modifier": +10,
        "narasi_hint":  "Fed memangkas suku bunga — arus modal ke emerging market berpotensi masuk. "
                        "Sektor bank dan properti paling diuntungkan.",
        "expires_h":    48,
    },

    # ── INDONESIA-SPECIFIC ────────────────────────────────────────────
    {
        "keywords": ["bi rate naik", "suku bunga bi naik", "bank indonesia rate hike",
                     "bi 7drr naik"],
        "event_type":   "BI_RATE_NAIK",
        "tickers":      ["BBCA", "BMRI", "BBRI", "BBNI", "BSDE", "PWON"],
        "sectors":      ["BANK", "PROPERTI"],
        "impact":       "NEGATIVE",
        "severity":     "MEDIUM",
        "conf_modifier": -15,
        "narasi_hint":  "BI menaikkan suku bunga — NIM bank tertekan jangka pendek, "
                        "properti dan kredit konsumer melambat.",
        "expires_h":    72,
    },
    {
        "keywords": ["china stimulus", "stimulus tiongkok", "infrastruktur china",
                     "china infrastructure spending"],
        "event_type":   "CHINA_STIMULUS",
        "tickers":      ["PTBA", "ADRO", "ITMG", "AALI", "LSIP", "ANTM"],
        "sectors":      ["BATU_BARA", "CPO", "NIKEL"],
        "impact":       "POSITIVE",
        "severity":     "MEDIUM",
        "conf_modifier": +12,
        "narasi_hint":  "Stimulus infrastruktur China meningkatkan permintaan komoditas. "
                        "Batu bara, CPO, dan nikel Indonesia biasanya ikut reli.",
        "expires_h":    48,
    },
    {
        "keywords": ["rupiah melemah", "kurs dolar naik", "usd idr",
                     "rupiah depreciation", "pelemahan rupiah"],
        "event_type":   "RUPIAH_LEMAH",
        "tickers":      ["UNVR", "ICBP", "MYOR"],  # importir terdampak negatif
        "sectors":      ["KONSUMER_IMPOR"],
        "impact":       "NEGATIVE",
        "severity":     "LOW",
        "conf_modifier": -8,
        "narasi_hint":  "Rupiah melemah menekan emiten importir. "
                        "Emiten eksportir (batu bara, sawit) justru diuntungkan.",
        "expires_h":    24,
    },
    # ── CORPORATE EVENTS ─────────────────────────────────────────────
    {
        "keywords": ["short report", "short seller report", "fraud allegations",
                     "manipulasi saham", "laporan short", "hindenburg",
                     "gotham city research"],
        "event_type":   "SHORT_REPORT",
        "tickers":      [],  # deteksi dari context ticker
        "sectors":      [],
        "impact":       "AVOID",
        "severity":     "CRITICAL",
        "conf_modifier": -100,  # override total → confidence = 0
        "narasi_hint":  "SHORT REPORT TERDETEKSI — confidence di-override ke nol. "
                        "Hindari saham ini sampai ada klarifikasi dari manajemen. "
                        "Historis: Adani turun 50% dalam 1 hari setelah Hindenburg report.",
        "expires_h":    168,  # 1 minggu
    },
    {
        "keywords": ["cyber attack", "ransomware", "data breach", "serangan siber",
                     "kebocoran data"],
        "event_type":   "CYBER_ATTACK",
        "tickers":      [],  # deteksi dari context ticker
        "sectors":      [],
        "impact":       "NEGATIVE",
        "severity":     "HIGH",
        "conf_modifier": -30,
        "narasi_hint":  "Insiden siber berdampak langsung ke reputasi dan operasional. "
                        "Historis: MGM Resorts -10% dalam 1 hari.",
        "expires_h":    48,
    },
    # ── FOMO / SOSMED VIRAL ───────────────────────────────────────────
    {
        "keywords": ["elon musk", "wsb wallstreetbets", "reddit short squeeze",
                     "short squeeze", "buy the dip trending"],
        "event_type":   "SOSMED_FOMO",
        "tickers":      [],
        "sectors":      [],
        "impact":       "NEGATIVE",  # negatif karena biasanya sudah puncak
        "severity":     "HIGH",
        "conf_modifier": -15,
        "narasi_hint":  "Saham trending sosmed — kemungkinan fase distribusi sudah dimulai. "
                        "Hindari FOMO. Historis GameStop: retail masuk puncak, bandar sudah keluar.",
        "expires_h":    12,
    },
]


# ── Core detection functions ────────────────────────────────────────

def scan_article(article_text: str, article_url: str = "",
                 context_ticker: str = "") -> list[MacroEvent]:
    """
    Scan satu artikel terhadap semua KEYWORD_RULES.
    Returns list of MacroEvent yang terdeteksi.
    """
    text_lower = article_text.lower()
    events = []

    for rule in KEYWORD_RULES:
        matched = any(kw in text_lower for kw in rule["keywords"])
        if not matched:
            continue

        # SHORT_REPORT: coba ambil ticker dari context
        tickers = list(rule["tickers"])
        if rule["event_type"] in ("SHORT_REPORT", "CYBER_ATTACK", "SOSMED_FOMO"):
            if context_ticker and context_ticker not in tickers:
                tickers = [context_ticker]

        event = MacroEvent(
            event_type=rule["event_type"],
            title=_extract_title(article_text, rule["keywords"]),
            affected_tickers=tickers,
            affected_sectors=rule["sectors"],
            impact=rule["impact"],
            severity=rule["severity"],
            confidence_modifier=rule["conf_modifier"],
            narasi_hint=rule["narasi_hint"],
            expires_hours=rule["expires_h"],
            source_url=article_url,
        )
        events.append(event)

    return events


def scan_news_batch(articles: list[dict],
                    context_ticker: str = "") -> list[MacroEvent]:
    """
    Scan batch artikel dari news_cache.
    articles: list of {"title": str, "content": str, "url": str}
    """
    all_events = []
    seen_types = set()

    for art in articles:
        text = f"{art.get('title','')} {art.get('content','')}"
        events = scan_article(text, art.get("url", ""), context_ticker)
        for ev in events:
            # Dedup per event_type + ticker combo dalam 1 batch
            key = f"{ev.event_type}_{','.join(sorted(ev.affected_tickers))}"
            if key not in seen_types:
                seen_types.add(key)
                all_events.append(ev)

    return all_events


def apply_macro_to_confidence(base_confidence: float,
                               events: list[MacroEvent],
                               ticker: str) -> tuple[int, list[str]]:
    """
    Terapkan modifier dari semua active macro events ke confidence.

    Returns:
        (final_confidence, list of active event_types)
    """
    total_modifier = 0
    active_flags = []

    for ev in events:
        # Hanya apply jika ticker relevan atau event bersifat broad (SEMUA)
        ticker_match = (
            not ev.affected_tickers or
            ticker in ev.affected_tickers or
            "SEMUA" in ev.affected_sectors
        )
        if not ticker_match:
            continue

        total_modifier += ev.confidence_modifier
        active_flags.append(ev.event_type)

        # AVOID/SHORT_REPORT = override total
        if ev.impact == "AVOID":
            return 0, [ev.event_type]

    final = int(round(max(0, min(100, base_confidence + total_modifier))))
    return final, active_flags


def _extract_title(text: str, keywords: list) -> str:
    """Ambil baris pertama artikel sebagai judul event."""
    first_line = text.strip().split("\n")[0][:120]
    return first_line if first_line else f"Event: {keywords[0]}"


# ── Supabase writer ─────────────────────────────────────────────────

def write_events_to_db(events: list[MacroEvent], supabase_client) -> int:
    """Simpan events ke tabel macro_events di Supabase."""
    if not events:
        return 0
    rows = [ev.to_dict() for ev in events]
    try:
        result = supabase_client.table("macro_events").upsert(
            rows, on_conflict="event_type,detected_at"
        ).execute()
        return len(rows)
    except Exception as e:
        print(f"[WARN] macro_events write error: {e}")
        return 0


# ── Quick test ──────────────────────────────────────────────────────
if __name__ == "__main__":
    # Test 1: cukai rokok kenaikan
    art1 = {
        "title": "Pemerintah Konfirmasi Kenaikan Cukai Rokok 15% Tahun 2027",
        "content": "Kementerian Keuangan mengumumkan kenaikan cukai tembakau naik "
                   "sebesar 15% mulai Januari 2027. GGRM dan HMSP diperkirakan tertekan.",
        "url": "https://bisnis.com/test1"
    }
    # Test 2: short report
    art2 = {
        "title": "Hindenburg Research Rilis Short Report untuk Emiten Tambang",
        "content": "Lembaga short seller melansir short report berisi fraud allegations "
                   "terhadap salah satu emiten tambang Indonesia.",
        "url": "https://bloomberg.com/test2"
    }
    # Test 3: Fed hawkish
    art3 = {
        "title": "Fed Rate Hike 25bps — Market Selloff",
        "content": "Federal Reserve menaikkan suku bunga 25bps, lebih hawkish dari ekspektasi. "
                   "S&P 500 langsung turun 2%. CPI surprise bulan lalu memicu keputusan ini.",
        "url": "https://reuters.com/test3"
    }

    articles = [art1, art2, art3]
    events = scan_news_batch(articles, context_ticker="GGRM")

    print(f"=== {len(events)} events terdeteksi ===\n")
    for ev in events:
        print(f"[{ev.severity}] {ev.event_type}")
        print(f"  Tickers  : {ev.affected_tickers}")
        print(f"  Impact   : {ev.impact} | modifier={ev.confidence_modifier:+d}")
        print(f"  Hint     : {ev.narasi_hint[:80]}...")
        print()

    # Test apply ke confidence
    base = 78
    final, flags = apply_macro_to_confidence(base, events, "GGRM")
    print(f"Confidence GGRM: {base} → {final}")
    print(f"Active flags: {flags}")
