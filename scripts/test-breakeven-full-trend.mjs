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

const TOP_SWING_SYMBOLS = [
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

async function runBreakevenFullTrendTest() {
  const stockCandleMap = {};
  for (const sym of TOP_SWING_SYMBOLS) {
    const c = await fetchSpotCandles(sym);
    if (c.length > 200) stockCandleMap[sym] = c;
  }

  const datesSet = new Set();
  Object.values(stockCandleMap).forEach(arr => arr.forEach(c => datesSet.add(c.date)));
  const sortedDates = Array.from(datesSet).sort();

  const INITIAL_CAPITAL = 300000;
  let wallet = INITIAL_CAPITAL;
  const MAX_SLOTS = 10;
  const activePositions = [];
  const closedTrades = [];
  let totalGrossProfit = 0, totalTransactionCosts = 0, peakVal = INITIAL_CAPITAL, maxDD = 0;

  for (let dIdx = 50; dIdx < sortedDates.length; dIdx++) {
    const currentDate = sortedDates[dIdx];

    for (let pIdx = activePositions.length - 1; pIdx >= 0; pIdx--) {
      const pos = activePositions[pIdx];
      const candles = stockCandleMap[pos.symbol];
      if (!candles) continue;

      const bar = candles.find(c => c.date === currentDate);
      if (!bar) continue;

      // Check +1.0R gain -> Move SL to Breakeven (100% Risk-Free) without selling any quantity
      const rVal = (bar.high - pos.entryPrice) / (pos.entryPrice - pos.initialSL);
      if (!pos.slMovedToBE && rVal >= 1.0) {
        pos.sl = Math.max(pos.sl, pos.entryPrice); // Move SL to Entry Price
        pos.slMovedToBE = true;
      }

      // Dynamic EMA10 Trailing Stop Loss
      const bIdx = candles.findIndex(c => c.date === currentDate);
      if (bIdx >= 10) {
        const e10 = candles.slice(bIdx - 10, bIdx).reduce((a, b) => a + b.close, 0) / 10;
        pos.sl = Math.max(pos.sl, e10 * 0.99);
      }

      if (bar.low <= pos.sl) {
        const grossPnl = pos.qty * (pos.sl - pos.entryPrice);
        const costs = calculateEquityCosts(pos.entryPrice, pos.sl, pos.qty).totalCosts;
        const netPnl = grossPnl - costs;

        wallet += (pos.qty * pos.entryPrice) + netPnl;
        totalGrossProfit += grossPnl;
        totalTransactionCosts += costs;
        closedTrades.push({ netPnl, win: netPnl > 0 });
        activePositions.splice(pIdx, 1);
      }
    }

    let invested = activePositions.reduce((a, pos) => a + (pos.qty * pos.entryPrice), 0);
    const tot = wallet + invested;
    peakVal = Math.max(peakVal, tot);
    maxDD = Math.max(maxDD, ((peakVal - tot) / peakVal) * 100);

    if (activePositions.length < MAX_SLOTS) {
      for (const sym of TOP_SWING_SYMBOLS) {
        if (activePositions.some(p => p.symbol === sym)) continue;
        if (activePositions.length >= MAX_SLOTS) break;

        const candles = stockCandleMap[sym];
        const bIdx = candles?.findIndex(c => c.date === currentDate);
        if (!bIdx || bIdx < 50) continue;

        const bar = candles[bIdx];
        const prevBar = candles[bIdx - 1];
        const closes = candles.slice(bIdx - 50, bIdx).map(c => c.close);
        const e20 = closes.slice(30, 50).reduce((a, b) => a + b, 0) / 20;
        const e50 = closes.reduce((a, b) => a + b, 0) / 50;

        if (e20 > e50 && prevBar.low <= e20 * 1.01 && bar.close > prevBar.high) {
          const initialSL = prevBar.low * 0.99;
          const slotCap = Math.min(wallet / (MAX_SLOTS - activePositions.length), wallet * 0.10);
          const qty = Math.floor(slotCap / bar.close);
          if (qty > 0 && (qty * bar.close) <= wallet) {
            wallet -= (qty * bar.close);
            activePositions.push({
              symbol: sym, entryPrice: bar.close, initialSL, sl: initialSL, qty, slMovedToBE: false
            });
          }
        }
      }
    }
  }

  const netPnlTotal = wallet - INITIAL_CAPITAL;
  const wins = closedTrades.filter(t => t.win);
  const winRate = (wins.length / closedTrades.length) * 100;

  const totalWinPnl = closedTrades.filter(t => t.netPnl > 0).reduce((a, b) => a + b.netPnl, 0);
  const totalLossPnl = Math.abs(closedTrades.filter(t => t.netPnl < 0).reduce((a, b) => a + b.netPnl, 0));
  const profitFactor = totalLossPnl === 0 ? 99 : totalWinPnl / totalLossPnl;

  const stcgTax = Math.max(0, netPnlTotal * 0.20);
  const finalTakeHome = wallet - stcgTax;

  console.log('\n==============================================================================');
  console.log('₹3.00 LAKHS / 10 SLOTS — MOVE SL TO BREAKEVEN AT +1.0R & FULL EMA10 TRAIL');
  console.log('==============================================================================');
  console.log(`Initial Capital            : ₹3,00,000`);
  console.log(`Total Trades               : ${closedTrades.length}`);
  console.log(`Win Rate                   : 🏆 ${winRate.toFixed(1)}%`);
  console.log(`Profit Factor (PF)         : 🏆 ${profitFactor.toFixed(2)}`);
  console.log(`Max Portfolio Drawdown     : 🏆 ${maxDD.toFixed(1)}%`);
  console.log(`Gross Profit               : ₹${Math.round(totalGrossProfit).toLocaleString('en-IN')}`);
  console.log(`Charges & STT              : -₹${Math.round(totalTransactionCosts).toLocaleString('en-IN')}`);
  console.log(`Net Profit Before Tax      : ₹${Math.round(netPnlTotal).toLocaleString('en-IN')} (+${((netPnlTotal / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log(`🏆 FINAL TAKE-HOME IN BANK : 🏆 ₹${Math.round(finalTakeHome).toLocaleString('en-IN')} (Net Return: +${(((finalTakeHome - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log('==============================================================================\n');
}

runBreakevenFullTrendTest();
