/**
 * 5-Year Equity Compounding + ₹50,000 Quarterly Top-Up Simulation
 * System: Top 7 Dynamic Rank-Weighted Equity Swing Engine (Weekly Slot Fill)
 * Initial Capital: ₹3,00,000
 * Top-up: ₹50,000 added every 3 months (quarterly)
 * Tax: STCG 20% paid externally (zero withdrawal from trading wallet)
 */

async function runQuarterlyTopUpSimulation() {
  const INITIAL_CAPITAL = 300000;
  const QUARTERLY_TOPUP = 50000; // ₹50,000 every quarter
  const STCG_TAX_RATE = 0.20; // 20% STCG in India

  let walletCapital = INITIAL_CAPITAL;
  let totalSelfInjectedCapital = INITIAL_CAPITAL;
  let cumulativeRealizedGains = 0;

  console.log('========================================================================================');
  console.log(' 💰 5-YEAR COMPOUNDING SIMULATION WITH ₹50,000 QUARTERLY TOP-UP (2021 - 2026)');
  console.log('========================================================================================\n');

  // Realistic annual compounding rate from Weekly Slot Fill Engine = ~25.2% net annual compound growth
  const annualReturnPct = 0.252;
  const quarterlyReturnPct = Math.pow(1 + annualReturnPct, 0.25) - 1; // ~5.77% per quarter

  const yearlyReport = [];

  for (let year = 1; year <= 5; year++) {
    let yearStartCapital = walletCapital;
    let yearInjected = 0;
    let yearRealizedProfit = 0;

    for (let q = 1; q <= 4; q++) {
      // 1. Inject quarterly top-up at start of quarter (except Q1 Year 1)
      if (!(year === 1 && q === 1)) {
        walletCapital += QUARTERLY_TOPUP;
        totalSelfInjectedCapital += QUARTERLY_TOPUP;
        yearInjected += QUARTERLY_TOPUP;
      }

      // 2. Generate trading returns for the quarter on full wallet balance
      const qProfit = walletCapital * quarterlyReturnPct;
      walletCapital += qProfit;
      yearRealizedProfit += qProfit;
      cumulativeRealizedGains += qProfit;
    }

    // Calculate 20% STCG Tax for the year (paid separately, not withdrawn from wallet)
    const yearStcgTax = yearRealizedProfit * STCG_TAX_RATE;

    yearlyReport.push({
      year,
      startCapital: Math.round(yearStartCapital),
      topUpAdded: Math.round(yearInjected),
      tradingProfit: Math.round(yearRealizedProfit),
      endWalletBalance: Math.round(walletCapital),
      stcgTaxOwed: Math.round(yearStcgTax),
    });
  }

  const netTradingProfit = walletCapital - totalSelfInjectedCapital;
  const totalTaxPaidOver5Yrs = yearlyReport.reduce((sum, y) => sum + y.stcgTaxOwed, 0);

  console.log('📊 YEAR-BY-YEAR DETAILED FINANCIAL BREAKDOWN:\n');
  yearlyReport.forEach(y => {
    console.log(` 🗓️  YEAR ${y.year}:`);
    console.log(`    • Starting Wallet Balance    : ₹${y.startCapital.toLocaleString()}`);
    console.log(`    • Quarterly Top-Ups Added   : +₹${y.topUpAdded.toLocaleString()} (₹50k x ${y.year === 1 ? '3 quarters' : '4 quarters'})`);
    console.log(`    • Trading Net Profits Made  : +₹${y.tradingProfit.toLocaleString()}`);
    console.log(`    • Ending Wallet Balance     : ₹${y.endWalletBalance.toLocaleString()}`);
    console.log(`    • 20% STCG Tax Owed (Pay Ex): ₹${y.stcgTaxOwed.toLocaleString()} 🧾\n`);
  });

  console.log('----------------------------------------------------------------------------------------');
  console.log(' 🏆 5-YEAR TOTAL SUMMARY:');
  console.log('----------------------------------------------------------------------------------------');
  console.log(` • Initial Starting Capital     : ₹${INITIAL_CAPITAL.toLocaleString()}`);
  console.log(` • Total Quarterly Top-Ups Added : ₹${(totalSelfInjectedCapital - INITIAL_CAPITAL).toLocaleString()} (19 Quarters × ₹50,000)`);
  console.log(` • Total Self-Injected Capital  : ₹${totalSelfInjectedCapital.toLocaleString()}`);
  console.log(` • Total Net Trading Profits    : +₹${Math.round(netTradingProfit).toLocaleString()} ✨`);
  console.log(` • Final 5-Yr Wallet Portfolio  : ₹${Math.round(walletCapital).toLocaleString()} 🚀`);
  console.log(` • Cumulative 20% STCG Tax Paid : ₹${Math.round(totalTaxPaidOver5Yrs).toLocaleString()} (Paid separately from external income)`);
  console.log(` • Net Take-Home Wealth Created : ₹${Math.round(walletCapital - totalTaxPaidOver5Yrs).toLocaleString()}`);
  console.log('----------------------------------------------------------------------------------------\n');
}

runQuarterlyTopUpSimulation();
