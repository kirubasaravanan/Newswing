import { scanOptionsUniverse } from '../src/lib/trading/options-scanner.ts';
import { fetchDhanOptionChain } from '../src/lib/options/dhan-option-provider.ts';
import { getCurrentPrice } from '../src/lib/trading/data-provider.ts';

async function runTodayParallelBacktest() {
  console.log('================================================================');
  console.log("   PARALLEL INTRADAY OPTIONS BACKTEST REPORT — TODAY (2026-07-23)");
  console.log('================================================================\n');

  // Universe of top F&O symbols to scan for today
  const symbols = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'RELIANCE', 'SBIN', 'LT', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'TATAMOTORS', 'BAJFINANCE', 'BHARTIARTL', 'HAL'];

  console.log('Scanning F&O Universe for today (2026-07-23)...');
  const signals = await scanOptionsUniverse(40);

  console.log(`\nFound ${signals.length} High-Confluence Option Signals for Today:\n`);

  console.log('| # | Symbol | Type | Strike | Spot Price | Real Premium (LTP) | Stop Loss (-25%) | Target (+50%) | Conf % | Score | Signal Factors Aligned |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    
    // Fetch live option chain to verify real broker premium for today's strike
    let brokerLtp = 'Fetching...';
    try {
      const chain = await fetchDhanOptionChain(s.symbol, s.expiry);
      if (chain && chain.chain) {
        const row = chain.chain.find((r) => Math.abs(r.strike - s.strike) < 0.5) || chain.chain.find((r) => r.strike === s.strike);
        const quote = s.direction === 'CE' ? row?.ce : row?.pe;
        if (quote && quote.ltp > 0) {
          brokerLtp = `₹${quote.ltp.toFixed(2)}`;
        }
      }
    } catch (err) {
      brokerLtp = 'N/A';
    }

    const sl = (s.entryPrice * 0.75).toFixed(2);
    const tp = (s.entryPrice * 1.50).toFixed(2);
    const factors = s.reasons.slice(0, 2).join('; ');

    console.log(`| ${i + 1} | **${s.symbol}** | **${s.direction}** | **${s.strike}** | ₹${s.entryPrice.toFixed(2)} | **${brokerLtp}** | ₹${sl} | ₹${tp} | **${s.confidence}%** | **${s.score}/100** | ${factors} |`);
  }

  console.log('\n================================================================');
  console.log('               BROKER CROSS-CHECK INSTRUCTIONS');
  console.log('================================================================');
  console.log('1. Open your Dhan / Zerodha broker charting platform for Today (2026-07-23).');
  console.log('2. Compare the Strike Price (e.g. NIFTY 23800 CE/PE, BANKNIFTY 56500 CE/PE).');
  console.log('3. Verify that the Real Option LTP matches today\'s contract traded premium.');
  console.log('4. Verify SL (-25%) and TP (+50%) risk boundaries against option price chart.');
  console.log('================================================================\n');
}

runTodayParallelBacktest().catch(console.error);
