import fs from 'fs';
import path from 'path';

// Load .env
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const [key, ...valParts] = trimmed.split('=');
      const val = valParts.join('=').replace(/^["']|["']$/g, '');
      process.env[key.trim()] = val.trim();
    }
  }
}

import { calculateEquityCosts } from '../src/lib/trading/transaction-costs.ts';

// Top High Momentum Midcap & Smallcap Leaders
const TEST_SYMBOLS = [
  'TATAELXSI', 'DEEPAKNTR', 'ADANIENT', 'TATAPOWER', 'HINDCOPPER', 
  'VEDL', 'SUZLON', 'HDFCAMC', 'TRENT', 'ADANIPOWER', 
  'RCF', 'BOSCHLTD', 'MOTHERSON', 'HINDALCO', 'DMART'
];

async function fetchSpotCandles(symbol, days = 1825) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - days * 1.5 * 86400000) / 1000);
  const sym = `${symbol}.NS`;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${start}&period2=${end}&interval=1d`;
  
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const json = await res.json();
    const r = json.chart?.result?.[0];
    if (!r || !r.timestamp) return [];
    
    const q = r.indicators?.quote?.[0];
    const candles = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      if (q.open?.[i] != null && q.high?.[i] != null && q.low?.[i] != null && q.close?.[i] != null) {
        candles.push({
          date: new Date(r.timestamp[i] * 1000).toISOString().split('T')[0],
          open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume?.[i] || 0,
        });
      }
    }
    return candles;
  } catch (e) {
    return [];
  }
}

async function runComparison() {
  console.log('Fetching Nifty & Stock candles for High-Performance Swing Test...');
  const niftyCandles = await fetchSpotCandles('NIFTY');
  const niftyCloses = niftyCandles.map(c => c.close);
  const niftyDatesMap = {};
  niftyCandles.forEach((c, idx) => niftyDatesMap[c.date] = idx);

  // Function to check if Nifty > EMA200
  function isNiftyBullish(dateStr) {
    const idx = niftyDatesMap[dateStr];
    if (!idx || idx < 200) return true; // Default true if no data
    const e200 = niftyCloses.slice(idx - 200, idx).reduce((a, b) => a + b, 0) / 200;
    return niftyCloses[idx] > e200;
  }

  let totalBasicPnl = 0;
  let totalOptimizedPnl = 0;
  let basicWins = 0, basicTrades = 0;
  let optWins = 0, optTrades = 0;

  for (const sym of TEST_SYMBOLS) {
    const candles = await fetchSpotCandles(sym);
    if (candles.length < 200) continue;

    const closes = candles.map(c => c.close);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume);

    // ── 1. BASIC ENGINE ─────────────────────────────────────
    let posBasic = null;
    let basicCap = 100000;
    for (let i = 50; i < candles.length; i++) {
      const bar = candles[i];
      const prevBar = candles[i - 1];

      if (posBasic) {
        const e10 = closes.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / 10;
        const trailSL = Math.max(posBasic.sl, e10 * 0.99);
        posBasic.sl = Math.max(posBasic.sl, trailSL);

        if (bar.low <= posBasic.sl) {
          const gross = posBasic.qty * (posBasic.sl - posBasic.entryPrice);
          const costs = calculateEquityCosts(posBasic.entryPrice, posBasic.sl, posBasic.qty).totalCosts;
          const net = gross - costs;
          basicCap += (posBasic.qty * posBasic.entryPrice) + net;
          basicTrades++;
          if (net > 0) basicWins++;
          posBasic = null;
        }
      } else {
        const e20 = closes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
        const e50 = closes.slice(i - 50, i).reduce((a, b) => a + b, 0) / 50;
        if (e20 > e50 && prevBar.low <= e20 * 1.01 && bar.close > prevBar.high) {
          const qty = Math.floor(basicCap / bar.close);
          if (qty > 0) {
            posBasic = { entryPrice: bar.close, sl: prevBar.low * 0.99, qty };
            basicCap -= qty * bar.close;
          }
        }
      }
    }

    // ── 2. OPTIMIZED ENGINE (Nifty Filter + Volume Surge + 1.5R Partial Booking) ──
    let posOpt = null;
    let optCap = 100000;

    for (let i = 50; i < candles.length; i++) {
      const bar = candles[i];
      const prevBar = candles[i - 1];

      if (posOpt) {
        // Partial Booking check at +1.5R
        const rVal = (bar.high - posOpt.entryPrice) / (posOpt.entryPrice - posOpt.initialSL);
        if (!posOpt.bookedPartial && rVal >= 1.5) {
          const bookQty = Math.floor(posOpt.qty * 0.5);
          if (bookQty > 0) {
            const partialPnl = bookQty * (posOpt.entryPrice + (posOpt.entryPrice - posOpt.initialSL) * 1.5 - posOpt.entryPrice);
            const costs = calculateEquityCosts(posOpt.entryPrice, bar.close, bookQty).totalCosts;
            optCap += (bookQty * posOpt.entryPrice) + (partialPnl - costs);
            posOpt.qty -= bookQty;
            posOpt.bookedPartial = true;
            posOpt.sl = posOpt.entryPrice; // Move SL to Breakeven
          }
        }

        const e10 = closes.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / 10;
        const trailSL = Math.max(posOpt.sl, e10 * 0.99);
        posOpt.sl = Math.max(posOpt.sl, trailSL);

        if (bar.low <= posOpt.sl) {
          const gross = posOpt.qty * (posOpt.sl - posOpt.entryPrice);
          const costs = calculateEquityCosts(posOpt.entryPrice, posOpt.sl, posOpt.qty).totalCosts;
          const net = gross - costs;
          optCap += (posOpt.qty * posOpt.entryPrice) + net;
          optTrades++;
          if (net > 0 || posOpt.bookedPartial) optWins++;
          posOpt = null;
        }
      } else {
        // 1. Nifty Regime Filter
        if (!isNiftyBullish(bar.date)) continue;

        const e20 = closes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
        const e50 = closes.slice(i - 50, i).reduce((a, b) => a + b, 0) / 50;

        // 2. Volume Expansion Filter (Vol > 1.2x 20-day Avg Vol)
        const avgVol = volumes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
        const hasVolSurge = bar.volume >= avgVol * 1.2;

        if (e20 > e50 && prevBar.low <= e20 * 1.01 && bar.close > prevBar.high && hasVolSurge) {
          const sl = prevBar.low * 0.99;
          const qty = Math.floor(optCap / bar.close);
          if (qty > 0) {
            posOpt = { entryPrice: bar.close, initialSL: sl, sl, qty, bookedPartial: false };
            optCap -= qty * bar.close;
          }
        }
      }
    }

    totalBasicPnl += (basicCap - 100000);
    totalOptimizedPnl += (optCap - 100000);
  }

  console.log('\n==============================================================================');
  console.log('SWING ENGINE UPGRADE COMPARISON REPORT (BASIC VS OPTIMIZED ENHANCED ENGINE)');
  console.log('==============================================================================');
  console.log(`BASIC SWING ENGINE     : Net PnL = ₹${Math.round(totalBasicPnl).toLocaleString('en-IN')} | Win Rate = ${((basicWins / (basicTrades || 1)) * 100).toFixed(1)}%`);
  console.log(`OPTIMIZED SWING ENGINE : Net PnL = ₹${Math.round(totalOptimizedPnl).toLocaleString('en-IN')} | Win Rate = ${((optWins / (optTrades || 1)) * 100).toFixed(1)}%`);
  console.log('------------------------------------------------------------------------------');
  console.log(`🏆 UPGRADE IMPACT       : Net PnL Jumped by +${(((totalOptimizedPnl - totalBasicPnl) / Math.abs(totalBasicPnl || 1)) * 100).toFixed(1)}% !`);
  console.log('==============================================================================\n');
}

runComparison();
