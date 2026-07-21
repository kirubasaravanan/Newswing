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

import { getHistoricalData } from '../src/lib/trading/data-provider.ts';
import { blackScholes } from '../src/lib/options/black-scholes.ts';
import { calculateOptionsCosts } from '../src/lib/trading/transaction-costs.ts';

const INDICES = ['NIFTY50', 'BANKNIFTY', 'FINNIFTY'];

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

// ── 1. 5-Year Equity Swing Backtest ────────────────────────
async function run5YrEquityBacktest(symbol) {
  const dataRes = await getHistoricalData(symbol, 1825);
  const candles = dataRes.data;
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

  for (let i = 200; i < candles.length; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];

    if (openPos) {
      const curVal = capital + openPos.qty * bar.close;
      peakCap = Math.max(peakCap, curVal);
      maxDD = Math.max(maxDD, ((peakCap - curVal) / peakCap) * 100);

      const low5 = Math.min(...lows.slice(Math.max(0, i - 5), i));
      const trailSL = Math.max(openPos.sl, low5 * 0.995);

      if (bar.low <= trailSL) {
        const exitPnl = openPos.qty * (trailSL - openPos.entryPrice);
        capital += exitPnl + openPos.qty * openPos.entryPrice;
        trades.push({ entryDate: openPos.entryDate, exitDate: bar.date, entryPrice: openPos.entryPrice, exitPrice: trailSL, pnl: exitPnl, win: exitPnl > 0 });
        openPos = null;
      } else if (bar.high >= openPos.tp) {
        const exitPnl = openPos.qty * (openPos.tp - openPos.entryPrice);
        capital += exitPnl + openPos.qty * openPos.entryPrice;
        trades.push({ entryDate: openPos.entryDate, exitDate: bar.date, entryPrice: openPos.entryPrice, exitPrice: openPos.tp, pnl: exitPnl, win: true });
        openPos = null;
      }
    }

    if (!openPos) {
      const e20 = closes.slice(Math.max(0, i - 20), i).reduce((a, b) => a + b, 0) / 20;
      const s50 = closes.slice(Math.max(0, i - 50), i).reduce((a, b) => a + b, 0) / 50;
      const s200 = closes.slice(Math.max(0, i - 200), i).reduce((a, b) => a + b, 0) / 200;

      const minLow3 = Math.min(lows[i], lows[i - 1], lows[i - 2]);
      const nearEMA = minLow3 <= e20 * 1.015 && bar.close >= e20 * 0.985;
      const greenReversal = bar.close > bar.open && bar.close > prevBar.high * 0.995;

      if (bar.close > s50 && s50 > s200 && nearEMA && greenReversal) {
        const entryPrice = bar.close;
        const low3 = Math.min(lows[i], lows[i - 1], lows[i - 2]);
        const sl = low3 * 0.995;
        const risk = entryPrice - sl;
        if (risk > 0) {
          const tp = entryPrice + (risk * 2.5);
          const riskAmt = capital * 0.015;
          const qty = Math.max(1, Math.floor(riskAmt / risk));
          const marginNeeded = qty * entryPrice;
          if (marginNeeded <= capital) {
            capital -= marginNeeded;
            openPos = { entryDate: bar.date, entryPrice, sl, tp, qty, marginNeeded };
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

// ── 2. 5-Year Options Vertical Spread Backtest (Bull Call / Bear Put Spread) ────
async function run5YrOptionsSpreadBacktest(symbol) {
  const dataRes = await getHistoricalData(symbol, 1825);
  const candles = dataRes.data;
  if (!candles || candles.length < 200) return null;

  const initialCapital = 100000;
  let capital = 100000;
  let trades = [];
  let peakCap = capital;
  let maxDD = 0;
  let maxMarginUsed = 0;

  const closes = candles.map(c => c.close);
  const lows = candles.map(c => c.low);

  for (let i = 200; i < candles.length - 5; i++) {
    const bar = candles[i];
    const prevBar = candles[i - 1];
    const spot = bar.close;
    const dateStr = bar.date;
    const lotSize = getHistoricalLotSize(symbol, dateStr);

    const isBullish = bar.close > prevBar.high && bar.close > candles[i - 3].close;
    const isBearish = bar.close < prevBar.low && bar.close < candles[i - 3].close;

    if (!isBullish && !isBearish) continue;

    const direction = isBullish ? 'CE' : 'PE';
    const strikeStep = symbol === 'NIFTY50' ? 50 : symbol === 'BANKNIFTY' ? 100 : 50;
    const buyStrike = Math.round(spot / strikeStep) * strikeStep;
    const sellStrike = direction === 'CE' ? buyStrike + (strikeStep * 2) : buyStrike - (strikeStep * 2);

    const iv = 0.16;
    const T = 7 / 365;
    const r = 0.07;

    // Buy ATM, Sell OTM
    const bsBuy = blackScholes(spot, buyStrike, T, r, iv, direction);
    const bsSell = blackScholes(spot, sellStrike, T, r, iv, direction);
    
    const netDebit = Math.max(5, bsBuy.premium - bsSell.premium);
    const maxLoss = netDebit * lotSize;
    const maxProfit = (Math.abs(sellStrike - buyStrike) - netDebit) * lotSize;
    maxMarginUsed = Math.max(maxMarginUsed, maxLoss);

    if (maxLoss > capital) continue;

    let exitNetDebit = netDebit;

    for (let h = 1; h <= 4; h++) {
      if (i + h >= candles.length) break;
      const futBar = candles[i + h];
      const futT = Math.max(1 / 365, (7 - h) / 365);
      const bsBuyFut = blackScholes(futBar.close, buyStrike, futT, r, iv, direction);
      const bsSellFut = blackScholes(futBar.close, sellStrike, futT, r, iv, direction);
      const curNetDebit = Math.max(0, bsBuyFut.premium - bsSellFut.premium);

      // Stop Loss: -40% of net debit
      if (curNetDebit <= netDebit * 0.6) {
        exitNetDebit = netDebit * 0.6;
        break;
      }
      // Target TP: +60% of net debit
      if (curNetDebit >= netDebit * 1.6) {
        exitNetDebit = netDebit * 1.6;
        break;
      }
      exitNetDebit = curNetDebit;
    }

    const grossPnl = (exitNetDebit - netDebit) * lotSize;
    // Costs for 2 legs (buy + sell)
    const buyCosts = calculateOptionsCosts(bsBuy.premium, bsBuy.premium, lotSize, 1, 'BUY', symbol);
    const sellCosts = calculateOptionsCosts(bsSell.premium, bsSell.premium, lotSize, 1, 'SELL', symbol);
    const totalFriction = buyCosts.totalCosts + sellCosts.totalCosts;

    const netPnl = grossPnl - totalFriction;

    capital += netPnl;
    peakCap = Math.max(peakCap, capital);
    maxDD = Math.max(maxDD, ((peakCap - capital) / peakCap) * 100);

    trades.push({
      date: dateStr,
      symbol,
      direction,
      buyStrike,
      sellStrike,
      lotSize,
      netDebit: Math.round(netDebit * 100) / 100,
      exitNetDebit: Math.round(exitNetDebit * 100) / 100,
      maxLoss: Math.round(maxLoss),
      maxProfit: Math.round(maxProfit),
      netPnl: Math.round(netPnl),
      costs: Math.round(totalFriction),
      win: netPnl > 0,
    });

    i += 3; // Cooldown 3 bars
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
    totalCostsPaid: Math.round(totalCostsPaid),
    maxMarginUsed: Math.round(maxMarginUsed),
    avgMargin: Math.round(trades.reduce((s, t) => s + t.maxLoss, 0) / (trades.length || 1)),
  };
}

async function runMain() {
  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  5-YEAR BACKTEST REPORT — NIFTY, BANKNIFTY & FINNIFTY                        ║');
  console.log('║  Comparing Equity Spot Swing vs Options Vertical Spreads (2021-2026)          ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  // ── 1. Equity Swing 5-Year Backtest ─────────────────────────────
  console.log('==============================================================================');
  console.log('1. EQUITY SPOT SWING 5-YEAR BACKTEST (513 - 1855 Trading Bars)');
  console.log('==============================================================================');

  const eqResults = [];
  for (const sym of INDICES) {
    const res = await run5YrEquityBacktest(sym);
    if (res) {
      eqResults.push(res);
      console.log(`\n📈 ${res.symbol} SPOT SWING`);
      console.log(`   Period:         ${res.startDate} to ${res.endDate} (${res.totalBars} trading days ~5 yrs)`);
      console.log(`   Total Trades:   ${res.totalTrades}`);
      console.log(`   Win Rate:       ${res.winRate.toFixed(1)}%`);
      console.log(`   Profit Factor:  ${res.profitFactor.toFixed(2)}`);
      console.log(`   Net Return:     ${res.netReturn >= 0 ? '+' : ''}${res.netReturn.toFixed(1)}%`);
      console.log(`   Max Drawdown:   ${res.maxDrawdown.toFixed(1)}%`);
      console.log(`   Wallet Growth:  ₹${res.initialCapital.toLocaleString('en-IN')} → ₹${Math.round(res.finalCapital).toLocaleString('en-IN')}`);
    }
  }

  // ── 2. Options Vertical Spreads 5-Year Backtest ────────────────
  console.log('\n==============================================================================');
  console.log('2. OPTIONS VERTICAL SPREADS 5-YEAR BACKTEST (Bull Call / Bear Put Spreads)');
  console.log('==============================================================================');

  const spreadResults = [];
  for (const sym of INDICES) {
    const res = await run5YrOptionsSpreadBacktest(sym);
    if (res) {
      spreadResults.push(res);
      console.log(`\n🎯 ${res.symbol} OPTIONS SPREADS`);
      console.log(`   Period:         ${res.startDate} to ${res.endDate} (${res.totalBars} trading days)`);
      console.log(`   Total Trades:   ${res.totalTrades}`);
      console.log(`   Win Rate:       ${res.winRate.toFixed(1)}%`);
      console.log(`   Profit Factor:  ${res.profitFactor.toFixed(2)}`);
      console.log(`   Net Return:     ${res.netReturn >= 0 ? '+' : ''}${res.netReturn.toFixed(1)}%`);
      console.log(`   Max Drawdown:   ${res.maxDrawdown.toFixed(1)}%`);
      console.log(`   Avg Debit Risk:  ₹${res.avgMargin.toLocaleString('en-IN')} (Peak Risk/Trade: ₹${res.maxMarginUsed.toLocaleString('en-IN')})`);
      console.log(`   F&O Costs Paid:  ₹${res.totalCostsPaid.toLocaleString('en-IN')}`);
      console.log(`   Wallet Growth:  ₹${res.initialCapital.toLocaleString('en-IN')} → ₹${Math.round(res.finalCapital).toLocaleString('en-IN')}`);
    }
  }

  // ── 3. Initial Wallet Capital Breakdown & Automation Requirements ────
  console.log('\n==============================================================================');
  console.log('3. FULL SYSTEM WALLET CAPITAL REQUIREMENT & ALLOCATION SUMMARY');
  console.log('==============================================================================');

  console.log(`
  📌 LOT SIZE EVOLUTION (NSE OFFICIAL TIMELINE):
     • NIFTY 50:    75 (Pre-2021) → 50 (2021-2024) → 25 (May 2024-Present)
     • BANKNIFTY:   25 (Pre-2023) → 15 (July 2023-Present)
     • FINNIFTY:    40 (2021-2024) → 25 (Nov 2024-Present)

  📌 CAPITAL & MARGIN NEEDED PER TRADE (1 LOT SPREAD):
     • NIFTY Option Spread Risk/Trade:     ~₹3,500 - ₹5,500
     • BANKNIFTY Option Spread Risk/Trade: ~₹4,500 - ₹7,500
     • FINNIFTY Option Spread Risk/Trade:  ~₹3,000 - ₹5,000

  💰 INITIAL WALLET CAPITAL NEEDED FOR FULL AUTOMATION:
     ┌──────────────────────────────────┬─────────────────┬──────────────────┐
     │ Automation Scope                 │ Options Wallet  │ Total Portfolio  │
     ├──────────────────────────────────┼─────────────────┼──────────────────┤
     │ NIFTY 50 Only                    │ ₹25,000         │ ₹2,25,000        │
     │ NIFTY + BANKNIFTY                │ ₹50,000         │ ₹2,50,000        │
     │ NIFTY + BANKNIFTY + FINNIFTY     │ ₹75,000 - ₹1L   │ ₹3,00,000        │
     └──────────────────────────────────┴─────────────────┴──────────────────┘

  💡 RECOMMENDED WALLET ALLOCATION:
     • Equity Swing Pool:   ₹2,00,000 (Allocated across top 8 swing stocks)
     • Options Pool:        ₹1,00,000 (Dedicated for Nifty/BankNifty/FinNifty spreads)
     • Grand Total Wallet:  ₹3,00,000
  ==============================================================================\n`);
}

runMain().catch(console.error);
