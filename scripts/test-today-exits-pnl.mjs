import { scanOptionsUniverse } from '../src/lib/trading/options-scanner.ts';
import { fetchDhanOptionChain } from '../src/lib/options/dhan-option-provider.ts';
import { getOptionLotSize } from '../src/app/api/auto-trade/route.ts';

async function simulateTodayExitsAndPnL() {
  console.log('================================================================');
  console.log("   INTRADAY OPTIONS EXIT & PnL SIMULATION REPORT — TODAY (2026-07-23)");
  console.log('   (Evaluating SL -25%, TP +50%, & 3:15 PM EOD Square-Off Exits)');
  console.log('================================================================\n');

  const scanResult = await scanOptionsUniverse(35, 40);
  const signals = scanResult.signals.filter(s => s.confidence >= 55);

  let totalRealizedPnl = 0;
  let totalCapitalDeployed = 0;
  let slHits = 0;
  let tpHits = 0;
  let eodExits = 0;

  console.log('---------------------------------------------------------------------------------------------------------------------------------------------');
  console.log('| # | Symbol | Type | Strike | Entry LTP | Qty | Lot Cost | SL (-25%) | TP (+50%) | Exit LTP | Exit Reason | PnL per Lot (₹) | Net PnL % |');
  console.log('---------------------------------------------------------------------------------------------------------------------------------------------');

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const lotSize = getOptionLotSize(s.symbol);
    
    let entryLtp = s.entryPrice > 0 ? s.entryPrice : 100;
    try {
      const chain = await fetchDhanOptionChain(s.symbol, s.expiry);
      if (chain && chain.chain && chain.chain.length > 0) {
        const row = chain.chain.find((r) => Math.abs(r.strike - s.strike) < 0.5) || chain.chain.find((r) => r.strike === s.strike);
        const quote = s.direction === 'CE' ? row?.ce : row?.pe;
        if (quote && quote.ltp > 0) entryLtp = quote.ltp;
      }
    } catch { /* fallback */ }

    const slPrice = Math.round(entryLtp * 0.75 * 100) / 100;
    const tpPrice = Math.round(entryLtp * 1.50 * 100) / 100;
    const lotCost = entryLtp * lotSize;
    totalCapitalDeployed += lotCost;

    // Simulate intraday exit evaluation based on spot momentum direction
    // If momentum aligned with trade direction -> TP or positive EOD exit
    // If momentum counter to trade direction -> SL or negative EOD exit
    let exitReason = '3:15_PM_EOD';
    let exitLtp = entryLtp;

    const isTrendAligned = s.reasons.some(r => r.includes('Strong spot momentum') || r.includes('Above EMA'));

    if (isTrendAligned && s.confidence >= 60) {
      // Reached TP (+50%)
      exitReason = 'TP_HIT';
      exitLtp = tpPrice;
      tpHits++;
    } else if (!isTrendAligned && s.spotChange !== 0 && Math.abs(s.spotChange) > 0.3) {
      // Reached SL (-25%)
      exitReason = 'SL_HIT';
      exitLtp = slPrice;
      slHits++;
    } else {
      // Closed at EOD 3:15 PM with moderate change
      exitReason = '3:15_PM_EOD';
      const changePct = (s.spotChange || 0) * 0.8;
      exitLtp = Math.max(0.05, Math.round((entryLtp * (1 + changePct / 100)) * 100) / 100);
      eodExits++;
    }

    const tradePnl = (exitLtp - entryLtp) * lotSize;
    const pnlPct = ((exitLtp - entryLtp) / entryLtp) * 100;
    totalRealizedPnl += tradePnl;

    const numStr = (i + 1).toString().padStart(2);
    const symStr = s.symbol.padEnd(10);
    const dirStr = s.direction.padEnd(4);
    const strikeStr = s.strike.toString().padStart(6);
    const entryStr = `₹${entryLtp.toFixed(2)}`.padStart(9);
    const lotStr = lotSize.toString().padStart(4);
    const costStr = `₹${lotCost.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`.padStart(11);
    const slStr = `₹${slPrice.toFixed(2)}`.padStart(8);
    const tpStr = `₹${tpPrice.toFixed(2)}`.padStart(8);
    const exitLtpStr = `₹${exitLtp.toFixed(2)}`.padStart(9);
    const reasonStr = exitReason.padEnd(12);
    const pnlSign = tradePnl >= 0 ? '+' : '';
    const pnlStr = `${pnlSign}₹${tradePnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`.padStart(13);
    const pnlPctStr = `${pnlSign}${pnlPct.toFixed(1)}%`.padStart(9);

    console.log(`| ${numStr} | ${symStr} | ${dirStr} | ${strikeStr} | ${entryStr} | ${lotStr} | ${costStr} | ${slStr} | ${tpStr} | ${exitLtpStr} | ${reasonStr} | ${pnlStr} | ${pnlPctStr} |`);
  }

  console.log('---------------------------------------------------------------------------------------------------------------------------------------------');

  const initialWallet = 200000;
  const finalWallet = initialWallet + totalRealizedPnl;
  const netReturnPct = (totalRealizedPnl / initialWallet) * 100;

  console.log('\n================================================================');
  console.log('             TODAY\'S INTRADAY EXIT & PnL SUMMARY');
  console.log('================================================================');
  console.log(` • Total Positions Triggered Today : ${signals.length}`);
  console.log(` • Take Profit Hits (+50% TP)      : ${tpHits} Trades`);
  console.log(` • Stop Loss Hits (-25% SL)        : ${slHits} Trades`);
  console.log(` • EOD Time Exits (3:15 PM IST)    : ${eodExits} Trades`);
  console.log(` • Total Full Exchange Capital     : ₹${totalCapitalDeployed.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Initial Starting Wallet Capital : ₹${initialWallet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Net Session Realized PnL (₹)    : ${totalRealizedPnl >= 0 ? '+' : ''}₹${totalRealizedPnl.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • Net Session Portfolio Return (%) : ${netReturnPct >= 0 ? '+' : ''}${netReturnPct.toFixed(2)}%`);
  console.log(` • End-of-Day Wallet Portfolio NAV : ₹${finalWallet.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log('================================================================\n');
}

simulateTodayExitsAndPnL().catch(console.error);
