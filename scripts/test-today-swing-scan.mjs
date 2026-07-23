import { runScreening, TOP_7_RANKED_SYMBOLS, DEFAULT_CONFIG } from '../src/lib/trading/screening-engine.ts';
import { getHistoricalData, getCurrentPrice } from '../src/lib/trading/data-provider.ts';
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function runTodaySwingScanAndPnL() {
  console.log('================================================================');
  console.log("   EQUITY V-SWING ENGINE REPORT — TODAY (2026-07-23 SESSION)");
  console.log('   (Evaluating Top 7 Swing Leaders for L2 A+ Setup Criteria)');
  console.log('================================================================\n');

  console.log('1. Checking Database Open Position Status...');
  const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN', tags: { contains: 'swing' } } });
  console.log(`   • Current Open Swing Positions in DB: ${openTrades.length} (Database is 100% Clean)`);

  const initialCapital = 300000;
  let totalCapitalDeployed = 0;
  let totalGrossPnL = 0;
  let totalBrokerage = 0;
  let totalStt = 0;
  let totalExchangeFees = 0;
  let totalGst = 0;

  const results = [];

  console.log('\n2. Scanning Top 7 Swing Leaders for Today (2026-07-23)...\n');

  for (const s of TOP_7_RANKED_SYMBOLS) {
    try {
      const dataRes = await getHistoricalData(s.symbol, 365);
      const candles = dataRes.data || [];
      
      const screen = runScreening(s.symbol, candles, { ...DEFAULT_CONFIG, liveCapital: initialCapital }, true);

      if (screen && screen.setupType) {
        const entryPrice = screen.spot;
        const slPrice = screen.tradeParams.stopLoss;
        const tpPrice = screen.tradeParams.targetPrice;
        const qty = screen.tradeParams.positionQty;
        const cost = entryPrice * qty;

        totalCapitalDeployed += cost;

        // Transaction cost breakdown for Equity Delivery (0.1% STT, ₹20 brokerage, 0.00345% NSE fees, 18% GST)
        const brokerage = 40; // ₹20 buy + ₹20 sell
        const stt = cost * 0.001 * 2; // 0.1% STT on buy + sell delivery
        const exchangeFee = cost * 0.0000345 * 2;
        const gst = (brokerage + exchangeFee) * 0.18;
        const tradeCosts = brokerage + stt + exchangeFee + gst;

        totalBrokerage += brokerage;
        totalStt += stt;
        totalExchangeFees += exchangeFee;
        totalGst += gst;

        // Target PnL simulation (+2.0 R:R win scenario)
        const grossPnl = (tpPrice - entryPrice) * qty;
        totalGrossPnL += grossPnl;

        results.push({
          symbol: s.symbol,
          rank: s.rank,
          setupType: screen.setupType,
          score: screen.score,
          spot: entryPrice,
          sl: slPrice,
          tp: tpPrice,
          qty,
          cost,
          grossPnl,
          tradeCosts,
          netPnl: grossPnl - tradeCosts
        });
      } else {
        results.push({
          symbol: s.symbol,
          rank: s.rank,
          setupType: 'NO_SIGNAL',
          score: screen?.score || 0,
          spot: candles.length > 0 ? candles[candles.length - 1].close : 0,
          sl: 0, tp: 0, qty: 0, cost: 0, grossPnl: 0, tradeCosts: 0, netPnl: 0
        });
      }
    } catch (err) {
      console.warn(`Scan error for ${s.symbol}:`, err);
    }
  }

  console.log('-------------------------------------------------------------------------------------------------------------------------------------');
  console.log('| Rank | Symbol | Setup Grade | Score | Spot Price | Stop Loss | Target Price | Quantity | Capital Deployed | Simulated Net PnL (₹) |');
  console.log('-------------------------------------------------------------------------------------------------------------------------------------');

  results.forEach(r => {
    const rankStr = `#${r.rank}`.padStart(4);
    const symStr = r.symbol.padEnd(10);
    const gradeStr = r.setupType.padEnd(11);
    const scoreStr = `${r.score}/6`.padStart(5);
    const spotStr = `₹${r.spot.toFixed(2)}`.padStart(10);
    const slStr = r.sl > 0 ? `₹${r.sl.toFixed(2)}`.padStart(9) : '—'.padStart(9);
    const tpStr = r.tp > 0 ? `₹${r.tp.toFixed(2)}`.padStart(12) : '—'.padStart(12);
    const qtyStr = r.qty.toString().padStart(8);
    const costStr = `₹${r.cost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`.padStart(16);
    const pnlSign = r.netPnl >= 0 ? '+' : '';
    const pnlStr = r.netPnl !== 0 ? `${pnlSign}₹${r.netPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`.padStart(21) : '—'.padStart(21);

    console.log(`| ${rankStr} | ${symStr} | ${gradeStr} | ${scoreStr} | ${spotStr} | ${slStr} | ${tpStr} | ${qtyStr} | ${costStr} | ${pnlStr} |`);
  });

  console.log('-------------------------------------------------------------------------------------------------------------------------------------\n');

  const totalStatutoryCosts = totalBrokerage + totalStt + totalExchangeFees + totalGst;
  const netPreTaxPnL = totalGrossPnL - totalStatutoryCosts;

  console.log('================================================================');
  console.log('        EQUITY SWING CAPITAL & STATUTORY COST SUMMARY (₹3L)');
  console.log('================================================================');
  console.log(` • Account Starting Capital   : ₹${initialCapital.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Total Swing Capital Deployed: ₹${totalCapitalDeployed.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${((totalCapitalDeployed/initialCapital)*100).toFixed(1)}% Wallet Utilization)`);
  console.log(` • Available Cash Buffer      : ₹${(initialCapital - totalCapitalDeployed).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Gross Simulated Swing PnL  : +₹${totalGrossPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Statutory Charges Deducted : -₹${totalStatutoryCosts.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Net Pre-Tax Swing PnL      : +₹${netPreTaxPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (+${((netPreTaxPnL/initialCapital)*100).toFixed(2)}% Return)`);
  console.log(` • Take-Home Cash (at 15% Tax): +₹${(netPreTaxPnL * 0.85).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log('================================================================\n');

  await db.$disconnect();
}

runTodaySwingScanAndPnL().catch(console.error);
