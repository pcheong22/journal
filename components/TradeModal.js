import { useState, useEffect, useCallback } from 'react'
import { simulatePnLPath } from '../lib/tradeUtils'
import { PnlPathChart } from './Charts'

const fU = (n, d = 0) => (n >= 0 ? '+' : '') + n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d })

export default function TradeModal({ trade, onClose, trades, onNavigate }) {
  const [tf, setTf] = useState('1')
  const [sim, setSim] = useState(null)

  const idx = trades.indexOf(trade)

  useEffect(() => {
    if (trade) setSim(simulatePnLPath(trade))
  }, [trade])

  const handleKey = useCallback(e => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowLeft' && idx > 0) onNavigate(trades[idx - 1])
    if (e.key === 'ArrowRight' && idx < trades.length - 1) onNavigate(trades[idx + 1])
  }, [idx, trades, onClose, onNavigate])

  useEffect(() => {
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (!trade) return null

  const pc = trade.pnl >= 0 ? 'var(--wn)' : 'var(--ls)'
  const pct = trade.pct_gain != null ? (trade.pct_gain >= 0 ? '+' : '') + trade.pct_gain.toFixed(3) + '%' : '—'
  const priceMove = trade.exit_price && trade.entry_price ? trade.exit_price - trade.entry_price : null
  const ptsCapture = priceMove != null ? (trade.direction === 'Long' ? priceMove : -priceMove) : null
  const durH = trade.duration_mins ? (trade.duration_mins / 60).toFixed(1) + 'h' : '—'
  const tvSym = trade.tv_symbol || trade.symbol
  const tvUrl = `https://www.tradingview.com/widgetembed/?frameElementId=tvWid&symbol=${encodeURIComponent(tvSym)}&interval=${tf}&hidesidetoolbar=0&hidetoptoolbar=0&symboledit=1&saveimage=1&toolbarbg=131722&theme=dark&style=1&timezone=UTC&withdateranges=1&allow_symbol_change=1`
  const tvDirectUrl = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}&interval=${tf}`

  const capture = sim && sim.mfe > 0 ? Math.max(0, Math.min(100, (trade.pnl / sim.mfe) * 100)) : null
  const entryQ = sim && sim.mfe > 0 ? Math.max(0, Math.min(100, 100 * (1 - Math.abs(sim.mae) / Math.max(Math.abs(sim.mae) + sim.mfe, .01)))) : 50
  const exitQ = capture ?? 50

  const qualColor = v => v >= 70 ? 'var(--wn)' : v >= 40 ? 'var(--wa)' : 'var(--ls)'

  let coachNote = ''
  if (sim) {
    if (!trade.pnl > 0 && Math.abs(sim.mae) > Math.abs(trade.pnl) * 2) {
      coachNote = `Loss amplifier detected: This trade went ${fU(Math.round(sim.mae))} against you at worst. Exiting at first adverse move would have saved significantly.`
    } else if (trade.pnl > 0 && capture < 50) {
      coachNote = `Missed opportunity: You captured only ${capture?.toFixed(0)}% of the MFE. The trade reached ${fU(Math.round(sim.mfe))} at its peak. Consider trailing stops to let winners run.`
    } else if (trade.pnl > 0 && capture >= 80) {
      coachNote = `Excellent execution: You captured ${capture?.toFixed(0)}% of the maximum favorable move — well above average. This is the kind of execution to replicate.`
    } else if (sim.mae > -100 && trade.pnl > 0) {
      coachNote = `Clean entry: Minimal adverse excursion (MAE ${fU(Math.round(sim.mae))}) means you entered very close to the optimal level. Strong signal quality.`
    } else {
      coachNote = `Execution summary: MAE ${fU(Math.round(sim.mae))} vs MFE ${fU(Math.round(sim.mfe))}. You captured ${capture?.toFixed(0) ?? '—'}% of the maximum available profit.`
    }
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px 14px', borderBottom: '1px solid var(--bd)', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 17, fontWeight: 800 }}>
              <span style={{ color: trade.direction === 'Long' ? 'var(--wn)' : 'var(--ls)' }}>{trade.direction}</span>
              {' '}{trade.symbol} &nbsp;·&nbsp;
              <span style={{ color: pc }}>{fU(trade.pnl)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', marginTop: 2 }}>
              {trade.entry_time?.slice(0, 16).replace('T', ' ')} → {trade.exit_time?.slice(0, 16).replace('T', ' ')} GMT &nbsp;·&nbsp; {trade.session} &nbsp;·&nbsp; {trade.day_of_week} &nbsp;·&nbsp; {durH}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn" style={{ fontSize: 11 }} disabled={idx <= 0} onClick={() => onNavigate(trades[idx - 1])}>← Prev</button>
            <span style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace' }}>{idx + 1} / {trades.length}</span>
            <button className="btn" style={{ fontSize: 11 }} disabled={idx >= trades.length - 1} onClick={() => onNavigate(trades[idx + 1])}>Next →</button>
            <button className="btn" style={{ fontSize: 11 }} onClick={onClose}>✕ Close</button>
          </div>
        </div>

        <div style={{ padding: '18px 22px', maxHeight: '85vh', overflowY: 'auto' }}>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(115px,1fr))', gap: 8, marginBottom: 18 }}>
            {[
              ['P&L', fU(trade.pnl), pc, 'Net realised'],
              ['% Return', pct, trade.pct_gain >= 0 ? 'var(--wn)' : 'var(--ls)', 'P&L / Notional'],
              ['Entry Price', trade.entry_price?.toLocaleString() || '—', 'var(--tx)', trade.entry_time?.slice(11, 16) + ' GMT'],
              ['Exit Price', trade.exit_price?.toLocaleString() || '—', 'var(--tx)', trade.exit_time?.slice(11, 16) + ' GMT'],
              ['Price Move', ptsCapture != null ? (ptsCapture >= 0 ? '+' : '') + ptsCapture.toFixed(5) : '—', trade.pnl >= 0 ? 'var(--wn)' : 'var(--ls)', trade.direction + ' position'],
              ['Size', trade.size?.toLocaleString() || '—', 'var(--tx)', 'Contracts'],
              ['Notional', trade.notional_usd ? '$' + Math.round(trade.notional_usd).toLocaleString() : '—', 'var(--mu)', 'USD equivalent'],
              ['Duration', durH, 'var(--tx)', Math.round(trade.duration_mins || 0) + ' minutes'],
            ].map(([l, v, c, s]) => (
              <div key={l} style={{ background: 'var(--sf2)', borderRadius: 10, padding: '11px 12px' }}>
                <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 3 }}>{l}</div>
                <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
                <div style={{ fontSize: 10, color: 'var(--mu)', marginTop: 2 }}>{s}</div>
              </div>
            ))}
          </div>

          {/* TradingView Chart */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--ac)' }} />
              TradingView Chart
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mu)', fontWeight: 400 }}>
                <a href={tvDirectUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--ac)', textDecoration: 'none' }}>Open full chart ↗</a>
              </span>
            </div>

            {/* Timeframe selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace' }}>Timeframe:</span>
              {[['1','1m'],['5','5m'],['15','15m'],['60','1H'],['D','1D']].map(([v, l]) => (
                <button key={v} onClick={() => setTf(v)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid', fontSize: 11, fontFamily: 'DM Mono,monospace', cursor: 'pointer', transition: 'all .15s', background: tf === v ? 'var(--ac)' : 'var(--sf2)', borderColor: tf === v ? 'var(--ac)' : 'var(--bd)', color: tf === v ? '#fff' : 'var(--tx)' }}>{l}</button>
              ))}
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace' }}>{tvSym}</span>
            </div>

            {/* TV iframe */}
            <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--bd)', background: '#000' }}>
              <iframe
                key={`${tvSym}-${tf}`}
                src={tvUrl}
                style={{ width: '100%', height: 400, border: 'none', display: 'block' }}
                allowTransparency={true}
                scrolling="no"
                frameBorder="0"
              />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textAlign: 'center' }}>
              Interactive chart — use TradingView toolbar to add indicators, draw lines, and navigate to exact entry/exit time
            </div>
          </div>

          {/* PnL Path */}
          {sim && (
            <div style={{ marginBottom: 18 }}>
              <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--mu)', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--a2)' }} />
                Running P&L Path
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mu)', fontWeight: 400, fontFamily: 'DM Mono,monospace' }}>Simulated intraday path · entry → exit bridge</span>
              </div>

              {/* MAE/MFE metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
                {[
                  ['MAE', fU(Math.round(sim.mae)), sim.mae < 0 ? 'var(--ls)' : 'var(--wn)', 'Max adverse excursion'],
                  ['MFE', fU(Math.round(sim.mfe)), 'var(--wn)', 'Max favorable excursion'],
                  ['Actual P&L', fU(Math.round(trade.pnl)), pc, 'Exit result'],
                  ['Capture %', capture != null ? capture.toFixed(1) + '%' : 'N/A', qualColor(capture ?? 50), 'Of MFE captured'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: 'var(--sf2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textTransform: 'uppercase', marginBottom: 3 }}>{l}</div>
                    <div style={{ fontFamily: 'Syne,sans-serif', fontSize: 15, fontWeight: 700, color: c }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="card" style={{ padding: 14 }}>
                <PnlPathChart sim={sim} trade={trade} />
              </div>

              {/* Entry / Exit quality bars */}
              <div style={{ marginTop: 10, background: 'var(--sf2)', borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>Entry & Exit Quality</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  {[['Entry Quality', entryQ, 'var(--wn)'], ['Exit Quality', exitQ, 'var(--a2)']].map(([label, score, color]) => {
                    const c = qualColor(score)
                    return (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: 'var(--mu)', marginBottom: 6, fontFamily: 'DM Mono,monospace', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{label}</span><span style={{ color: c }}>{score.toFixed(0)}%</span>
                        </div>
                        <div style={{ height: 8, background: 'var(--bd2)', borderRadius: 4, position: 'relative', overflow: 'visible' }}>
                          <div style={{ width: score + '%', height: '100%', borderRadius: 4, background: c, transition: 'width .6s cubic-bezier(.16,1,.3,1)' }} />
                          <div style={{ position: 'absolute', top: -4, left: score + '%', transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', background: c, border: '2px solid var(--bg)', transition: 'left .6s cubic-bezier(.16,1,.3,1)' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--mu)', fontFamily: 'DM Mono,monospace', marginTop: 3 }}>
                          <span>Poor</span><span>Perfect</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Coach insight */}
              <div style={{ marginTop: 12, background: 'rgba(124,106,247,.07)', border: '1px solid rgba(124,106,247,.2)', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#b8b8d0', lineHeight: 1.65 }}>
                <strong style={{ color: 'var(--ac)' }}>Coach: </strong>{coachNote}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
