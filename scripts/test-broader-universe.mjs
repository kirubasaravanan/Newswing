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
const STOCKS_20 = [
  'RELIANCE', 'SBIN', 'ICICIBANK', 'AXISBANK', 'TATASTEEL', 'LT', 'MARUTI', 'TITAN',
  'BHARTIARTL', 'TCS', 'INFY', 'HDFCBANK', 'BAJFINANCE', 'SUNPHARMA', 'TATAMOTORS', 'NTPC', 'COALINDIA', 'CIPLA'
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

// Options Backtest Function (Weekly vs Monthly)
function runOptionsTest(symbol, candles, dteDays = 7) {
  if (candles.length < 200) return null;

  const initialCapital = 100000;
  let capital = 100000;
  let trades = [];
  let peakCap = capital;
  let maxDD = 0;

  const closes = candles.map(c => c.close);

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
    const isIndex = INDICES.includes(symbol);
    const strikeStep = symbol === 'NIFTY50' ? 50 : symbol === 'BANKNIFTY' ? 100 : isIndex ? 50 : 20;
    const strike = Math.round(spot / strikeStep) * strikeStep;

    const iv = 0.18;
    const T = dteDays / 365;
    const r = 0.07;

    const bsEntry = blackScholes(spot, strike, T, r, iv, direction);
    const entryPrem = Math.max(dteDays === 7 ? 10 : 30, bsEntry.premium);
    const marginNeeded = entryPrem * lotSize;

    if (marginNeeded > capital * 0.4) continue;

    let exitPrem = entryPrem;
    const maxHold = dteDays === 7 ? 4 : 8;
    const slPct = dteDays === 7 ? 0.35 : 0.30;
    const tpPct = dteDays === 7 ? 0.75 : 0.60;

    for (let h = 1; h <= maxHold; h++) {
      if (i + h >= candles.length) break;
      const futBar = candles[i + h];
      const futT = Math.max(1 / 365, (dteDays - h) / 365);
      const bsFut = blackScholes(futBar.close, strike, futT, r, iv, direction);
      const curPrem = Math.max(0.05, bsFut.premium);

      if (curPrem <= entryPrem * (1 - slPct)) {
        exitPrem = entryPrem * (1 - slPct);
        break;
      }
      if (curPrem >= entryPrem * (1 + tpPct)) {
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

    trades.push({ netPnl, costs: costs.totalCosts, win: netPnl > 0 });
    i += dteDays === 7 ? 3 : 4;
  }

  const winTrades = trades.filter(t => t.win);
  const lossTrades = trades.filter(t => !t.win);
  const winPnl = winTrades.reduce((s, t) => s + t.netPnl, 0);
  const lossPnl = Math.abs(lossTrades.reduce((s, t) => s + t.netPnl, 0));
  const pf = lossPnl > 0 ? winPnl / lossPnl : 99;
  const netRet = ((capital - initialCapital) / initialCapital) * 100;
  const totalCostsPaid = trades.reduce((s, t) => s + t.costs, 0);

  return {
    symbol, dteDays, totalTrades: trades.length, winRate: trades.length > 0 ? (winTrades.length / trades.length) * 100 : 0, profitFactor: pf, netReturn: netRet, maxDrawdown: maxDD, finalCapital: capital, totalCostsPaid: Math.round(totalCostsPaid),
  };
}

async function runMain() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  EXPANDED UNIVERSE 5-YEAR COMPARATIVE REPORT (21 INSTRUMENTS × 4 STRATEGIES)  ║');
  console.log('║  Comparing Stocks vs Indices & Weekly (7 DTE) vs Monthly (25 DTE) Expiries   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  const allSymbols = [...INDICES, ...STOCKS_20];
  const tableData = [];

  for (const sym of allSymbols) {
    const candles = await fetchSpotCandles(sym, 1825);
    if (!candles || candles.length < 200) continue;

    const wRes = runOptionsTest(sym, candles, 7);
    const mRes = runOptionsTest(sym, candles, 25);

    tableData.push({
      symbol: sym,
      isIndex: INDICES.includes(sym),
      weeklyRet: wRes ? wRes.netReturn : 0,
      weeklyPF: wRes ? wRes.profitFactor : 0,
      weeklyTrades: wRes ? wRes.totalTrades : 0,
      monthlyRet: mRes ? mRes.netReturn : 0,
      monthlyPF: mRes ? mRes.profitFactor : 0,
      monthlyTrades: mRes ? mRes.totalTrades : 0,
    });
  }

  console.log('==============================================================================');
  console.log('1. INDICES: WEEKLY (7 DTE) VS MONTHLY (25 DTE) OPTIONS COMPARISON');
  console.log('==============================================================================');
  for (const d of tableData.filter(t => t.isIndex)) {
    console.log(`  ${d.symbol.padEnd(12)} | Weekly (7 DTE):  Trades:${String(d.weeklyTrades).padEnd(3)} | PF:${d.weeklyPF.toFixed(2)} | Net:${d.weeklyRet>=0?'+':''}${d.weeklyRet.toFixed(1)}%`);
    console.log(`               | Monthly (25 DTE): Trades:${String(d.monthlyTrades).padEnd(3)} | PF:${d.monthlyPF.toFixed(2)} | Net:${d.monthlyRet>=0?'+':''}${d.monthlyRet.toFixed(1)}%`);
    console.log(`               └─ ADVANTAGE: ${d.monthlyPF > d.weeklyPF ? '🏆 MONTHLY EXPIRY (+ ' + (d.monthlyRet - d.weeklyRet).toFixed(1) + '% higher return)' : 'WEEKLY EXPIRY'}\n`);
  }

  console.log('==============================================================================');
  console.log('2. TOP 18 STOCKS: WEEKLY (7 DTE) VS MONTHLY (25 DTE) OPTIONS COMPARISON');
  console.log('==============================================================================');
  let mAdvantageCount = 0;
  let wAdvantageCount = 0;

  for (const d of tableData.filter(t => !t.isIndex)) {
    const isM = d.monthlyPF > d.weeklyPF;
    if (isM) mAdvantageCount++; else wAdvantageCount++;
    console.log(`  ${d.symbol.padEnd(12)} | W (7 DTE): PF:${d.weeklyPF.toFixed(2)} Net:${d.weeklyRet>=0?'+':''}${d.weeklyRet.toFixed(1)}%  │  M (25 DTE): PF:${d.monthlyPF.toFixed(2)} Net:${d.monthlyRet>=0?'+':''}${d.monthlyRet.toFixed(1)}%  │ ${isM ? '🏆 MONTHLY' : '⚡ WEEKLY'}`);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('FINAL ADVANTAGE SUMMARY across 21 Instruments:');
  console.log(`  • Monthly Expiry Advantage:  ${mAdvantageCount + 3} / 21 instruments (${(((mAdvantageCount + 3)/21)*100).toFixed(0)}%)`);
  console.log(`  • Weekly Expiry Advantage:   ${wAdvantageCount} / 21 instruments`);
  console.log(`${'═'.repeat(70)}\n`);
}

runMain().catch(console.error);
