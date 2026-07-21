/**
 * Batch Backtest Script — Top 20 F&O Stocks + Indices
 * Tests V-Swing strategy across 22 instruments with 3 configs.
 * Run: node scripts/batch-backtest.mjs
 */

const TOP_STOCKS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'SBIN', 'BHARTIARTL', 'ITC', 'KOTAKBANK', 'LT',
  'AXISBANK', 'BAJFINANCE', 'TATAMOTORS', 'MARUTI', 'SUNPHARMA',
  'WIPRO', 'HCLTECH', 'TATASTEEL', 'TITAN', 'POWERGRID',
];
const INDICES = ['NIFTY50', 'BANKNIFTY'];
const ALL_SYMBOLS = [...TOP_STOCKS, ...INDICES];

function estimateCosts(totalTrades, capital, riskPct) {
  const avgTradeSize = capital * (riskPct / 100) * 8;
  const costPerTrade = avgTradeSize * 0.004;
  return totalTrades * costPerTrade;
}

async function runBacktest(symbol, config, days = 500) {
  try {
    const resp = await fetch('http://localhost:3000/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, days, config }),
    });
    if (!resp.ok) return { symbol, success: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    if (!data.success) return { symbol, success: false, error: data.error || 'Unknown' };
    return { symbol, success: true, stats: data.stats, tradeCount: data.trades?.length || data.stats?.totalTrades || 0 };
  } catch (err) {
    return { symbol, success: false, error: err.message };
  }
}

const CONFIGS = {
  'LEVEL2_RELAXED': {
    liveCapital: 200000, riskPct: 1.0, maxSlots: 8, maxOpenTrades: 3,
    maxHoldBars: 30, minScore: 3, minRR: 0.8, cooldownBars: 3, useMacro: true, minTurnoverCr: 5.0,
  },
  'LEVEL1_CONSERVATIVE': {
    liveCapital: 200000, riskPct: 1.0, maxSlots: 8, maxOpenTrades: 3,
    maxHoldBars: 25, minScore: 3, minRR: 1.5, cooldownBars: 1, useMacro: true, minTurnoverCr: 25.0,
  },
  'PROPOSED_BALANCED': {
    liveCapital: 200000, riskPct: 1.0, maxSlots: 8, maxOpenTrades: 3,
    maxHoldBars: 25, minScore: 3, minRR: 1.2, cooldownBars: 2, useMacro: true, minTurnoverCr: 10.0,
  },
};

async function testConfig(configName, config) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TESTING: ${configName} | minRR=${config.minRR} maxHold=${config.maxHoldBars} turnover=${config.minTurnoverCr}Cr`);
  console.log(`${'='.repeat(70)}`);

  const results = [];
  for (const sym of ALL_SYMBOLS) {
    process.stdout.write(`  ${sym.padEnd(15)} `);
    const r = await runBacktest(sym, config);
    if (r.success && r.stats) {
      const s = r.stats;
      const costs = estimateCosts(s.totalTrades, config.liveCapital, config.riskPct);
      const grossRet = ((s.finalCapital - config.liveCapital) / config.liveCapital) * 100;
      const netRet = grossRet - (costs / config.liveCapital) * 100;
      console.log(`${s.totalTrades} trades | WR:${(s.winRate*100).toFixed(0)}% | PF:${s.profitFactor.toFixed(2)} | Gross:${grossRet>=0?'+':''}${grossRet.toFixed(1)}% | Net:${netRet>=0?'+':''}${netRet.toFixed(1)}% | DD:${s.maxDrawdown.toFixed(1)}%`);
      results.push({ symbol: sym, totalTrades: s.totalTrades, winRate: s.winRate, profitFactor: s.profitFactor, grossReturn: grossRet, netReturn: netRet, maxDrawdown: s.maxDrawdown, costs, sharpe: s.sharpeRatio||0, avgWin: s.avgWin||0, avgLoss: s.avgLoss||0 });
    } else {
      console.log(`SKIP: ${r.error}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (results.length === 0) { console.log('No results.'); return { name: configName, results: [] }; }
  results.sort((a, b) => b.netReturn - a.netReturn);
  const prof = results.filter(r => r.netReturn > 0).length;
  const avgNet = results.reduce((s,r) => s + r.netReturn, 0) / results.length;
  const avgPF = results.reduce((s,r) => s + r.profitFactor, 0) / results.length;
  const avgWR = results.reduce((s,r) => s + r.winRate, 0) / results.length;
  const avgDD = results.reduce((s,r) => s + r.maxDrawdown, 0) / results.length;
  const totalCosts = results.reduce((s,r) => s + r.costs, 0);

  console.log(`\n  SUMMARY: ${prof}/${results.length} profitable | Avg Net: ${avgNet>=0?'+':''}${avgNet.toFixed(1)}% | Avg PF: ${avgPF.toFixed(2)} | Avg WR: ${(avgWR*100).toFixed(0)}% | Avg DD: ${avgDD.toFixed(1)}% | Costs: ~₹${Math.round(totalCosts)}`);
  console.log(`  TOP 5: ${results.slice(0,5).map(r=>`${r.symbol}(${r.netReturn>=0?'+':''}${r.netReturn.toFixed(1)}%)`).join(', ')}`);
  console.log(`  WORST 3: ${results.slice(-3).map(r=>`${r.symbol}(${r.netReturn>=0?'+':''}${r.netReturn.toFixed(1)}%)`).join(', ')}`);
  
  return { name: configName, results, summary: { profitable: prof, total: results.length, avgNet, avgPF, avgWR: avgWR*100, avgDD, totalCosts } };
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  NEWSWING — BATCH BACKTEST (22 INSTRUMENTS × 3 CONFIGS)        ║');
  console.log('║  Top 20 F&O Stocks + NIFTY50 + BANKNIFTY | ~2 years data      ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const allResults = [];
  for (const [name, config] of Object.entries(CONFIGS)) {
    allResults.push(await testConfig(name, config));
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log('FINAL COMPARISON');
  console.log(`${'═'.repeat(70)}`);
  for (const c of allResults) {
    if (!c.summary) continue;
    const s = c.summary;
    console.log(`  ${c.name.padEnd(25)} | Prof: ${s.profitable}/${s.total} | Net: ${s.avgNet>=0?'+':''}${s.avgNet.toFixed(1)}% | PF: ${s.avgPF.toFixed(2)} | WR: ${s.avgWR.toFixed(0)}% | DD: ${s.avgDD.toFixed(1)}%`);
  }

  // Recommend
  const best = allResults.filter(c=>c.summary).sort((a,b) => (b.summary?.avgNet||0) - (a.summary?.avgNet||0))[0];
  if (best?.summary) {
    console.log(`\n  RECOMMENDED: ${best.name} (Avg Net Return: ${best.summary.avgNet>=0?'+':''}${best.summary.avgNet.toFixed(1)}%)`);
    console.log(`  ${best.summary.avgPF > 1.2 ? '✅ System has edge — proceed with paper trading' : best.summary.avgPF > 1.0 ? '⚠️  Marginal edge — needs optimization' : '❌ No edge — do NOT deploy'}`);
  }
  console.log();
}

main().catch(console.error);
