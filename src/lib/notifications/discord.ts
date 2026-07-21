/**
 * Discord Webhook Notification Service v2
 * Comprehensive real-time alerts for Options & Equity Swing trading:
 * - Options & Equity Entries
 * - Options & Equity Exits with exact PnL (₹ and %)
 * - 3:15 PM Mandatory Intraday Square-Off
 * - Daily Summary & Monthly Rotation Alerts
 */

export interface DiscordEmbed {
  title: string;
  description?: string;
  color?: number; // 0x22c55e (Green), 0xef4444 (Red), 0x3b82f6 (Blue), 0xa855f7 (Purple)
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export async function sendDiscordAlert(webhookUrl: string, embeds: DiscordEmbed[]) {
  if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
    console.warn('[Discord Notification] Invalid or missing DISCORD_WEBHOOK_URL');
    return false;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'Antigravity Trading Bot',
        avatar_url: 'https://cdn-icons-png.flaticon.com/512/616/616490.png',
        embeds: embeds.map(e => ({
          ...e,
          timestamp: e.timestamp || new Date().toISOString(),
          footer: e.footer || { text: 'PMS Auto-Trade Engine v2 • Indian Markets' }
        }))
      })
    });

    return res.ok;
  } catch (err) {
    console.error('[Discord Notification Error]:', err);
    return false;
  }
}

/**
 * Send Entry Alert for Intraday Options or Equity Swing
 */
export async function notifyTradeEntry(params: {
  webhookUrl: string;
  engine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING';
  symbol: string;
  action: 'BUY' | 'SELL';
  optionType?: 'CE' | 'PE';
  strike?: number;
  qty: number;
  entryPrice: number;
  sl: number;
  tp?: number;
  broker: string;
  isSimulated: boolean;
}) {
  const isOptions = params.engine === 'INTRADAY_OPTIONS';
  const label = isOptions && params.strike && params.optionType 
    ? `${params.symbol} ${params.strike} ${params.optionType}` 
    : params.symbol;

  const title = isOptions
    ? `⚡ INTRADAY OPTION ENTRY: ${label}`
    : `📈 EQUITY SWING ENTRY: ${label}`;

  const color = 0x3b82f6; // Blue

  const fields = [
    { name: 'Engine Strategy', value: isOptions ? '⚡ Intraday Options' : '📈 Equity Swing', inline: true },
    { name: 'Execution Mode', value: params.isSimulated ? '🧪 Paper Simulation' : `🚀 Live (${params.broker})`, inline: true },
    { name: 'Side & Quantity', value: `${params.action} ${params.qty} units`, inline: true },
    { name: 'Entry Premium/Price', value: `₹${params.entryPrice.toFixed(2)}`, inline: true },
    { name: 'Stop Loss (-25%)', value: `₹${params.sl.toFixed(2)}`, inline: true },
  ];

  if (params.tp) {
    fields.push({ name: 'Take Profit (+50%)', value: `₹${params.tp.toFixed(2)}`, inline: true });
  }

  return sendDiscordAlert(params.webhookUrl, [{ title, color, fields }]);
}

/**
 * Send Exit Alert with Complete PnL (Options & Equity)
 */
export async function notifyTradeExit(params: {
  webhookUrl: string;
  engine: 'INTRADAY_OPTIONS' | 'EQUITY_SWING';
  symbol: string;
  optionType?: 'CE' | 'PE';
  strike?: number;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl?: number;
  charges?: number;
  netPnl: number;
  reason: string; // 'TARGET_TP', 'STOP_LOSS', 'INTRADAY_315_EXIT', etc.
  isSimulated: boolean;
}) {
  const isWin = params.netPnl > 0;
  const is315Exit = params.reason.includes('315') || params.reason.includes('3:15');

  const isOptions = params.engine === 'INTRADAY_OPTIONS';
  const label = isOptions && params.strike && params.optionType 
    ? `${params.symbol} ${params.strike} ${params.optionType}` 
    : params.symbol;

  let title = `${isWin ? '🟢 PROFIT EXIT' : '🔴 LOSS EXIT'}: ${label}`;
  let color = isWin ? 0x22c55e : 0xef4444; // Green vs Red

  if (is315Exit) {
    title = `⏰ 3:15 PM INTRADAY SQUARE-OFF: ${label}`;
    color = 0xa855f7; // Purple for 3:15 PM mandatory exit
  }

  const roiPct = ((params.exitPrice - params.entryPrice) / params.entryPrice) * 100;

  const fields = [
    { name: 'Engine Strategy', value: isOptions ? '⚡ Intraday Options' : '📈 Equity Swing', inline: true },
    { name: 'Exit Reason', value: params.reason, inline: true },
    { name: 'Net Realized PnL', value: `**${isWin ? '+' : ''}₹${params.netPnl.toFixed(2)} (${roiPct > 0 ? '+' : ''}${roiPct.toFixed(1)}%)**`, inline: true },
    { name: 'Buy Premium', value: `₹${params.entryPrice.toFixed(2)}`, inline: true },
    { name: 'Sell Premium', value: `₹${params.exitPrice.toFixed(2)}`, inline: true },
    { name: 'Quantity / Lots', value: `${params.qty} units`, inline: true },
  ];

  if (params.charges) {
    fields.push({ name: 'Taxes & STT', value: `-₹${params.charges.toFixed(2)}`, inline: true });
  }

  return sendDiscordAlert(params.webhookUrl, [{ title, color, fields }]);
}
