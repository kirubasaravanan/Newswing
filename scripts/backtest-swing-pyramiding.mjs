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

import { getStocksByCategory } from '../src/lib/trading/nse-universe.ts';
import { calculateEquityCosts } from '../src/lib/trading/transaction-costs.ts';

// Get 100 liquid stocks for Batch 1 (1-50) and Batch 2 (51-100)
const fnoStocks = getStocksByCategory('FNO').map(s => s.symbol);
const nifty50 = getStocksByCategory('NIFTY50').map(s => s.symbol);
const nifty100 = getStocksByCategory('NIFTY100').map(s => s.symbol);
const fullList = Array.from(new Set([...nifty50, ...fnoStocks, ...nifty100])).filter(s => s !== 'NIFTY' && s !== 'BANKNIFTY' && s !== 'FINNIFTY');

const BATCH_1_STOCKS = fullList.slice(0, 50);
const BATCH_2_STOCKS = fullList.slice(50, 100);

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

// Swing Backtest with Optional Pyramiding (Max 1 Pyramid Add at 1.0R)
function backtestSwingStock(symbol, candles, enablePyramiding = false) {
  if (candles.length < 200) return null;

  const initialCapital = 100000;
  let capital = 100000;
  let trades = [];
  let peakCap = capital;
  let maxDD = 0;

  const closes = candles.map(c => c.close);
  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);
  const opens = candles.map(c => c.open);

  let pos = null;

  for (let i = 50; i < candles.length; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];

    if (pos) {
      const currentVal = capital + (pos.unit1Qty * bar.close) + (pos.unit2Qty * bar.close);
      peakCap = Math.max(peakCap, currentVal);
      maxDD = Math.max(maxDD, ((peakCap - currentVal) / peakCap) * 100);

      // Check Pyramiding Condition: If price reaches 1.0R gain and Unit 2 not added yet
      const currentR = (bar.close - pos.entry1Price) / (pos.entry1Price - pos.initialSL);
      if (enablePyramiding && !pos.pyramided && currentR >= 1.0) {
        const pyramidPrice = bar.close;
        const addQty = Math.max(1, Math.floor(pos.unit1Qty * 0.5)); // Add 50% of unit 1
        const addCost = addQty * pyramidPrice;
        if (addCost <= capital) {
          capital -= addCost;
          pos.unit2Qty = addQty;
          pos.entry2Price = pyramidPrice;
          pos.pyramided = true;
          // Move SL to Breakeven of Unit 1
          pos.sl = Math.max(pos.sl, pos.entry1Price);
        }
      }

      // Dynamic EMA10 Trailing SL
      const e10 = closes.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / 10;
      const low3 = Math.min(lows[i - 1], lows[i - 2], lows[i - 3]);
      const trailSL = Math.max(pos.sl, low3 * 0.997, e10 * 0.99);
      pos.sl = Math.max(pos.sl, trailSL);

      if (bar.low <= pos.sl) {
        // Exit all units
        const exitPnl1 = pos.unit1Qty * (pos.sl - pos.entry1Price);
        const exitPnl2 = pos.unit2Qty > 0 ? pos.unit2Qty * (pos.sl - pos.entry2Price) : 0;
        const grossPnl = exitPnl1 + exitPnl2;

        const c1 = calculateEquityCosts(pos.entry1Price, pos.sl, pos.unit1Qty);
        const c2 = pos.unit2Qty > 0 ? calculateEquityCosts(pos.entry2Price, pos.sl, pos.unit2Qty) : { totalCosts: 0 };
        const totalCosts = c1.totalCosts + c2.totalCosts;
        const netPnl = grossPnl - totalCosts;

        capital += (pos.unit1Qty * pos.entry1Price) + (pos.unit2Qty * pos.entry2Price) + netPnl;
        trades.push({ netPnl, costs: totalCosts, win: netPnl > 0, pyramided: pos.pyramided });
        pos = null;
      }
    }

    if (!pos) {
      const e10 = closes.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / 10;
      const e20 = closes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / 20;

      const uptrend = e10 > e20;
      const pullbackNearEMA = bar.low <= e10 * 1.008 && bar.close >= e20 * 0.99;
      const greenReversal = bar.close > bar.open && bar.close > prevBar.close;

      if (uptrend && pullbackNearEMA && greenReversal) {
        const entryPrice = bar.close;
        const low3 = Math.min(lows[i], lows[i - 1], lows[i - 2]);
        const sl = Math.min(low3 * 0.995, entryPrice * 0.985);
        const risk = entryPrice - sl;

        if (risk > 0) {
          const riskAmt = capital * 0.02; // 2% risk
          const qty = Math.max(1, Math.floor(riskAmt / risk));
          const marginNeeded = qty * entryPrice;

          if (marginNeeded <= capital) {
            capital -= marginNeeded;
            pos = {
              entry1Price: entryPrice, initialSL: sl, sl,
              unit1Qty: qty, unit2Qty: 0, entry2Price: 0, pyramided: false
            };
          }
        }
      }
    }
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const winPnl = winTrades.reduce((s, t) => s + t.netPnl, 0);
  const lossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.netPnl, 0));
  const pf = lossPnl > 0 ? winPnl / lossPnl : 99;
  const netRet = ((capital - initialCapital) / initialCapital) * 100;
  const totalCostsPaid = trades.reduce((s, t) => s + t.costs, 0);

  return {
    symbol, totalTrades: trades.length, winRate: trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0, profitFactor: pf, netReturn: netRet, maxDrawdown: maxDD, finalCapital: capital, initialCapital, totalCostsPaid: Math.round(totalCostsPaid), pyramidedTrades: trades.filter(t => t.pyramided).length
  };
}

async function runMain() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  EQUITY SWING BATCH BACKTEST — 100 STOCKS × 5 YEARS (NO PYRAMID VS PYRAMID) ║');
  console.log('║  Batch 1 (Stocks 1-50) | Batch 2 (Stocks 51-100)                             ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('--- Processing Batch 1 (First 50 Liquid Stocks) ---');
  const b1NoPyr = [];
  const b1Pyr = [];

  for (const sym of BATCH_1_STOCKS) {
    const candles = await fetchSpotCandles(sym, 1825);
    const rNo = backtestSwingStock(sym, candles, false);
    const rPy = backtestSwingStock(sym, candles, true);
    if (rNo) b1NoPyr.push(rNo);
    if (rPy) b1Pyr.push(rPy);
  }

  b1NoPyr.sort((a, b) => b.netReturn - a.netReturn);
  b1Pyr.sort((a, b) => b.netReturn - a.netReturn);

  console.log('\n==============================================================================');
  console.log('BATCH 1 (TOP 50 STOCKS) RESULTS — STANDARD SWING VS PYRAMIDING');
  console.log('==============================================================================');
  
  const b1NoProf = b1NoPyr.filter(r => r.netReturn > 0);
  const b1PyrProf = b1Pyr.filter(r => r.netReturn > 0);

  const avgRet1No = b1NoPyr.reduce((s, r) => s + r.netReturn, 0) / b1NoPyr.length;
  const avgRet1Py = b1Pyr.reduce((s, r) => s + r.netReturn, 0) / b1Pyr.length;
  const avgPF1No = b1NoPyr.reduce((s, r) => s + r.profitFactor, 0) / b1NoPyr.length;
  const avgPF1Py = b1Pyr.reduce((s, r) => s + r.profitFactor, 0) / b1Pyr.length;

  console.log(`  Standard Swing (No Pyramiding): Profitable: ${b1NoProf.length}/50 (${(b1NoProf.length*2).toFixed(0)}%) | Avg PF: ${avgPF1No.toFixed(2)} | Avg Net Return: ${avgRet1No>=0?'+':''}${avgRet1No.toFixed(1)}%`);
  console.log(`  Pyramiding Swing (1 Add @ 1R):  Profitable: ${b1PyrProf.length}/50 (${(b1PyrProf.length*2).toFixed(0)}%) | Avg PF: ${avgPF1Py.toFixed(2)} | Avg Net Return: ${avgRet1Py>=0?'+':''}${avgRet1Py.toFixed(1)}%`);
  console.log(`  🏆 BATCH 1 VERDICT: ${avgRet1Py > avgRet1No ? 'PYRAMIDING PRODUCED HIGHER NET RETURNS' : 'STANDARD SWING PRODUCED HIGHER NET RETURNS'}\n`);

  console.log('--- Top 10 High-PF Performers in Batch 1 ---');
  for (const r of b1Pyr.slice(0, 10)) {
    console.log(`  ${r.symbol.padEnd(12)} Trades:${String(r.totalTrades).padEnd(4)} (Pyramided:${r.pyramidedTrades}) | WR:${r.winRate.toFixed(1)}% | PF:${r.profitFactor.toFixed(2)} | Net Return:${r.netReturn>=0?'+':''}${r.netReturn.toFixed(1)}% | MaxDD:${r.maxDrawdown.toFixed(1)}%`);
  }

  console.log('\n--- Processing Batch 2 (Next 50 Stocks) ---');
  const b2NoPyr = [];
  const b2Pyr = [];

  for (const sym of BATCH_2_STOCKS) {
    const candles = await fetchSpotCandles(sym, 1825);
    const rNo = backtestSwingStock(sym, candles, false);
    const rPy = backtestSwingStock(sym, candles, true);
    if (rNo) b2NoPyr.push(rNo);
    if (rPy) b2Pyr.push(rPy);
  }

  b2Pyr.sort((a, b) => b.netReturn - a.netReturn);
  const avgRet2Py = b2Pyr.reduce((s, r) => s + r.netReturn, 0) / b2Pyr.length;
  const avgPF2Py = b2Pyr.reduce((s, r) => s + r.profitFactor, 0) / b2Pyr.length;
  const b2PyrProf = b2Pyr.filter(r => r.netReturn > 0);

  console.log('\n==============================================================================');
  console.log('BATCH 2 (STOCKS 51-100) RESULTS — PYRAMIDING SWING');
  console.log('==============================================================================');
  console.log(`  Batch 2 Profitable: ${b2PyrProf.length}/50 (${(b2PyrProf.length*2).toFixed(0)}%) | Avg PF: ${avgPF2Py.toFixed(2)} | Avg Net Return: ${avgRet2Py>=0?'+':''}${avgRet2Py.toFixed(1)}%`);

  console.log('\n--- Top 10 High-PF Performers in Batch 2 ---');
  for (const r of b2Pyr.slice(0, 10)) {
    console.log(`  ${r.symbol.padEnd(12)} Trades:${String(r.totalTrades).padEnd(4)} (Pyramided:${r.pyramidedTrades}) | WR:${r.winRate.toFixed(1)}% | PF:${r.profitFactor.toFixed(2)} | Net Return:${r.netReturn>=0?'+':''}${r.netReturn.toFixed(1)}% | MaxDD:${r.maxDrawdown.toFixed(1)}%`);
  }
}

runMain().catch(console.error);
