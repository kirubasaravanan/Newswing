import { calculateOptionsCosts } from '../src/lib/trading/transaction-costs.ts';

function runPostCostTaxReport() {
  console.log('================================================================');
  console.log('    POST-COST & TAX METRICS REPORT — ₹3.0 LAKH ACCOUNT SIMULATION');
  console.log('================================================================\n');

  const initialCapital = 300000;
  const deployedCapital = 162118; // Full Exchange Capital across 24 trades
  const grossPnL = 39088.10; // Gross session PnL

  // 24 trades = 24 Buy Orders + 24 Sell Orders = 48 total transactions
  const totalOrders = 48;
  const brokerage = totalOrders * 20; // ₹20 flat per order (Dhan / Zerodha)
  const stt = 162118 * 0.000625 * 2; // STT on sell side premium
  const exchangeFees = 162118 * 0.00053 * 2; // NSE F&O transaction charges
  const gst = (brokerage + exchangeFees) * 0.18; // 18% GST
  const sebiAndStamp = 162118 * 0.00003 + 50; // SEBI fees & stamp duty

  const totalStatutoryCharges = brokerage + stt + exchangeFees + gst + sebiAndStamp;
  const netPreTaxPnL = grossPnL - totalStatutoryCharges;
  const preTaxReturnPct = (netPreTaxPnL / initialCapital) * 100;

  console.log('1. CAPITAL ALLOCATION:');
  console.log(` • Account Starting Capital   : ₹${initialCapital.toLocaleString('en-IN')}`);
  console.log(` • Full Exchange Deployed     : ₹${deployedCapital.toLocaleString('en-IN')} (54% Wallet Utilization)`);
  console.log(` • Available Buffer Cash      : ₹${(initialCapital - deployedCapital).toLocaleString('en-IN')} (46% Cash Reserve)`);

  console.log('\n2. STATUTORY TRANSACTION CHARGES BREAKDOWN (24 Trades / 48 Orders):');
  console.log(` • Brokerage (₹20 × 48 orders): ₹${brokerage.toFixed(2)}`);
  console.log(` • STT (Securities Tax)       : ₹${stt.toFixed(2)}`);
  console.log(` • Exchange Turnover Fees     : ₹${exchangeFees.toFixed(2)}`);
  console.log(` • GST (18%)                  : ₹${gst.toFixed(2)}`);
  console.log(` • SEBI Fees & Stamp Duty     : ₹${sebiAndStamp.toFixed(2)}`);
  console.log(` • TOTAL STATUTORY CHARGES    : ₹${totalStatutoryCharges.toFixed(2)}`);

  console.log('\n3. NET PnL COMPARISON:');
  console.log(` • Gross Realized PnL         : +₹${grossPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (+13.03% Gross)`);
  console.log(` • Statutory Charges Deducted : -₹${totalStatutoryCharges.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
  console.log(` • NET PRE-TAX REALIZED PnL   : +₹${netPreTaxPnL.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (+${preTaxReturnPct.toFixed(2)}% Net)`);

  console.log('\n4. INCOME TAX ESTIMATES (F&O Non-Speculative Business Income):');
  console.log(` • At 15% Slab (New Regime)   : Net Tax ≈ ₹${(netPreTaxPnL * 0.15).toFixed(2)} → Final Take-Home ≈ +₹${(netPreTaxPnL * 0.85).toFixed(2)}`);
  console.log(` • At 30% Slab (Highest)      : Net Tax ≈ ₹${(netPreTaxPnL * 0.30).toFixed(2)} → Final Take-Home ≈ +₹${(netPreTaxPnL * 0.70).toFixed(2)}`);
  console.log(' • Tax Deductible Expenses    : Brokerage, STT, software subscription, VPS server, & data feed expenses are 100% tax deductible!');
  console.log('================================================================\n');
}

runPostCostTaxReport();
