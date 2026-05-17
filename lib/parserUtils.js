// lib/parserUtils.js
// Shared utilities used by all broker parsers

// ── TV SYMBOL MAP ─────────────────────────────────────────────────────────────
const TV_MAP = {
  NASDAQ:'CAPITALCOM:US100', SP500:'CAPITALCOM:US500', 'HK-HSI':'HKEX:HSI',
  'XAG/USD':'OANDA:XAGUSD', 'XAU/USD':'OANDA:XAUUSD',
  GER30:'OANDA:DE30EUR', EUR50:'OANDA:EU50EUR', JAPAN:'OANDA:JP225USD',
  CRUDE:'NYMEX:CL1!', 'NAT.GAS':'NYMEX:NG1!', DOWJ:'CAPITALCOM:US30',
  'EUR/USD':'FX:EURUSD', 'USD/JPY':'FX:USDJPY', 'GBP/USD':'FX:GBPUSD',
  'AUD/USD':'FX:AUDUSD', 'USD/CAD':'FX:USDCAD', 'EUR/JPY':'FX:EURJPY',
  'CAD/JPY':'FX:CADJPY', 'BTC/USD':'BINANCE:BTCUSDT', 'ETH/USD':'BINANCE:ETHUSDT',
  'SOL/USD':'BINANCE:SOLUSDT', 'BTC/USDT':'BINANCE:BTCUSDT',
  'ETH/USDT':'BINANCE:ETHUSDT', 'SOL/USDT':'BINANCE:SOLUSDT',
  'XRP/USDT':'BINANCE:XRPUSDT', 'BNB/USDT':'BINANCE:BNBUSDT',
  'DOGE/USDT':'BINANCE:DOGEUSDT', 'ADA/USDT':'BINANCE:ADAUSDT',
  'AVAX/USDT':'BINANCE:AVAXUSDT', 'LINK/USDT':'BINANCE:LINKUSDT',
  USTEC:'CAPITALCOM:US100', US30:'CAPITALCOM:US30',
  US500:'CAPITALCOM:US500', USOIL:'NYMEX:CL1!',
  // Crypto spot (Extended format)
  'BTC-USD':'COINBASE:BTCUSD', 'ETH-USD':'COINBASE:ETHUSD',
  'SOL-USD':'COINBASE:SOLUSD',
}
export const getTvSymbol = sym => TV_MAP[sym] || sym

// ── SYMBOL NORMALISATION ──────────────────────────────────────────────────────
// Merge duplicate instrument names across brokers
const SYMBOL_NORM_MAP = {
  'SILVER':  'XAG/USD',
  'XAG/USD': 'XAG/USD',
  'GOLD':    'XAU/USD',
  'XAU/USD': 'XAU/USD',
}
export function normaliseSymbol(sym) {
  if (!sym) return sym
  // Remove suffixes like (para), .PERP etc.
  let s = sym.replace(/\s*\(para\)/gi, '').replace(/\.PERP$/i, '').trim()
  return SYMBOL_NORM_MAP[s] || s
}

// ── SESSION CLASSIFICATION ────────────────────────────────────────────────────
export function getSession(hour) {
  if (hour >= 23 || hour < 7)  return 'Asia'
  if (hour >= 7  && hour < 12) return 'London'
  if (hour >= 12 && hour < 16) return 'London/NY Overlap'
  if (hour >= 16 && hour < 22) return 'New York'
  return 'Other'
}

// ── UNIFIED DATE PARSER ───────────────────────────────────────────────────────
// Handles: ISO 8601, DD/MM/YYYY HH:MM, YYYY-MM-DD HH:MM:SS, epoch ms
export function parseDate(str) {
  if (!str || str === '-' || str === 'N/A') return null
  str = String(str).trim()

  // Already a number (epoch ms)
  if (/^\d{10,13}$/.test(str)) {
    const n = parseInt(str)
    return new Date(str.length === 13 ? n : n * 1000)
  }

  // ISO 8601 / standard formats — try direct parse first
  const direct = new Date(str)
  if (!isNaN(direct.getTime())) return direct

  // DD/MM/YYYY HH:MM or DD/MM/YYYY HH:MM:SS
  const ddmm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (ddmm) {
    const [, d, m, y, h, min, s = '00'] = ddmm
    return new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}T${h.padStart(2,'0')}:${min}:${s}Z`)
  }

  // YYYY-MM-DD HH:MM:SS (no T separator)
  const yyyymmdd = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (yyyymmdd) {
    const [, y, m, d, h, min, s] = yyyymmdd
    return new Date(`${y}-${m}-${d}T${h}:${min}:${s}Z`)
  }

  return null
}

// ── BROKER DETECTION ─────────────────────────────────────────────────────────
export function detectBroker(headers, filename = '') {
  const h  = headers.map(x => String(x || '').toLowerCase().trim())
  const fn = filename.toLowerCase()

  // PrimeXBT: has "round settled p/l" and "roi, %"
  if (h.some(x => x.includes('round settled')) ||
      fn.includes('primexbt') ||
      (h.includes('roi, %') && h.includes('filled'))) {
    return 'PrimeXBT'
  }

  // Generic fallback
  if (h.includes('position id') || h.includes('entry time (gmt)')) {
    return 'Generic'
  }

  return 'Unknown'
}

// ── R-MULTIPLE CALCULATION ────────────────────────────────────────────────────
// R = (exit - entry) / (entry - stop_loss) for Long
// R = (entry - exit) / (stop_loss - entry) for Short
export function calcRMultiple(entryPrice, exitPrice, stopLoss, direction) {
  if (!entryPrice || !exitPrice || !stopLoss) return null
  const risk = direction === 'Long'
    ? entryPrice - stopLoss
    : stopLoss - entryPrice
  if (!risk || risk <= 0) return null
  const reward = direction === 'Long'
    ? exitPrice - entryPrice
    : entryPrice - exitPrice
  return Math.round((reward / risk) * 100) / 100
}

// ── STREAK COMPUTATION ────────────────────────────────────────────────────────
// Takes sorted trades array, returns same array with streak_id added
// streak_id format: "W3" = 3rd trade in a winning streak, "L2" = 2nd in losing
export function computeStreaks(trades) {
  let currentType = null
  let count       = 0
  return trades.map(t => {
    const type = t.pnl >= 0 ? 'W' : 'L'
    if (type === currentType) {
      count++
    } else {
      currentType = type
      count = 1
    }
    return { ...t, streak_id: `${type}${count}` }
  })
}
// ── NOTIONAL USD CALCULATOR — BACK-SOLVE METHOD ───────────────────────────────
// Primary: back-solve from broker-reported USD P&L and % return
//   notional_usd = pnl_usd / (pct_gain / 100)
// This works because the broker already did the FX conversion and contract
// multiplier math when they calculated P&L. We reverse-engineer it.
//
// Fallback: price × size (used when pct_gain is zero/tiny/missing)
//
// Returns: { notional_usd, method }
//   method: 'backsolve' | 'price_x_size' | null
export function calculateNotionalUSD(pnlUsd, pctGain, size, entryPrice, exitPrice) {
  const MIN_PCT = 0.0001 // 0.01% — below this, back-solve gives nonsense

  // ── Primary: back-solve ──────────────────────────────────────────────────
  if (
    pnlUsd != null && isFinite(pnlUsd) && pnlUsd !== 0 &&
    pctGain != null && isFinite(pctGain) && Math.abs(pctGain) >= MIN_PCT
  ) {
    const notional = Math.abs(pnlUsd / (pctGain / 100))
    if (isFinite(notional) && notional > 0 && notional < 1e12) {
      return { notional_usd: Math.round(notional * 100) / 100, method: 'backsolve' }
    }
  }

  // ── Fallback: price × size ───────────────────────────────────────────────
  const price = exitPrice ?? entryPrice
  if (size != null && size > 0 && price != null && price > 0) {
    return {
      notional_usd: Math.round(size * price * 100) / 100,
      method: 'price_x_size',
    }
  }

  return { notional_usd: null, method: null }
}
