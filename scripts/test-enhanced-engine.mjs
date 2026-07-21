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

import { blackScholes } from '../src/lib/options/black-scholes.ts';
import { calculateOptionsCosts } from '../src/lib/trading/transaction-costs.ts';

const INDICES = ['NIFTY50', 'BANKNIFTY', 'FINNIFTY'];
const TOP_STOCKS = ['RELIANCE', 'SBIN', 'ICICIBANK', 'AXISBANK', 'TATASTEEL', 'LT', 'MARUTI', 'TITAN'];

function getHistoricalLotSize(symbol, dateStr) {
  if (symbol === 'NIFTY50' || symbol === 'NIFTY') {
    if (dateStr < '2021-07-01') return 75;
    if (dateStr < '2024-04-26') return 50;
    return 25;
  }
  if (symbol === 'BANKNIFTY') {
    if (dateStr < '2023-07-01') return 25;
    return 15;
  }
  if (symbol === 'FINNIFTY') {
    if (dateStr < '2024-11-20') return 40;
    return 25;
  }
  return 1;
}

async function fetchSpotCandles(symbol, days = 1825) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - days * 1.5 * 86400000) / 1000);
  let sym = symbol;
  if (symbol === 'NIFTY50' || symbol === 'NIFTY') sym = '^NSEI';
  else if (symbol === 'BANKNIFTY') sym = '^NSEBANK';
  else if (symbol === 'FINNIFTY') sym = 'NIFTYSFINANCE.NS';
  else sym = `${symbol}.NS`;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${start}&period2=${end}&interval=1d`;
  
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
}

// ── Enhanced Equity Swing Engine (Trailing SL + Multi-TF Entry) ──────────
async function testEnhancedEquitySwing(symbol) {
  const candles = await fetchSpotCandles(symbol, 1825);
  if (!candles || candles.length < 200) return null;

  const initialCapital = 100000;
  let capital = 100000;
  let trades = [];
  let peakCap = capital;
  let maxDD = 0;

  const closes = candles.map(c => c.close);
  const lows = candles.map(c => c.low);
  const highs = candles.map(c => c.high);

  let openPos = null;

  for (let i = 50; i < candles.length; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];

    if (openPos) {
      const curVal = capital + openPos.qty * bar.close;
      peakCap = Math.max(peakCap, curVal);
      maxDD = Math.max(maxDD, ((peakCap - curVal) / peakCap) * 100);

      // Trailing SL: 1.5x ATR below EMA10 or 3-bar low (whichever is higher)
      const e10 = closes.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / 10;
      const low3 = Math.min(lows[i - 1], lows[i - 2], lows[i - 3]);
      const dynamicTrail = Math.max(openPos.sl, low3 * 0.997, e10 * 0.99);
      openPos.sl = Math.max(openPos.sl, dynamicTrail);

      if (bar.low <= openPos.sl) {
        const exitPnl = openPos.qty * (openPos.sl - openPos.entryPrice);
        capital += exitPnl + openPos.qty * openPos.entryPrice;
        trades.push({ entryDate: openPos.entryDate, exitDate: bar.date, entryPrice: openPos.entryPrice, exitPrice: openPos.sl, pnl: exitPnl, win: exitPnl > 0 });
        openPos = null;
      }
    }

    if (!openPos) {
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
            openPos = { entryDate: bar.date, entryPrice, sl, qty, marginNeeded };
          }
        }
      }
    }
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const winPnl = winTrades.reduce((s, t) => s + t.pnl, 0);
  const lossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.pnl, 0));
  const pf = lossPnl > 0 ? winPnl / lossPnl : 99;
  const netRet = ((capital - initialCapital) / initialCapital) * 100;

  return {
    symbol,
    startDate: candles[0].date,
    endDate: candles[candles.length - 1].date,
    totalBars: candles.length,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0,
    profitFactor: pf,
    netReturn: netRet,
    maxDrawdown: maxDD,
    finalCapital: capital,
    initialCapital,
  };
}

// ── 3. Monthly Expiry Options Auto-Trade Backtest (30 DTE vs 7 DTE) ─────
async function testMonthlyOptionsBacktest(symbol) {
  const candles = await fetchSpotCandles(symbol, 1825);
  if (!candles || candles.length < 200) return null;

  const initialCapital = 100000;
  let capital = 100000;
  let trades = [];
  let peakCap = capital;
  let maxDD = 0;

  for (let i = 50; i < candles.length - 10; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];
    const spot = bar.close;
    const dateStr = bar.date;
    const lotSize = getHistoricalLotSize(symbol, dateStr);

    const isBullish = bar.close > prevBar.high && bar.close > candles[i - 3].close;
    const isBearish = bar.close < prevBar.low && bar.close < candles[i - 3].close;

    if (!isBullish && !isBearish) continue;

    const direction = isBullish ? 'CE' : 'PE';
    const strikeStep = (symbol === 'NIFTY50' || symbol === 'NIFTY') ? 50 : symbol === 'BANKNIFTY' ? 100 : 50;
    const strike = Math.round(spot / strikeStep) * strikeStep;

    // MONTHLY EXPIRY: 25 DTE (Days to Expiry) instead of 7 DTE
    const iv = 0.16;
    const T = 25 / 365;
    const r = 0.07;

    const bsEntry = blackScholes(spot, strike, T, r, iv, direction);
    const entryPrem = Math.max(30, bsEntry.premium);
    const marginNeeded = entryPrem * lotSize;

    if (marginNeeded > capital * 0.4) continue;

    let exitPrem = entryPrem;

    for (let h = 1; h <= 8; h++) {
      if (i + h >= candles.length) break;
      const futBar = candles[i + h];
      const futT = Math.max(1 / 365, (25 - h) / 365);
      const bsFut = blackScholes(futBar.close, strike, futT, r, iv, direction);
      const curPrem = Math.max(0.05, bsFut.premium);

      // Stop Loss: -30% of premium
      if (curPrem <= entryPrem * 0.70) {
        exitPrem = entryPrem * 0.70;
        break;
      }
      // Target: +60% of premium
      if (curPrem >= entryPrem * 1.60) {
        exitPrem = curPrem;
        break;
      }
      exitPrem = curPrem;
    }

    const grossPnl = (exitPrem - entryPrem) * lotSize;
    const costs = calculateOptionsCosts(entryPrem, exitPrem, lotSize, 1, 'BUY', symbol);
    const netPnl = grossPnl - costs.totalCosts;

    capital += netPnl;
    peakCap = Math.max(peakCap, capital);
    maxDD = Math.max(maxDD, ((peakCap - capital) / peakCap) * 100);

    trades.push({
      date: dateStr, symbol, direction, strike, lotSize,
      entryPrem: Math.round(entryPrem), exitPrem: Math.round(exitPrem),
      netPnl: Math.round(netPnl), costs: Math.round(costs.totalCosts), win: netPnl > 0
    });

    i += 4; // Cooldown 4 bars
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const winPnl = winTrades.reduce((s, t) => s + t.netPnl, 0);
  const lossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.netPnl, 0));
  const pf = lossPnl > 0 ? winPnl / lossPnl : 99;
  const netRet = ((capital - initialCapital) / initialCapital) * 100;
  const totalCostsPaid = trades.reduce((s, t) => s + t.costs, 0);

  return {
    symbol,
    totalTrades: trades.length,
    winRate: trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0,
    profitFactor: pf,
    netReturn: netRet,
    maxDrawdown: maxDD,
    finalCapital: capital,
    initialCapital,
    totalCostsPaid: Math.round(totalCostsPaid),
  };
}

async function runMain() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  ENHANCED ENGINE 5-YEAR BACKTEST REPORT (TRAILING SL + MONTHLY EXPIRIES)      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('==============================================================================');
  console.log('1. ENHANCED EQUITY SWING (EMA10 Trailing SL + No Target Cap + ~250 Trades)');
  console.log('==============================================================================');

  const allSymbols = [...INDICES, ...TOP_STOCKS];
  for (const sym of allSymbols) {
    const res = await testEnhancedEquitySwing(sym);
    if (res) {
      console.log(`  ${sym.padEnd(12)} Trades:${String(res.totalTrades).padEnd(4)} | WR:${res.winRate.toFixed(1)}% | PF:${res.profitFactor.toFixed(2)} | Return:${res.netReturn>=0?'+':''}${res.netReturn.toFixed(1)}% | MaxDD:${res.maxDrawdown.toFixed(1)}% | Capital:₹${res.initialCapital.toLocaleString()} → ₹${Math.round(res.finalCapital).toLocaleString()}`);
    }
  }

  console.log('\n==============================================================================');
  console.log('2. MONTHLY EXPIRY OPTIONS AUTO-TRADE (25 DTE Monthly Options vs 7 DTE Weekly)');
  console.log('==============================================================================');

  for (const sym of INDICES) {
    const res = await testMonthlyOptionsBacktest(sym);
    if (res) {
      console.log(`  ${sym.padEnd(12)} Trades:${String(res.totalTrades).padEnd(4)} | WR:${res.winRate.toFixed(1)}% | PF:${res.profitFactor.toFixed(2)} | Return:${res.netReturn>=0?'+':''}${res.netReturn.toFixed(1)}% | MaxDD:${res.maxDrawdown.toFixed(1)}% | Capital:₹${res.initialCapital.toLocaleString()} → ₹${Math.round(res.finalCapital).toLocaleString()}`);
    }
  }
}

runMain().catch(console.error);
