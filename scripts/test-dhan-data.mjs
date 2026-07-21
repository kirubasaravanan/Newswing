import { getHistoricalData, getCurrentPrice } from '../src/lib/trading/data-provider.js';

async function testDataProvider() {
  console.log('Testing Data Provider with DhanHQ Live Data...\n');

  // Test 1: Quote for RELIANCE
  try {
    const quoteRes = await getCurrentPrice('RELIANCE');
    console.log('RELIANCE Current Price (DhanHQ):', quoteRes.price, '| Source:', quoteRes.source);
    console.log('Quote Details:', quoteRes.quote);
  } catch (e) {
    console.error('RELIANCE Quote Error:', e);
  }

  // Test 2: Historical Data for NIFTY50
  try {
    const histRes = await getHistoricalData('NIFTY50', 30);
    console.log('\nNIFTY50 Historical Candles Count (DhanHQ):', histRes.data.length);
    console.log('Latest Candle:', histRes.data[histRes.data.length - 1]);
  } catch (e) {
    console.error('NIFTY50 Historical Error:', e);
  }
}

testDataProvider();
