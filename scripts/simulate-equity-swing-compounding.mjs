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

import { getFullNSEUniverse } from '../src/lib/trading/nse-universe.ts';
import { calculateEquityCosts } from '../src/lib/trading/transaction-costs.ts';

// High Profit Factor & Momentum Midcap/Smallcap Leaders
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

async function runPortfolioSimulation() {
  console.log('Fetching historical daily candles for Top Equity Swing Portfolio...');
  const candleMap = {};
  for (const sym of TOP_SWING_SYMBOLS) {
    const c = await fetchSpotCandles(sym);
    if (c.length > 200) candleMap[sym] = c;
  }

  // Get all unique dates
  const datesSet = new Set();
  Object.values(candleMap).forEach(arr => arr.forEach(c => datesSet.add(c.date)));
  const sortedDates = Array.from(datesSet).sort();

  console.log(`Simulating 5-Year Portfolio across ${sortedDates.length} trading days...`);

  const INITIAL_CAPITAL = 200000; // ₹2 Lakhs initial wallet
  let wallet = INITIAL_CAPITAL;
  const MAX_SLOTS = 8;
  const activePositions = []; // { symbol, entryPrice, qty, sl, entryDate }
  const closedTrades = [];
  
  let totalGrossProfit = 0;
  let totalTransactionCosts = 0;
  let peakPortfolioValue = INITIAL_CAPITAL;
  let maxPortfolioDD = 0;

  for (let dIdx = 50; dIdx < sortedDates.length; dIdx++) {
    const currentDate = sortedDates[dIdx];

    // 1. Manage existing positions
    for (let pIdx = activePositions.length - 1; pIdx >= 0; pIdx--) {
      const pos = activePositions[pIdx];
      const stockCandles = candleMap[pos.symbol];
      if (!stockCandles) continue;

      const bar = stockCandles.find(c => c.date === currentDate);
      if (!bar) continue;

      // Calculate trailing SL (EMA10 + 3-day low)
      const barIdx = stockCandles.findIndex(c => c.date === currentDate);
      if (barIdx >= 10) {
        const e10 = stockCandles.slice(barIdx - 10, barIdx).reduce((a, b) => a + b.close, 0) / 10;
        const low3 = Math.min(stockCandles[barIdx - 1].low, stockCandles[barIdx - 2].low, stockCandles[barIdx - 3]?.low || stockCandles[barIdx - 1].low);
        const trailSL = Math.max(pos.sl, low3 * 0.997, e10 * 0.99);
        pos.sl = Math.max(pos.sl, trailSL);
      }

      // Check Stop Loss Exit
      if (bar.low <= pos.sl) {
        const exitPrice = pos.sl;
        const grossPnl = pos.qty * (exitPrice - pos.entryPrice);
        const costsObj = calculateEquityCosts(pos.entryPrice, exitPrice, pos.qty);
        const costs = costsObj.totalCosts;
        const netPnl = grossPnl - costs;

        wallet += (pos.qty * pos.entryPrice) + netPnl;
        totalGrossProfit += grossPnl;
        totalTransactionCosts += costs;

        closedTrades.push({
          symbol: pos.symbol,
          entryDate: pos.entryDate,
          exitDate: currentDate,
          grossPnl,
          costs,
          netPnl,
          win: netPnl > 0
        });

        activePositions.splice(pIdx, 1);
      }
    }

    // Update equity peak and max drawdown
    let currentInvested = activePositions.reduce((acc, pos) => {
      const cArr = candleMap[pos.symbol];
      const cBar = cArr?.find(c => c.date === currentDate);
      const px = cBar ? cBar.close : pos.entryPrice;
      return acc + (pos.qty * px);
    }, 0);

    const totalPortfolioValue = wallet + currentInvested;
    peakPortfolioValue = Math.max(peakPortfolioValue, totalPortfolioValue);
    const dd = ((peakPortfolioValue - totalPortfolioValue) / peakPortfolioValue) * 100;
    maxPortfolioDD = Math.max(maxPortfolioDD, dd);

    // 2. Open new signals if slots available
    if (activePositions.length < MAX_SLOTS) {
      for (const sym of TOP_SWING_SYMBOLS) {
        if (activePositions.some(p => p.symbol === sym)) continue; // already in trade
        if (activePositions.length >= MAX_SLOTS) break;

        const stockCandles = candleMap[sym];
        if (!stockCandles) continue;

        const barIdx = stockCandles.findIndex(c => c.date === currentDate);
        if (barIdx < 50) continue;

        const bar = stockCandles[barIdx];
        const prevBar = stockCandles[barIdx - 1];

        const closes = stockCandles.slice(barIdx - 50, barIdx).map(c => c.close);
        const e20 = closes.slice(30, 50).reduce((a, b) => a + b, 0) / 20;
        const e50 = closes.reduce((a, b) => a + b, 0) / 50;

        // Entry setup: EMA20 > EMA50, price pullback to EMA20, bullish reversal
        if (e20 > e50 && prevBar.low <= e20 * 1.01 && bar.close > prevBar.high) {
          const entryPrice = bar.close;
          const sl = Math.min(bar.low, prevBar.low) * 0.99;
          
          // Allocation per slot (1/8th of current wallet, max ₹40,000 per stock)
          const slotCapital = Math.min(wallet / (MAX_SLOTS - activePositions.length), wallet * 0.125);
          const qty = Math.floor(slotCapital / entryPrice);

          if (qty > 0 && (qty * entryPrice) <= wallet) {
            wallet -= (qty * entryPrice);
            activePositions.push({
              symbol: sym,
              entryPrice,
              sl,
              qty,
              entryDate: currentDate
            });
          }
        }
      }
    }
  }

  // Liquidate open positions at last close
  const lastDate = sortedDates[sortedDates.length - 1];
  for (const pos of activePositions) {
    const cArr = candleMap[pos.symbol];
    const lastBar = cArr[cArr.length - 1];
    const exitPrice = lastBar ? lastBar.close : pos.entryPrice;
    const grossPnl = pos.qty * (exitPrice - pos.entryPrice);
    const costs = calculateEquityCosts(pos.entryPrice, exitPrice, pos.qty).totalCosts;
    const netPnl = grossPnl - costs;

    wallet += (pos.qty * pos.entryPrice) + netPnl;
    totalGrossProfit += grossPnl;
    totalTransactionCosts += costs;
    closedTrades.push({ symbol: pos.symbol, entryDate: pos.entryDate, exitDate: lastDate, grossPnl, costs, netPnl, win: netPnl > 0 });
  }

  const netPnlTotal = wallet - INITIAL_CAPITAL;
  const wins = closedTrades.filter(t => t.win);
  const winRate = (wins.length / closedTrades.length) * 100;
  
  // Tax Calculations
  const stcgTax20Percent = Math.max(0, netPnlTotal * 0.20);
  const finalTakeHome20 = wallet - stcgTax20Percent;

  const slabTax30Percent = Math.max(0, netPnlTotal * 0.30);
  const finalTakeHome30 = wallet - slabTax30Percent;

  console.log('\n==============================================================================');
  console.log('5-YEAR EQUITY SWING PORTFOLIO COMPOUNDING REPORT (₹2,00,000 STARTING WALLET)');
  console.log('==============================================================================');
  console.log(`Initial Deployment Capital : ₹${INITIAL_CAPITAL.toLocaleString('en-IN')}`);
  console.log(`Total Trades Executed     : ${closedTrades.length}`);
  console.log(`Win Rate                   : ${winRate.toFixed(1)}%`);
  console.log(`Max Portfolio Drawdown     : ${maxPortfolioDD.toFixed(1)}%`);
  console.log('------------------------------------------------------------------------------');
  console.log(`Gross Profit Generated     : ₹${Math.round(totalGrossProfit).toLocaleString('en-IN')}`);
  console.log(`Total Charges & STT (- fees): -₹${Math.round(totalTransactionCosts).toLocaleString('en-IN')}`);
  console.log(`Net Profit Before Tax      : ₹${Math.round(netPnlTotal).toLocaleString('en-IN')} (+${((netPnlTotal / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log('------------------------------------------------------------------------------');
  console.log(`Capital After Fees (Gross) : ₹${Math.round(wallet).toLocaleString('en-IN')}`);
  console.log(`20% STCG Equity Tax        : -₹${Math.round(stcgTax20Percent).toLocaleString('en-IN')}`);
  console.log(`🏆 FINAL TAKE-HOME IN BANK (20% STCG) : ₹${Math.round(finalTakeHome20).toLocaleString('en-IN')} (Net Return: +${(((finalTakeHome20 - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log(`Alternative (30% Income Tax Slab)    : ₹${Math.round(finalTakeHome30).toLocaleString('en-IN')} (Net Return: +${(((finalTakeHome30 - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log('==============================================================================\n');
}

runPortfolioSimulation();
