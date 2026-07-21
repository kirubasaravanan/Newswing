/**
 * Focused Options Backtest Script — NIFTY, BANKNIFTY, FINNIFTY & Top 15 F&O Stocks
 * Evaluates options buying (CE & PE) performance using Black-Scholes pricing
 * and Indian market transaction costs (STT 0.0625%, Brokerage ₹20/order, GST, SEBI).
 */

import { blackScholes, getOptionLotSize } from '../src/lib/options/black-scholes.ts';
import { calculateOptionsCosts } from '../src/lib/trading/transaction-costs.ts';

const INDICES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY'];
const TOP_STOCKS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT',
  'AXISBANK', 'BAJFINANCE', 'TATAMOTORS', 'MARUTI', 'SUNPHARMA',
];

async function fetchSpotCandles(symbol, days = 400) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - days * 1.5 * 86400000) / 1000);
  let sym = symbol;
  if (symbol === 'NIFTY') sym = '^NSEI';
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

function backtestOptionsBuying(symbol, candles) {
  if (candles.length < 50) return null;

  const lotSize = getOptionLotSize(symbol);
  let capital = 100000;
  const initialCapital = 100000;
  const trades = [];

  for (let i = 30; i < candles.length - 5; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];
    const spot = bar.close;
    
    // Direction signal: 2-day breakout or momentum rejection
    const isBullish = bar.close > prevBar.high && bar.close > candles[i - 3].close;
    const isBearish = bar.close < prevBar.low && bar.close < candles[i - 3].close;

    if (!isBullish && !isBearish) continue;

    const direction = isBullish ? 'CE' : 'PE';
    const isIndex = spot > 10000;
    const strikeStep = isIndex ? 50 : 20;
    const strike = Math.round(spot / strikeStep) * strikeStep;
    const iv = 0.18; // 18% implied volatility
    const T = 7 / 365; // 7 DTE
    const r = 0.07; // 7% interest rate

    // Black-Scholes entry premium
    const bsEntry = blackScholes(spot, strike, T, r, iv, direction);
    const entryPrem = Math.max(10, bsEntry.premium);
    const qty = 1; // 1 lot

    // Evaluate trade over up to 4 days holding
    let exitPrem = entryPrem;
    let exitReason = 'HOLD_EXPIRE';

    for (let h = 1; h <= 4; h++) {
      if (i + h >= candles.length) break;
      const futureBar = candles[i + h];
      const futureT = Math.max(1 / 365, (7 - h) / 365);
      const bsFuture = blackScholes(futureBar.close, strike, futureT, r, iv, direction);
      const currentPrem = Math.max(0.05, bsFuture.premium);

      // Stop Loss: -35% of premium
      if (currentPrem <= entryPrem * 0.65) {
        exitPrem = entryPrem * 0.65;
        exitReason = 'SL_HIT';
        break;
      }
      // Target Profit: +75% of premium
      if (currentPrem >= entryPrem * 1.75) {
        exitPrem = entryPrem * 1.75;
        exitReason = 'TP_HIT';
        break;
      }
      exitPrem = currentPrem;
    }

    const grossPnl = (exitPrem - entryPrem) * qty * lotSize;
    const costs = calculateOptionsCosts(entryPrem, exitPrem, lotSize, qty, 'BUY', symbol);
    const netPnl = grossPnl - costs.totalCosts;

    capital += netPnl;
    trades.push({
      symbol, direction, strike, entryPrem, exitPrem, grossPnl, netPnl, costs: costs.totalCosts, exitReason, win: netPnl > 0
    });

    i += 3; // Cooldown 3 bars between options trades
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const grossPnlTotal = capital - initialCapital;
  const winRate = trades.length > 0 ? winTrades.length / trades.length : 0;
  const totalWinPnl = winTrades.reduce((s, t) => s + t.netPnl, 0);
  const totalLossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.netPnl, 0));
  const profitFactor = totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? 99 : 0;
  const totalCostsPaid = trades.reduce((s, t) => s + t.costs, 0);

  return {
    symbol, lotSize, totalTrades: trades.length, winRate, profitFactor, netReturn: (grossPnlTotal / initialCapital) * 100, totalCostsPaid, grossPnlTotal
  };
}

async function run() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  NEWSWING OPTIONS TRADING ENGINE — BACKTEST RESULTS              ║');
  console.log('║  Testing CE & PE buying on NIFTY, BANKNIFTY, FINNIFTY + F&O     ║');
  console.log('║  Includes Options STT (0.0625%), Brokerage, GST, Exchange Fees  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const allSymbols = [...INDICES, ...TOP_STOCKS];
  const results = [];

  for (const sym of allSymbols) {
    const candles = await fetchSpotCandles(sym, 300);
    const r = backtestOptionsBuying(sym, candles);
    if (r && r.totalTrades > 0) {
      results.push(r);
      console.log(`  ${sym.padEnd(12)} Lot:${String(r.lotSize).padEnd(4)} | Trades:${String(r.totalTrades).padEnd(3)} | WR:${(r.winRate*100).toFixed(0)}% | PF:${r.profitFactor.toFixed(2)} | Net:${r.netReturn>=0?'+':''}${r.netReturn.toFixed(1)}% | Costs:₹${Math.round(r.totalCostsPaid)}`);
    }
  }

  if (results.length > 0) {
    const prof = results.filter(r => r.netReturn > 0);
    const avgPF = results.reduce((s, r) => s + r.profitFactor, 0) / results.length;
    const avgNet = results.reduce((s, r) => s + r.netReturn, 0) / results.length;
    const totalCosts = results.reduce((s, r) => s + r.totalCostsPaid, 0);

    console.log(`\n${'═'.repeat(65)}`);
    console.log(`OPTIONS BACKTEST SUMMARY:`);
    console.log(`  Instruments tested: ${results.length}`);
    console.log(`  Profitable:         ${prof.length} / ${results.length} (${((prof.length/results.length)*100).toFixed(0)}%)`);
    console.log(`  Average PF:         ${avgPF.toFixed(2)}`);
    console.log(`  Average Net Return: ${avgNet >= 0 ? '+' : ''}${avgNet.toFixed(1)}%`);
    console.log(`  Total F&O Costs:    ₹${Math.round(totalCosts).toLocaleString('en-IN')}`);
    console.log(`${'═'.repeat(65)}`);
  }
}

run().catch(console.error);
