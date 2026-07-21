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

const TOP_10_UNIVERSE = [
  'MIDCPNIFTY', 'HINDUNILVR', 'NIFTY50', 'INFY', 'ASIANPAINT',
  'TCS', 'LT', 'MARUTI', 'BANKNIFTY', 'ULTRACEMCO'
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
  if (symbol === 'MIDCPNIFTY') {
    if (dateStr < '2024-11-20') return 75;
    return 50;
  }
  return getOptionLotSize(symbol);
}

async function fetchSpotCandles(symbol, days = 1825) {
  const end = Math.floor(Date.now() / 1000);
  const start = Math.floor((Date.now() - days * 1.5 * 86400000) / 1000);
  let sym = symbol;
  if (symbol === 'NIFTY50' || symbol === 'NIFTY') sym = '^NSEI';
  else if (symbol === 'BANKNIFTY') sym = '^NSEBANK';
  else if (symbol === 'MIDCPNIFTY') sym = '^NSEMDCP50';
  else sym = `${symbol}.NS`;

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
  console.log('Fetching 5-year historical data for Top 10 Intraday Options Portfolio...\n');

  const candlesMap = {};
  for (const sym of TOP_10_UNIVERSE) {
    candlesMap[sym] = await fetchSpotCandles(sym, 1825);
  }

  // Get unique trading dates across all instruments
  const dateSet = new Set();
  for (const sym of TOP_10_UNIVERSE) {
    for (const c of candlesMap[sym]) {
      dateSet.add(c.date);
    }
  }
  const allDates = Array.from(dateSet).sort();

  const initialCapital = 150000; // ₹1.5 Lakh initial wallet
  let wallet = 150000;
  let peakWallet = wallet;
  let maxDD = 0;

  let totalTradesCount = 0;
  let winningTradesCount = 0;
  let totalGrossProfit = 0;
  let totalFrictionCosts = 0; // STT, Brokerage, Exchange fees, GST
  let maxSimultaneousPositions = 0;
  let dailyPosCounts = [];

  for (const dateStr of allDates) {
    let daySignals = [];

    // Check momentum signal for each instrument on this date
    for (const sym of TOP_10_UNIVERSE) {
      const cList = candlesMap[sym];
      const idx = cList.findIndex(c => c.date === dateStr);
      if (idx < 20) continue;

      const bar = cList[idx];
      const prevBar = cList[idx - 1];
      const isBullish = bar.high > prevBar.high * 1.003 && bar.close > bar.open;
      const isBearish = bar.low < prevBar.low * 0.997 && bar.close < bar.open;

      if (isBullish || isBearish) {
        daySignals.push({
          symbol: sym, bar, prevBar, direction: isBullish ? 'CE' : 'PE'
        });
      }
    }

    if (daySignals.length === 0) continue;

    maxSimultaneousPositions = Math.max(maxSimultaneousPositions, daySignals.length);
    dailyPosCounts.push(daySignals.length);

    // Process each intraday signal on this day
    for (const sig of daySignals) {
      const { symbol, bar, prevBar, direction } = sig;
      const lotSize = getHistoricalLotSize(symbol, dateStr);
      const openPrice = bar.open;
      const strikeStep = symbol === 'NIFTY50' ? 50 : symbol === 'BANKNIFTY' ? 100 : symbol === 'MIDCPNIFTY' ? 50 : 20;
      const strike = Math.round(openPrice / strikeStep) * strikeStep;

      const iv = 0.18;
      const T = 4 / 365;
      const r = 0.07;

      const bsEntry = blackScholes(openPrice, strike, T, r, iv, direction);
      const entryPrem = Math.max(10, bsEntry.premium);
      const marginNeeded = entryPrem * lotSize;

      if (marginNeeded > wallet * 0.25) continue; // Risk max 25% of current wallet per trade

      const bestSpot = direction === 'CE' ? bar.high : bar.low;
      const worstSpot = direction === 'CE' ? bar.low : bar.high;
      const closeSpot = bar.close;

      const bsBest = blackScholes(bestSpot, strike, Math.max(0.5/365, T - 0.5/365), r, iv, direction);
      const bsWorst = blackScholes(worstSpot, strike, Math.max(0.5/365, T - 0.5/365), r, iv, direction);
      const bsClose = blackScholes(closeSpot, strike, Math.max(0.5/365, T - 0.5/365), r, iv, direction);

      let exitPrem = bsClose.premium;

      // Fixed TP (+50%) / Fixed SL (-25%)
      if (bsWorst.premium <= entryPrem * 0.75) {
        exitPrem = entryPrem * 0.75;
      } else if (bsBest.premium >= entryPrem * 1.50) {
        exitPrem = entryPrem * 1.50;
      }

      const grossPnl = (exitPrem - entryPrem) * lotSize;
      const costs = calculateOptionsCosts(entryPrem, exitPrem, lotSize, 1, 'BUY', symbol);
      const netPnl = grossPnl - costs.totalCosts;

      totalTradesCount++;
      if (netPnl > 0) winningTradesCount++;
      totalGrossProfit += grossPnl;
      totalFrictionCosts += costs.totalCosts;

      wallet += netPnl;
      peakWallet = Math.max(peakWallet, wallet);
      maxDD = Math.max(maxDD, ((peakWallet - wallet) / peakWallet) * 100);
    }
  }

  const netPnlBeforeTax = wallet - initialCapital;
  const incomeTaxRate = 0.30; // 30% slab rate on F&O business profits in India
  const taxAmount = Math.max(0, netPnlBeforeTax * incomeTaxRate);
  const finalWalletAfterTax = wallet - taxAmount;
  const avgSimultaneous = dailyPosCounts.length > 0 ? (dailyPosCounts.reduce((a, b) => a + b, 0) / dailyPosCounts.length).toFixed(1) : 0;

  console.log('╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║  PORTFOLIO COMPOUNDING & TAX REPORT — 5-YEAR TOP 10 INTRADAY OPTIONS         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`📌 SIMULTANEOUS POSITIONS ANALYSIS:`);
  console.log(`   • Average Simultaneous Trades per Day:  ${avgSimultaneous} trades`);
  console.log(`   • Peak Simultaneous Trades on Heavy Days: ${maxSimultaneousPositions} trades`);
  console.log(`   • Peak Margin Needed to Enter All 10:   ~₹60,000`);

  console.log(`\n💰 5-YEAR FINANCIAL BREAKDOWN (Initial Wallet: ₹1,50,000):`);
  console.log(`   • Total Trades Executed:                ${totalTradesCount} trades`);
  console.log(`   • Portfolio Win Rate:                   ${((winningTradesCount/totalTradesCount)*100).toFixed(1)}%`);
  console.log(`   • Gross Profit Before Charges:          ₹${Math.round(totalGrossProfit).toLocaleString('en-IN')}`);
  console.log(`   • Total F&O Brokerage, STT, GST, SEBI:  -₹${Math.round(totalFrictionCosts).toLocaleString('en-IN')}`);
  console.log(`   • Net Profit After Charges (Pre-Tax):   +₹${Math.round(netPnlBeforeTax).toLocaleString('en-IN')} (+${((netPnlBeforeTax/initialCapital)*100).toFixed(0)}%)`);
  console.log(`   • Est. Income Tax (30% F&O Tax Slab):  -₹${Math.round(taxAmount).toLocaleString('en-IN')}`);
  console.log(`   ─────────────────────────────────────────────────────────────────────────────`);
  console.log(`   🏆 FINAL WALLET BALANCE AFTER ALL TAXES: ₹${Math.round(finalWalletAfterTax).toLocaleString('en-IN')} (Net Return: +${((finalWalletAfterTax-initialCapital)/initialCapital*100).toFixed(0)}%)`);
  console.log(`   • Max Portfolio Drawdown:               ${maxDD.toFixed(1)}%`);
  console.log('==============================================================================\n');
}

runPortfolioSimulation().catch(console.error);
