import fs from 'fs';
import path from 'path';

// Load .env manually
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

import { getDhanHistoricalDaily } from '../src/lib/trading/dhan-client.ts';
import { getHistoricalData } from '../src/lib/trading/data-provider.ts';

async function testMaxTimeline() {
  console.log('Testing Maximum Historical Timeline Data...\n');

  // Test 1: Yahoo Finance Maximum Daily Data (15 years)
  try {
    const yahooRes = await getHistoricalData('RELIANCE', 5000);
    const candles = yahooRes.data;
    console.log('--- Yahoo Finance Maximum Equity Timeline (RELIANCE) ---');
    console.log('Total daily candles:', candles.length);
    console.log('Start Date:', candles[0].date);
    console.log('End Date:  ', candles[candles.length - 1].date);
    console.log(`Span: ~${(candles.length / 250).toFixed(1)} years`);
  } catch (e) {
    console.error('Yahoo max timeline error:', e.message);
  }

  // Test 2: DhanHQ API v2 Maximum Daily Data (5 years)
  try {
    const toDate = '2026-07-21';
    const fromDate = '2021-01-01'; // ~5.5 years ago
    const dhanRes = await getDhanHistoricalDaily('RELIANCE', fromDate, toDate);
    if (dhanRes && dhanRes.close) {
      console.log('\n--- DhanHQ API v2 Maximum Daily Timeline (RELIANCE) ---');
      console.log('Total daily candles:', dhanRes.close.length);
      const startTime = dhanRes.start_Time?.[0];
      const endTime = dhanRes.start_Time?.[dhanRes.start_Time.length - 1];
      console.log('Start Date:', startTime ? new Date(startTime * 1000).toISOString().split('T')[0] : 'N/A');
      console.log('End Date:  ', endTime ? new Date(endTime * 1000).toISOString().split('T')[0] : 'N/A');
      console.log(`Span: ~${(dhanRes.close.length / 250).toFixed(1)} years`);
    }
  } catch (e) {
    console.error('DhanHQ max timeline error:', e.message);
  }
}

testMaxTimeline();
