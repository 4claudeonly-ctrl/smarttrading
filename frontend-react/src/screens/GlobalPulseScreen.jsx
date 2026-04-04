import { useState, useEffect } from 'react'
import { TopBar } from '../components/TopBar'
import { getMarketData } from '../lib/api'

function fmtChg(pct) {
  if (pct == null) return null
  return `${pct > 0 ? '+' : ''}${Number(pct).toFixed(2)}%`
}
function fmtPrice(p, prefix = '') {
  if (p == null) return '–'
  return `${prefix}${Number(p).toLocaleString('en-US')}`
}

// Interpretasi Fear & Greed
function getFngMeta(score) {
  if (score == null) return { color: '#888', label: 'Tidak diketahui', meaning: '', advice: '' }
  if (score <= 20) return {
    color: '#FF4455',
    label: 'Extreme Fear',
    meaning: 'Pasar kripto sangat panik. Banyak investor menjual karena takut.',
    advice: 'Historisnya, ini sering jadi peluang beli — tapi hati-hati, bisa turun lebih dalam.',
  }
  if (score <= 40) return {
    color: '#E07A30',
    label: 'Fear',
    meaning: 'Investor cenderung pesimis dan waspada.',
    advice: 'Pasar belum stabil. Amati lebih dulu sebelum masuk posisi besar.',
  }
  if (score <= 60) return {
    color: '#F5A623',
    label: 'Netral',
    meaning: 'Sentimen pasar seimbang antara optimis dan pesimis.',
    advice: 'Waktu yang relatif aman untuk evaluasi portofolio secara objektif.',
  }
  if (score <= 80) return {
    color: '#7BC97A',
    label: 'Greed',
    meaning: 'Investor sedang optimis dan agresif membeli.',
    advice: 'Hati-hati FOMO. Pertimbangkan ambil profit sebagian jika sudah untung.',
  }
  return {
    color: '#00C896',
    label: 'Extreme Greed',
    meaning: 'Pasar kripto sedang euforia. Semua orang ingin beli.',
    advice: 'Potensi koreksi tinggi. Jangan masuk di puncak — tunggu pullback.',
  }
}

// Gauge SVG
function FearGreedGauge({ score, color }) {
  const angle = score != null ? -90 + (score / 100) * 180 : -90
  const r = 60, cx = 80, cy = 75
  const toRad = d => d * Math.PI / 180
  const arcX = (deg) => cx + r * Math.cos(toRad(deg - 180))
  const arcY = (deg) => cy - r * Math.sin(toRad(deg - 180))
  const needleX = cx + (r - 8) * Math.cos(toRad(angle - 180))
  const needleY = cy - (r - 8) * Math.sin(toRad(angle - 180))
  return (
    <svg viewBox="0 0 160 90" style={{ width: '100%', maxWidth: 200 }}>
      <path d={`M ${arcX(0)} ${arcY(0)} A ${r} ${r} 0 0 1 ${arcX(180)} ${arcY(180)}`}
        fill="none" stroke="#252D3D" strokeWidth="12" strokeLinecap="round"/>
      {score != null && (
        <path d={`M ${arcX(0)} ${arcY(0)} A ${r} ${r} 0 0 1 ${arcX(score * 1.8)} ${arcY(score * 1.8)}`}
          fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"/>
      )}
      <line x1={cx} y1={cy} x2={needleX} y2={needleY}
        stroke={color} strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx={cx} cy={cy} r="4" fill={color}/>
      <text x={cx} y={cy + 16} textAnchor="middle" fill={color}
        fontSize="18" fontWeight="bold" fontFamily="JetBrains Mono, monospace">
        {score ?? '–'}
      </text>
    </svg>
  )
}

function MacroRow({ label, sublabel, value, chg, isLoading, isNegativeGood }) {
  const chgNum = typeof chg === 'number' ? chg : null
  const isUp = chgNum > 0
  // Untuk USD/IDR: naik = rupiah melemah = buruk untuk Indonesia
  const isPositive = isNegativeGood ? !isUp : isUp
  const chgColor = chgNum == null ? 'var(--muted)' : isPositive ? '#00C896' : '#FF4455'

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>{sublabel}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {isLoading ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>Memuat...</div>
          ) : value == null ? (
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--muted)' }}>–</div>
              <div style={{ fontSize: 10, color: '#E07A30', marginTop: 2 }}>
                ⚠ Pasar tutup / data tidak tersedia
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600 }}>{value}</div>
              {chgNum != null && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: chgColor, marginTop: 2 }}>
                  {fmtChg(chg)} hari ini
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function CryptoRow({ name, sublabel, price, changePct }) {
  const pos = (changePct ?? 0) >= 0
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{name}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{sublabel}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 700 }}>
            {fmtPrice(price, '$')}
          </div>
          {changePct != null && (
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, marginTop: 2,
              color: pos ? '#00C896' : '#FF4455' }}>
              {fmtChg(changePct)} 24 jam
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function GlobalPulseScreen() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [lastUpd, setLastUpd] = useState(null)

  const load = () => {
    setLoading(true); setError(null)
    getMarketData()
      .then(d => { setData(d); setLastUpd(new Date()) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const fng    = data?.fear_greed
  const fngMeta = getFngMeta(fng?.score)
  const btc    = data?.btc
  const eth    = data?.eth
  const ihsg   = data?.ihsg
  const usdidr = data?.usdidr
  const emas   = data?.emas

  return (
    <div style={{ paddingBottom: 80 }}>
      <TopBar right="Global Pulse" />

      {/* Header */}
      <div style={{ padding: '10px 16px 6px', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Kondisi Pasar Hari Ini</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
            {loading ? 'Memuat data pasar...' :
              lastUpd ? `Diperbarui ${lastUpd.toLocaleTimeString('id-ID')}${data?.cached ? ' · cache' : ''}` : ''}
          </div>
        </div>
        <button onClick={load} disabled={loading}
          style={{ background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--muted)', borderRadius: 6, padding: '4px 10px',
            cursor: 'pointer', fontSize: 10 }}>
          {loading ? '⏳' : '↻ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ margin: '8px 16px', padding: 10, background: '#2E0A0D',
          border: '1px solid #FF4455', borderRadius: 8, fontSize: 11, color: '#C47A7E' }}>
          ⚠️ Gagal memuat data: {error}. Coba Refresh.
        </div>
      )}

      <div style={{ padding: '0 16px' }}>

        {/* ── Fear & Greed ── */}
        <div className="card" style={{ marginBottom: 12, paddingTop: 14 }}>
          <div className="section-label">Indeks Ketakutan & Keserakahan Kripto</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
            Ukuran sentimen investor kripto global. Skala 0–100: makin rendah = makin panik.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: '0 0 130px' }}>
              <FearGreedGauge score={fng?.score} color={fngMeta.color} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: fngMeta.color,
                fontFamily: 'var(--mono)', marginBottom: 4 }}>
                {fng?.score ?? '–'} — {fngMeta.label}
              </div>
              {fngMeta.meaning && (
                <div style={{ fontSize: 11, color: '#C8D4E8', lineHeight: 1.6, marginBottom: 6 }}>
                  {fngMeta.meaning}
                </div>
              )}
              {fngMeta.advice && (
                <div style={{ fontSize: 11, background: '#0B0D12', borderRadius: 6,
                  padding: '7px 10px', borderLeft: `3px solid ${fngMeta.color}`,
                  color: 'var(--muted)', lineHeight: 1.6 }}>
                  💡 {fngMeta.advice}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9,
            color: 'var(--muted)', padding: '10px 4px 0', marginTop: 4,
            borderTop: '1px solid var(--border)' }}>
            <span>0 · Extreme Fear</span><span>25 · Fear</span>
            <span>50 · Netral</span><span>75 · Greed</span><span>100 · Extreme Greed</span>
          </div>
        </div>

        {/* ── Crypto Prices ── */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-label">Harga Aset Kripto</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8, lineHeight: 1.6 }}>
            Harga real-time Bitcoin & Ethereum dalam USD. Kripto global bergerak 24/7.
          </div>
          <CryptoRow
            name="Bitcoin (BTC)"
            sublabel="Aset kripto terbesar. Sering jadi barometer market kripto global."
            price={btc?.price} changePct={btc?.changePct} />
          <CryptoRow
            name="Ethereum (ETH)"
            sublabel="Platform smart contract. Bergerak mengikuti BTC dengan volatilitas lebih tinggi."
            price={eth?.price} changePct={eth?.changePct} />
        </div>

        {/* ── Indikator Makro IDX ── */}
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-label">Indikator Makro Indonesia</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, lineHeight: 1.6 }}>
            Data pasar Indonesia. Tersedia saat jam bursa BEI (09:00–15:45 WIB, Senin–Jumat).
          </div>

          <MacroRow
            label="IHSG"
            sublabel="Indeks Harga Saham Gabungan — barometer utama bursa Indonesia. Naik = kondisi baik."
            value={ihsg?.price ? ihsg.price.toLocaleString('id-ID', { maximumFractionDigits: 0 }) : null}
            chg={ihsg?.changePct}
            isLoading={loading}
          />
          <MacroRow
            label="Kurs USD/IDR"
            sublabel="Harga 1 dolar AS dalam rupiah. Naik = rupiah melemah = waspada saham impor & utang."
            value={usdidr?.price ? `Rp ${usdidr.price.toLocaleString('id-ID', { maximumFractionDigits: 0 })}` : null}
            chg={usdidr?.changePct}
            isLoading={loading}
            isNegativeGood={true}
          />
          <MacroRow
            label="Harga Emas"
            sublabel="Emas spot global (per troy ounce, USD). Naik saat dolar melemah atau investor cari safe haven."
            value={emas?.price ? `$${emas.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : null}
            chg={emas?.changePct}
            isLoading={loading}
          />
        </div>

        {/* Panduan singkat */}
        <div style={{ background: '#0B0D12', border: '1px solid #252D3D',
          borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)',
            letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            🧭 Cara Baca Kondisi Makro
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8 }}>
            <span style={{ color: '#00C896' }}>✓ Ideal:</span> IHSG naik · USD/IDR turun · Emas stabil · F&amp;G 40–60<br/>
            <span style={{ color: '#FF4455' }}>✗ Waspada:</span> IHSG turun &gt;1% · USD/IDR naik · F&amp;G &lt;25<br/>
            <span style={{ color: '#F5A623' }}>→ Aksi:</span> Cek Deep Dive untuk analisis saham spesifik
          </div>
        </div>

      </div>
    </div>
  )
}
