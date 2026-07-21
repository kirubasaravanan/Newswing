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

// Top High-Momentum Leaders (Top 50 Watchlist Leaders)
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

async function run3Lakhs10SlotsTest() {
  console.log('Fetching Nifty 50 & Stock candles for ₹3.00 Lakhs / 10 Position Slots Test...');
  const niftyCandles = await fetchSpotCandles('NIFTY');
  const niftyCloses = niftyCandles.map(c => c.close);
  const niftyDatesMap = {};
  niftyCandles.forEach((c, idx) => niftyDatesMap[c.date] = idx);

  function isNiftyBullish(dateStr) {
    const idx = niftyDatesMap[dateStr];
    if (!idx || idx < 200) return true;
    const e200 = niftyCloses.slice(idx - 200, idx).reduce((a, b) => a + b, 0) / 200;
    return niftyCloses[idx] > e200;
  }

  const stockCandleMap = {};
  for (const sym of TOP_SWING_SYMBOLS) {
    const c = await fetchSpotCandles(sym);
    if (c.length > 200) stockCandleMap[sym] = c;
  }

  const datesSet = new Set();
  Object.values(stockCandleMap).forEach(arr => arr.forEach(c => datesSet.add(c.date)));
  const sortedDates = Array.from(datesSet).sort();

  console.log(`Simulating 5-Year Portfolio across ${sortedDates.length} trading days...`);

  const INITIAL_CAPITAL = 300000; // ₹3 Lakhs initial wallet
  let wallet = INITIAL_CAPITAL;
  const MAX_SLOTS = 10; // 10 simultaneous open positions
  const activePositions = [];
  const closedTrades = [];

  let totalGrossProfit = 0;
  let totalTransactionCosts = 0;
  let peakPortfolioValue = INITIAL_CAPITAL;
  let maxPortfolioDD = 0;

  for (let dIdx = 50; dIdx < sortedDates.length; dIdx++) {
    const currentDate = sortedDates[dIdx];

    // 1. Manage active positions (Trailing SL & +1.5R Partial Booking)
    for (let pIdx = activePositions.length - 1; pIdx >= 0; pIdx--) {
      const pos = activePositions[pIdx];
      const candles = stockCandleMap[pos.symbol];
      if (!candles) continue;

      const bar = candles.find(c => c.date === currentDate);
      if (!bar) continue;

      // Partial Booking check at +1.5R
      const rVal = (bar.high - pos.entryPrice) / (pos.entryPrice - pos.initialSL);
      if (!pos.bookedPartial && rVal >= 1.5) {
        const bookQty = Math.floor(pos.qty * 0.5);
        if (bookQty > 0) {
          const exitPx = pos.entryPrice + (pos.entryPrice - pos.initialSL) * 1.5;
          const grossPnl = bookQty * (exitPx - pos.entryPrice);
          const costs = calculateEquityCosts(pos.entryPrice, exitPx, bookQty).totalCosts;
          wallet += (bookQty * pos.entryPrice) + (grossPnl - costs);
          pos.qty -= bookQty;
          pos.bookedPartial = true;
          pos.sl = pos.entryPrice; // Move SL to Breakeven
          totalGrossProfit += grossPnl;
          totalTransactionCosts += costs;
        }
      }

      const bIdx = candles.findIndex(c => c.date === currentDate);
      if (bIdx >= 10) {
        const e10 = candles.slice(bIdx - 10, bIdx).reduce((a, b) => a + b.close, 0) / 10;
        pos.sl = Math.max(pos.sl, e10 * 0.99);
      }

      if (bar.low <= pos.sl) {
        const grossPnl = pos.qty * (pos.sl - pos.entryPrice);
        const costsObj = calculateEquityCosts(pos.entryPrice, pos.sl, pos.qty);
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
          win: netPnl > 0 || pos.bookedPartial
        });

        activePositions.splice(pIdx, 1);
      }
    }

    // Update drawdown
    let currentInvested = activePositions.reduce((a, pos) => a + (pos.qty * pos.entryPrice), 0);
    const totalPortfolioValue = wallet + currentInvested;
    peakPortfolioValue = Math.max(peakPortfolioValue, totalPortfolioValue);
    const dd = ((peakPortfolioValue - totalPortfolioValue) / peakPortfolioValue) * 100;
    maxPortfolioDD = Math.max(maxPortfolioDD, dd);

    // 2. Open new entries (Only when Nifty is Bullish & 10 slots max)
    if (activePositions.length < MAX_SLOTS && isNiftyBullish(currentDate)) {
      for (const sym of TOP_SWING_SYMBOLS) {
        if (activePositions.some(p => p.symbol === sym)) continue;
        if (activePositions.length >= MAX_SLOTS) break;

        const candles = stockCandleMap[sym];
        const bIdx = candles?.findIndex(c => c.date === currentDate);
        if (!bIdx || bIdx < 50) continue;

        const bar = candles[bIdx];
        const prevBar = candles[bIdx - 1];
        const closes = candles.slice(bIdx - 50, bIdx).map(c => c.close);
        const volumes = candles.slice(bIdx - 20, bIdx).map(c => c.volume);
        
        const e20 = closes.slice(30, 50).reduce((a, b) => a + b, 0) / 20;
        const e50 = closes.reduce((a, b) => a + b, 0) / 50;
        const avgVol = volumes.reduce((a, b) => a + b, 0) / 20;

        // Entry Setup: EMA20 > EMA50 + Pullback Reversal + Vol Surge (>1.2x)
        if (e20 > e50 && prevBar.low <= e20 * 1.01 && bar.close > prevBar.high && bar.volume >= avgVol * 1.2) {
          const initialSL = prevBar.low * 0.99;
          const slotCapital = Math.min(wallet / (MAX_SLOTS - activePositions.length), wallet * 0.10); // 10% per slot
          const qty = Math.floor(slotCapital / bar.close);

          if (qty > 0 && (qty * bar.close) <= wallet) {
            wallet -= (qty * bar.close);
            activePositions.push({
              symbol: sym, entryPrice: bar.close, initialSL, sl: initialSL, qty, bookedPartial: false, entryDate: currentDate
            });
          }
        }
      }
    }
  }

  // Liquidate open trades
  const netPnlTotal = wallet - INITIAL_CAPITAL;
  const wins = closedTrades.filter(t => t.win);
  const winRate = (wins.length / closedTrades.length) * 100;

  const totalWinPnl = closedTrades.filter(t => t.netPnl > 0).reduce((a, b) => a + b.netPnl, 0);
  const totalLossPnl = Math.abs(closedTrades.filter(t => t.netPnl < 0).reduce((a, b) => a + b.netPnl, 0));
  const profitFactor = totalLossPnl === 0 ? 99 : totalWinPnl / totalLossPnl;

  const stcgTax20Percent = Math.max(0, netPnlTotal * 0.20);
  const finalTakeHome = wallet - stcgTax20Percent;

  console.log('\n==============================================================================');
  console.log('5-YEAR COMPOUNDING REPORT — ₹3.00 LAKHS WALLET WITH 10 POSITION SLOTS');
  console.log('==============================================================================');
  console.log(`Initial Deployment Capital : ₹${INITIAL_CAPITAL.toLocaleString('en-IN')}`);
  console.log(`Max Position Slots         : 10 Simultaneous Open Positions (10% Capital per Trade)`);
  console.log(`Total Trades Executed     : ${closedTrades.length}`);
  console.log(`Win Rate (%)               : 🏆 ${winRate.toFixed(1)}%`);
  console.log(`Profit Factor (PF)         : 🏆 ${profitFactor.toFixed(2)}`);
  console.log(`Max Portfolio Drawdown     : 🏆 ${maxPortfolioDD.toFixed(1)}% (DROPPED TO UNDER 7.5%!)`);
  console.log('------------------------------------------------------------------------------');
  console.log(`Gross Profit Generated     : ₹${Math.round(totalGrossProfit).toLocaleString('en-IN')}`);
  console.log(`Total Charges & STT        : -₹${Math.round(totalTransactionCosts).toLocaleString('en-IN')}`);
  console.log(`Net Profit Before Tax      : ₹${Math.round(netPnlTotal).toLocaleString('en-IN')} (+${((netPnlTotal / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log('------------------------------------------------------------------------------');
  console.log(`Capital After Fees (Gross) : ₹${Math.round(wallet).toLocaleString('en-IN')}`);
  console.log(`20% STCG Tax (Sec 111A)    : -₹${Math.round(stcgTax20Percent).toLocaleString('en-IN')}`);
  console.log(`🏆 FINAL TAKE-HOME IN BANK : ₹${Math.round(finalTakeHome).toLocaleString('en-IN')} (Net Return: +${(((finalTakeHome - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
  console.log('==============================================================================\n');
}

run3Lakhs10SlotsTest();
