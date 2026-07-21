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

const fullUniverse = getFullNSEUniverse().filter(s => s.symbol !== 'NIFTY' && s.symbol !== 'BANKNIFTY');
console.log(`Loaded ${fullUniverse.length} unique NSE stocks from Nifty 50, Nifty 100, FNO, Midcap, and Smallcap segments.`);

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

// Backtest Equity Swing with holding period analysis
function analyzeStockHoldingAndPnl(symbol, candles) {
  if (candles.length < 200) return null;

  let capital = 100000;
  let trades = [];
  const closes = candles.map(c => c.close);
  const lows = candles.map(c => c.low);

  let pos = null;

  for (let i = 50; i < candles.length; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];

    if (pos) {
      pos.holdingDays += 1;

      // Trailing SL logic (EMA10 + Low 3)
      const e10 = closes.slice(Math.max(0, i - 10), i).reduce((a, b) => a + b, 0) / 10;
      const low3 = Math.min(lows[i - 1], lows[i - 2], lows[i - 3]);
      const trailSL = Math.max(pos.sl, low3 * 0.997, e10 * 0.99);
      pos.sl = Math.max(pos.sl, trailSL);

      if (bar.low <= pos.sl) {
        const grossPnl = pos.qty * (pos.sl - pos.entryPrice);
        const costs = calculateEquityCosts(pos.entryPrice, pos.sl, pos.qty).totalCosts;
        const netPnl = grossPnl - costs;

        trades.push({
          symbol,
          entryDate: pos.entryDate,
          exitDate: bar.date,
          holdingDays: pos.holdingDays,
          netPnl,
          roi: (netPnl / (pos.qty * pos.entryPrice)) * 100,
          win: netPnl > 0
        });
        pos = null;
      }
    } else {
      // Entry setup: EMA20 > EMA50, price pullback to EMA20, bullish reversal bar
      const e20 = closes.slice(i - 20, i).reduce((a, b) => a + b, 0) / 20;
      const e50 = closes.slice(i - 50, i).reduce((a, b) => a + b, 0) / 50;

      if (e20 > e50 && prevBar.low <= e20 * 1.01 && bar.close > prevBar.high) {
        const entryPrice = bar.close;
        const sl = Math.min(bar.low, prevBar.low) * 0.99;
        const risk = entryPrice - sl;
        if (risk > 0) {
          const qty = Math.floor(capital / entryPrice);
          if (qty > 0) {
            pos = { entryPrice, sl, qty, entryDate: bar.date, holdingDays: 0 };
          }
        }
      }
    }
  }

  if (trades.length === 0) return null;

  const wins = trades.filter(t => t.win);
  const totalPnl = trades.reduce((a, b) => a + b.netPnl, 0);
  const winPnl = wins.reduce((a, b) => a + b.netPnl, 0);
  const lossPnl = Math.abs(trades.filter(t => !t.win).reduce((a, b) => a + b.netPnl, 0));
  const pf = lossPnl === 0 ? 99 : winPnl / lossPnl;
  const avgHoldingDays = trades.reduce((a, b) => a + b.holdingDays, 0) / trades.length;

  return {
    symbol,
    totalTrades: trades.length,
    winRate: (wins.length / trades.length) * 100,
    profitFactor: pf,
    totalPnl,
    avgHoldingDays: Math.round(avgHoldingDays * 10) / 10,
    maxHoldingDays: Math.max(...trades.map(t => t.holdingDays)),
    minHoldingDays: Math.min(...trades.map(t => t.holdingDays))
  };
}

async function run() {
  console.log('\n--- Fetching & Backtesting Sample Universe (50 Midcap/Smallcap/FNO Stocks) ---');
  const sampleStocks = fullUniverse.slice(0, 75).map(s => s.symbol);
  
  const results = [];
  let fetched = 0;

  for (const sym of sampleStocks) {
    const candles = await fetchSpotCandles(sym);
    if (candles.length > 200) {
      const res = analyzeStockHoldingAndPnl(sym, candles);
      if (res) results.push(res);
    }
    fetched++;
    if (fetched % 15 === 0) console.log(`Fetched ${fetched}/${sampleStocks.length} stocks...`);
  }

  results.sort((a, b) => b.profitFactor - a.profitFactor);

  console.log('\n==============================================================================');
  console.log('HOLDING DAYS & PROFIT FACTOR ANALYSIS (NSE UNIVERSE SAMPLE)');
  console.log('==============================================================================');
  
  const top10 = results.slice(0, 10);
  console.table(top10.map(r => ({
    Symbol: r.symbol,
    Trades: r.totalTrades,
    'Win Rate': `${r.winRate.toFixed(1)}%`,
    PF: r.profitFactor.toFixed(2),
    'Avg Hold (Days)': `${r.avgHoldingDays} days`,
    'Min/Max Hold': `${r.minHoldingDays} - ${r.maxHoldingDays} days`
  })));

  const overallAvgHold = results.reduce((a, b) => a + b.avgHoldingDays, 0) / results.length;
  console.log(`\nOverall Average Holding Period across all stocks: ${overallAvgHold.toFixed(1)} trading days.`);
}

run();
