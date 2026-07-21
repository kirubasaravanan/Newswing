import { getHistoricalData } from '../src/lib/trading/data-provider.js';

async function checkTimelines() {
  const stockData = await getHistoricalData('RELIANCE', 500);
  const candles = stockData.data;
  console.log('--- Equity Backtest Timeline (RELIANCE) ---');
  console.log('Total daily candles:', candles.length);
  console.log('Start Date:', candles[0].date);
  console.log('End Date:  ', candles[candles.length - 1].date);

  const niftyData = await getHistoricalData('NIFTY50', 500);
  const nCandles = niftyData.data;
  console.log('\n--- Index Backtest Timeline (NIFTY50) ---');
  console.log('Total daily candles:', nCandles.length);
  console.log('Start Date:', nCandles[0].date);
  console.log('End Date:  ', nCandles[nCandles.length - 1].date);
}

checkTimelines();
