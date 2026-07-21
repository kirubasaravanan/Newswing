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

import { blackScholes, getOptionLotSize } from '../src/lib/options/black-scholes.ts';
import { calculateOptionsCosts } from '../src/lib/trading/transaction-costs.ts';

const INDICES = ['NIFTY50', 'BANKNIFTY', 'FINNIFTY'];
const TOP_STOCKS = [
  'RELIANCE', 'SBIN', 'ICICIBANK', 'AXISBANK', 'TATASTEEL', 'LT', 'MARUTI', 'TITAN',
  'BHARTIARTL', 'TCS', 'INFY', 'HDFCBANK', 'BAJFINANCE', 'SUNPHARMA'
];

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
  return getOptionLotSize(symbol);
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

// ── Intraday Options Backtest Engine (Same Day 3:15 PM Square-Off) ──────
function runIntradayOptionsTest(symbol, candles) {
  if (candles.length < 50) return null;

  const initialCapital = 100000;
  let capital = 100000;
  let trades = [];
  let peakCap = capital;
  let maxDD = 0;

  for (let i = 20; i < candles.length; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];
    const openPrice = bar.open;
    const dateStr = bar.date;
    const lotSize = getHistoricalLotSize(symbol, dateStr);

    // Intraday Momentum Signal: Gap Up or Breakout above previous high/low
    const isBullish = bar.high > prevBar.high * 1.003 && bar.close > bar.open;
    const isBearish = bar.low < prevBar.low * 0.997 && bar.close < bar.open;

    if (!isBullish && !isBearish) continue;

    const direction = isBullish ? 'CE' : 'PE';
    const isIndex = INDICES.includes(symbol);
    const strikeStep = symbol === 'NIFTY50' ? 50 : symbol === 'BANKNIFTY' ? 100 : isIndex ? 50 : 20;
    const strike = Math.round(openPrice / strikeStep) * strikeStep;

    const iv = 0.18;
    const T = 4 / 365; // ~4 DTE average
    const r = 0.07;

    // Black-Scholes entry premium at Open/Breakout
    const bsEntry = blackScholes(openPrice, strike, T, r, iv, direction);
    const entryPrem = Math.max(10, bsEntry.premium);
    const marginNeeded = entryPrem * lotSize;

    if (marginNeeded > capital * 0.3) continue; // Risk max 30% of wallet per intraday trade

    // Evaluate INTRADAY high/low/close of the SAME DAY (No Overnight Holding!)
    const bestSpot = direction === 'CE' ? bar.high : bar.low;
    const worstSpot = direction === 'CE' ? bar.low : bar.high;
    const closeSpot = bar.close;

    const bsBest = blackScholes(bestSpot, strike, Math.max(0.5/365, T - 0.5/365), r, iv, direction);
    const bsWorst = blackScholes(worstSpot, strike, Math.max(0.5/365, T - 0.5/365), r, iv, direction);
    const bsClose = blackScholes(closeSpot, strike, Math.max(0.5/365, T - 0.5/365), r, iv, direction);

    let exitPrem = bsClose.premium;
    let exitReason = 'INTRADAY_CLOSE_315PM';

    // Intraday SL: -25% of premium
    if (bsWorst.premium <= entryPrem * 0.75) {
      exitPrem = entryPrem * 0.75;
      exitReason = 'INTRADAY_SL_HIT';
    }
    // Intraday TP: +50% of premium
    else if (bsBest.premium >= entryPrem * 1.50) {
      exitPrem = entryPrem * 1.50;
      exitReason = 'INTRADAY_TP_HIT';
    }

    const grossPnl = (exitPrem - entryPrem) * lotSize;
    const costs = calculateOptionsCosts(entryPrem, exitPrem, lotSize, 1, 'BUY', symbol);
    const netPnl = grossPnl - costs.totalCosts;

    capital += netPnl;
    peakCap = Math.max(peakCap, capital);
    maxDD = Math.max(maxDD, ((peakCap - capital) / peakCap) * 100);

    trades.push({
      date: dateStr, symbol, direction, entryPrem: Math.round(entryPrem), exitPrem: Math.round(exitPrem),
      netPnl: Math.round(netPnl), costs: Math.round(costs.totalCosts), win: netPnl > 0, exitReason
    });
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const winPnl = winTrades.reduce((s, t) => s + t.netPnl, 0);
  const lossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.netPnl, 0));
  const pf = lossPnl > 0 ? winPnl / lossPnl : 99;
  const netRet = ((capital - initialCapital) / initialCapital) * 100;
  const totalCostsPaid = trades.reduce((s, t) => s + t.costs, 0);

  return {
    symbol, totalTrades: trades.length, winRate: trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0, profitFactor: pf, netReturn: netRet, maxDrawdown: maxDD, finalCapital: capital, initialCapital, totalCostsPaid: Math.round(totalCostsPaid)
  };
}

async function runMain() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  INTRADAY OPTIONS AUTO-TRADE 5-YEAR BACKTEST (NO OVERNIGHT HOLDING)           ║');
  console.log('║  Mandatory Square-Off at 3:15 PM | Includes STT, Brokerage & Exchange Fees   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  const allSymbols = [...INDICES, ...TOP_STOCKS];
  const results = [];

  for (const sym of allSymbols) {
    const candles = await fetchSpotCandles(sym, 1825);
    const res = runIntradayOptionsTest(sym, candles);
    if (res && res.totalTrades > 0) {
      results.push(res);
      console.log(`  ${sym.padEnd(12)} Trades:${String(res.totalTrades).padEnd(4)} | WR:${res.winRate.toFixed(1)}% | PF:${res.profitFactor.toFixed(2)} | Net Return:${res.netReturn >= 0 ? '+' : ''}${res.netReturn.toFixed(1)}% | MaxDD:${res.maxDrawdown.toFixed(1)}% | F&O Fees:₹${res.totalCostsPaid.toLocaleString()}`);
    }
  }

  const prof = results.filter(r => r.netReturn > 0);
  const avgPF = results.reduce((s, r) => s + r.profitFactor, 0) / results.length;
  const avgNet = results.reduce((s, r) => s + r.netReturn, 0) / results.length;
  const totalFees = results.reduce((s, r) => s + r.totalCostsPaid, 0);

  console.log(`\n${'═'.repeat(75)}`);
  console.log(`INTRADAY OPTIONS BACKTEST SUMMARY (NO OVERNIGHT RISKS):`);
  console.log(`  Instruments tested: ${results.length}`);
  console.log(`  Profitable:         ${prof.length} / ${results.length} (${((prof.length/results.length)*100).toFixed(0)}%)`);
  console.log(`  Average PF:         ${avgPF.toFixed(2)}`);
  console.log(`  Average Net Return: ${avgNet >= 0 ? '+' : ''}${avgNet.toFixed(1)}%`);
  console.log(`  Total F&O Fees:     ₹${Math.round(totalFees).toLocaleString('en-IN')}`);
  console.log(`${'═'.repeat(75)}\n`);
}

runMain().catch(console.error);
