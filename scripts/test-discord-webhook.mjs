import fs from 'fs';
import path from 'path';

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

import { notifyTradeEntry, notifyTradeExit, sendDiscordAlert } from '../src/lib/notifications/discord.ts';

const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
console.log('Sending Test Notification to Discord Webhook:', webhookUrl);

async function testWebhook() {
  // 1. Startup Embed Alert
  const res1 = await sendDiscordAlert(webhookUrl, [{
    title: '🚀 Antigravity Trading Engine v2 Armed & Ready',
    description: 'System successfully initialized and connected to Discord Webhook Alerts.',
    color: 0x3b82f6,
    fields: [
      { name: '⚡ Intraday Options Broker', value: 'Broker Account A (DhanHQ)', inline: true },
      { name: '📈 Equity Swing Broker', value: 'Broker Account B (DhanHQ)', inline: true },
      { name: '🎯 Equity Swing Allocation', value: 'Top 7 Dynamic Rank-Weighted (25% to 6%)', inline: true },
      { name: '⏰ Intraday Exit Rule', value: 'Mandatory 3:15 PM Intraday Square-off', inline: true },
    ]
  }]);

  console.log('Startup Alert Delivered:', res1);

  // 2. Test Options Entry Alert
  const res2 = await notifyTradeEntry({
    webhookUrl,
    engine: 'INTRADAY_OPTIONS',
    symbol: 'NIFTY50',
    action: 'BUY',
    optionType: 'CE',
    strike: 24500,
    qty: 25,
    entryPrice: 120.50,
    sl: 90.38,
    tp: 180.75,
    broker: 'DhanHQ Options',
    isSimulated: true
  });
  console.log('Options Entry Alert Delivered:', res2);

  // 3. Test Equity Swing Entry Alert (Rank 1 Stock)
  const res3 = await notifyTradeEntry({
    webhookUrl,
    engine: 'EQUITY_SWING',
    symbol: 'TATAELXSI',
    action: 'BUY',
    qty: 10,
    entryPrice: 7250.00,
    sl: 7105.00,
    broker: 'DhanHQ Swing',
    isSimulated: true
  });
  console.log('Equity Swing Entry Alert Delivered:', res3);
}

testWebhook();
