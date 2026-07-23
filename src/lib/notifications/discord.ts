/**
 * Discord Trade Signal Notification Service
 * Sends real-time alerts for all auto-trade events.
 * Supports both EQUITY SWING and OPTIONS signal types.
 *
 * Signal flow:
 *   Auto-Entry  → sendDiscordEquitySignal()   or sendDiscordSignal() (options)
 *   Auto-Exit   → sendDiscordEquityExit()     or sendDiscordPaperResult() (options)
 *   System      → sendDiscordSystemAlert()
 */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

// ── Options Signal Types (kept for backward compat) ────────────

export interface TradeSignal {
  symbol: string;
  strike: number;
  optionType: 'CE' | 'PE';
  expiry: string;
  spotPrice: number;
  premium: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  lots: number;
  totalCapital: number;
  confluenceScore: number;
  setupType: string;
  direction: string;
  engine: 'OPTIONS' | 'SWING';
  dataSource: string;
  timestamp: string;
}

export interface PaperTradeResult {
  signal: TradeSignal;
  exitPremium: number;
  pnl: number;
  pnlPct: number;
  exitReason: string;
  exitAt: string;
  status: 'WIN' | 'LOSS' | 'OPEN';
}

// ── Equity Signal Types ────────────────────────────────────────

export interface EquityTradeSignal {
  symbol: string;
  stockName: string;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  qty: number;
  riskReward: number;
  score: number;               // 0-6 confluence score
  setupType: 'A+' | 'B';
  niftyRegime: string;         // BULLISH / BEARISH / UNKNOWN
  adaptiveFactor: number;      // 0.2–1.0 position size factor
  sector: string;
  capital: number;             // Capital deployed (entryPrice × qty)
  riskRs: number;             // ₹ at risk (entryPrice - SL) × qty
  dataSource: string;
  tradeId: string;
  timestamp: string;
}

export interface EquityTradeExit {
  signal: EquityTradeSignal;
  exitPrice: number;
  exitReason: string;
  holdingDays: number;
  rMultiple: string;           // e.g. "2.3R"
  grossPnl: number;
  netPnl: number;             // After costs
  totalCosts: number;
  brokerageCost: number;
  sttCost: number;
  slippageCost: number;
  exitAt: string;
  status: 'WIN' | 'LOSS' | 'BREAKEVEN';
}

export interface EquityPartialBook {
  signal: EquityTradeSignal;
  bookedQty: number;
  remainingQty: number;
  bookPrice: number;
  rMultiple: string;
  grossPnl: number;
  netPnl: number;
  totalCosts: number;
}

// ── Helpers ────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function fmtPnl(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}₹${fmt(Math.abs(n))}`;
}

async function postToDiscord(embed: object): Promise<boolean> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn('[Discord] DISCORD_WEBHOOK_URL not set — notification not sent');
    return false;
  }
  try {
    const res = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[Discord] ❌ Webhook ${res.status}: ${await res.text()}`);
    }
    return res.ok;
  } catch (err) {
    console.error('[Discord] Error:', String(err));
    return false;
  }
}

// ── Equity Signals ─────────────────────────────────────────────

/**
 * Send a Discord alert when the equity auto-trade engine opens a new position.
 * Called BEFORE the DB write so you can validate the signal in real-time.
 */
export async function sendDiscordEquitySignal(signal: EquityTradeSignal): Promise<boolean> {
  const setupEmoji = signal.setupType === 'A+' ? '⭐⭐' : '⭐';
  const regimeEmoji = signal.niftyRegime === 'BULLISH' ? '🟢' : signal.niftyRegime === 'BEARISH' ? '🔴' : '🟡';
  const sizeWarning = signal.adaptiveFactor < 1.0 ? ` ⚠️ (${(signal.adaptiveFactor * 100).toFixed(0)}% adaptive)` : '';

  const scoreBar = '█'.repeat(signal.score) + '░'.repeat(6 - signal.score);

  const embed = {
    title: `📈 ENTRY SIGNAL: ${signal.symbol} | ${signal.setupType} Setup`,
    description: `**${signal.stockName}** | ${signal.sector}\n${setupEmoji} Score: \`${scoreBar}\` ${signal.score}/6`,
    color: signal.setupType === 'A+' ? 0x00d4aa : 0x5865F2,
    fields: [
      { name: '💰 Entry Price', value: `₹${fmt(signal.entryPrice)}`, inline: true },
      { name: '🛑 Stop Loss', value: `₹${fmt(signal.stopLoss)}`, inline: true },
      { name: '🎯 Target', value: `₹${fmt(signal.targetPrice)}`, inline: true },
      { name: '📦 Qty', value: `${signal.qty} shares${sizeWarning}`, inline: true },
      { name: '📊 R:R', value: `${signal.riskReward.toFixed(2)}x`, inline: true },
      { name: '💵 Deployed', value: `₹${fmt(signal.capital)}`, inline: true },
      { name: '⚠️ Risk', value: `₹${fmt(signal.riskRs)}`, inline: true },
      { name: `${regimeEmoji} Nifty Regime`, value: signal.niftyRegime, inline: true },
      { name: '🔌 Data Source', value: signal.dataSource, inline: true },
    ],
    footer: { text: `📋 PAPER TRADE — NewSwing PMS v2 | Trade ID: ${signal.tradeId}` },
    timestamp: new Date().toISOString(),
  };

  const ok = await postToDiscord(embed);
  if (ok) console.log(`[Discord] ✅ Equity entry signal sent: ${signal.symbol} @ ₹${signal.entryPrice}`);
  return ok;
}

/**
 * Send a Discord alert when an equity position is closed.
 * Shows gross P&L, net P&L, and full cost breakdown.
 */
export async function sendDiscordEquityExit(result: EquityTradeExit): Promise<boolean> {
  const { signal, grossPnl, netPnl, totalCosts, exitReason, holdingDays, rMultiple } = result;

  const isWin = netPnl > 0;
  const emoji = result.status === 'WIN' ? '✅' : result.status === 'LOSS' ? '❌' : '➖';
  const color = result.status === 'WIN' ? 0x00d4aa : result.status === 'LOSS' ? 0xff4444 : 0xffa500;

  const reasonLabel: Record<string, string> = {
    'SL_HIT': '🛑 Stop Loss Hit',
    'TP_HIT': '🎯 Target Reached',
    'TRAIL_STOP': '🔄 Trailing Stop',
    'MAX_HOLDING_DAYS': '⏰ Max Hold Expired',
    'STALE_LOSER': '💀 Stale Loser Exit',
    'TIME_EXIT': '⏱️ Time-Based Exit',
  };

  const embed = {
    title: `${emoji} EXIT: ${signal.symbol} | ${result.status} | ${rMultiple}`,
    description: `**${signal.stockName}** | ${reasonLabel[exitReason] || exitReason}`,
    color,
    fields: [
      { name: '📥 Entry', value: `₹${fmt(signal.entryPrice)}`, inline: true },
      { name: '📤 Exit', value: `₹${fmt(result.exitPrice)}`, inline: true },
      { name: '📅 Held', value: `${holdingDays} day(s)`, inline: true },
      { name: '💰 Gross P&L', value: fmtPnl(grossPnl), inline: true },
      { name: '🏷️ Costs (STT+Brokerage+Slippage)', value: `−₹${fmt(totalCosts)}`, inline: true },
      { name: isWin ? '✅ Net P&L' : '❌ Net P&L', value: `**${fmtPnl(netPnl)}**`, inline: true },
      { name: '📊 Brokerage', value: `₹${fmt(result.brokerageCost)}`, inline: true },
      { name: '📊 STT', value: `₹${fmt(result.sttCost)}`, inline: true },
      { name: '📊 Slippage', value: `₹${fmt(result.slippageCost)}`, inline: true },
    ],
    footer: { text: `📋 PAPER TRADE | NewSwing PMS v2 | ${signal.setupType} Setup | Score ${signal.score}/6` },
    timestamp: new Date().toISOString(),
  };

  const ok = await postToDiscord(embed);
  if (ok) console.log(`[Discord] ✅ Equity exit sent: ${signal.symbol} netPnl=₹${netPnl.toFixed(2)}`);
  return ok;
}

/**
 * Send a Discord alert when a partial booking is executed.
 */
export async function sendDiscordEquityPartialBook(result: EquityPartialBook): Promise<boolean> {
  const { signal, bookedQty, remainingQty, bookPrice, rMultiple, netPnl, totalCosts } = result;
  const embed = {
    title: `📒 PARTIAL BOOK: ${signal.symbol} | ${rMultiple} | ${bookedQty} shares`,
    description: `**${signal.stockName}** — Booked ${bookedQty} shares @ ₹${fmt(bookPrice)}\nRemaining: ${remainingQty} shares still open`,
    color: 0x5865F2,
    fields: [
      { name: '📥 Entry', value: `₹${fmt(signal.entryPrice)}`, inline: true },
      { name: '📤 Book Price', value: `₹${fmt(bookPrice)}`, inline: true },
      { name: '📦 Booked Qty', value: `${bookedQty}`, inline: true },
      { name: '💰 Net P&L (booked)', value: fmtPnl(netPnl), inline: true },
      { name: '🏷️ Costs', value: `−₹${fmt(totalCosts)}`, inline: true },
      { name: '📦 Remaining', value: `${remainingQty} shares`, inline: true },
    ],
    footer: { text: 'PARTIAL BOOK | NewSwing PMS v2' },
    timestamp: new Date().toISOString(),
  };
  return postToDiscord(embed);
}

// ── Options Signals (unchanged) ────────────────────────────────

export async function sendDiscordSignal(signal: TradeSignal): Promise<boolean> {
  const emoji = signal.optionType === 'CE' ? '🟢' : '🔴';
  const embed = {
    title: `${emoji} OPTIONS SIGNAL: ${signal.symbol} ${signal.strike} ${signal.optionType}  |  ${signal.direction}`,
    description: `⭐ Setup ${signal.setupType}  |  Expiry: **${signal.expiry}**`,
    color: signal.optionType === 'CE' ? 0x00d4aa : 0xff4444,
    fields: [
      { name: '💰 Entry Premium', value: `₹${fmt(signal.premium)}`, inline: true },
      { name: '📊 Spot Price', value: `₹${fmt(signal.spotPrice)}`, inline: true },
      { name: '🎯 Strike', value: `${signal.strike}`, inline: true },
      { name: '🛑 Stop Loss (−25%)', value: `₹${fmt(signal.stopLoss)}`, inline: true },
      { name: '🎯 Take Profit (+50%)', value: `₹${fmt(signal.takeProfit)}`, inline: true },
      { name: '📦 Lots / Qty', value: `${signal.lots} lots (${signal.lots * signal.lotSize} qty)`, inline: true },
      { name: '💵 Capital', value: `₹${signal.totalCapital.toLocaleString('en-IN')}`, inline: true },
      { name: '⭐ Confidence', value: `${signal.confluenceScore}/10`, inline: true },
      { name: '🔌 Source', value: signal.dataSource, inline: true },
    ],
    footer: { text: '📋 PAPER TRADE SIGNAL — No real order placed | NewSwing PMS v2' },
    timestamp: new Date().toISOString(),
  };
  const ok = await postToDiscord(embed);
  if (ok) console.log(`[Discord] ✅ Options signal sent: ${signal.symbol} ${signal.strike} ${signal.optionType}`);
  return ok;
}

export async function sendDiscordPaperResult(result: PaperTradeResult): Promise<boolean> {
  const { signal, pnl, pnlPct, exitReason, status } = result;
  const emoji = status === 'WIN' ? '✅' : status === 'LOSS' ? '❌' : '⏳';
  const embed = {
    title: `${emoji} OPTIONS RESULT: ${signal.symbol} ${signal.strike} ${signal.optionType}  (${status})`,
    description: `Exit: **${exitReason}**`,
    color: status === 'WIN' ? 0x00d4aa : status === 'LOSS' ? 0xff4444 : 0xffa500,
    fields: [
      { name: '📥 Entry', value: `₹${fmt(signal.premium)}`, inline: true },
      { name: '📤 Exit', value: `₹${fmt(result.exitPremium)}`, inline: true },
      { name: '💰 Net P&L', value: `₹${fmt(pnl)} (${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`, inline: true },
      { name: '⏰ Entry Time', value: signal.timestamp, inline: true },
      { name: '⏰ Exit Time', value: result.exitAt, inline: true },
      { name: '💵 Capital', value: `₹${signal.totalCapital.toLocaleString('en-IN')}`, inline: true },
    ],
    footer: { text: '📋 PAPER TRADE | NewSwing PMS v2' },
    timestamp: new Date().toISOString(),
  };
  return postToDiscord(embed);
}

export async function sendDiscordSystemAlert(msg: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): Promise<boolean> {
  const colors = { INFO: 0x5865F2, WARN: 0xffa500, ERROR: 0xff4444 };
  const emoji = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '🚨' }[level];
  const embed = {
    title: `${emoji} System Alert [${level}]`,
    description: msg,
    color: colors[level],
    footer: { text: 'NewSwing PMS v2' },
    timestamp: new Date().toISOString(),
  };
  return postToDiscord(embed);
}

export interface HealthCheckReport {
  marketHours: boolean;
  timeToCloseMins: number;
  engineStatus: 'ACTIVE' | 'IDLE' | 'HALTED';
  circuitBreaker: boolean;
  circuitBreakerReason?: string;
  niftyRegime: string;
  equity: {
    enabled: boolean;
    openPositions: number;
    maxPositions: number;
    lastScanStatus: string;
    tradeReason: string;
  };
  options: {
    enabled: boolean;
    openPositions: number;
    lastScanStatus: string;
    tradeReason: string;
  };
  wallet: {
    totalCapital: number;
    availableCapital: number;
    deployedCapital: number;
    realizedPnl: number;
    peakCapital: number;
  };
}

export async function sendDiscordHealthCheck(report: HealthCheckReport): Promise<boolean> {
  const statusEmoji = report.circuitBreaker
    ? '🚨 HALTED (Circuit Breaker)'
    : report.marketHours
    ? '🟢 LIVE (Market Open)'
    : '🌙 IDLE (Market Closed)';

  const color = report.circuitBreaker ? 0xff4444 : report.marketHours ? 0x00d4aa : 0x5865F2;

  const embed = {
    title: `🏥 15-MIN SYSTEM HEALTH & TRADING STATUS`,
    description: `**Status**: ${statusEmoji}  |  **Nifty Regime**: **${report.niftyRegime}**\n**Market Status**: ${report.marketHours ? `Open (${report.timeToCloseMins} mins to 3:30 PM close)` : 'Closed'}`,
    color,
    fields: [
      {
        name: '📈 Equity Swing Auto-Trader',
        value: `• **Status**: ${report.equity.enabled ? '🟢 Enabled' : '⏸️ Disabled'}\n• **Open Positions**: ${report.equity.openPositions} / ${report.equity.maxPositions}\n• **Trading Reason**: ${report.equity.tradeReason}`,
        inline: false,
      },
      {
        name: '🎯 Intraday Options Auto-Trader',
        value: `• **Status**: ${report.options.enabled ? '🟢 Enabled (DhanHQ Feed)' : '⏸️ Disabled'}\n• **Open Positions**: ${report.options.openPositions} open\n• **Trading Reason**: ${report.options.tradeReason}`,
        inline: false,
      },
      {
        name: '💰 Capital & Risk Summary',
        value: `• **Available Capital**: ₹${fmt(report.wallet.availableCapital)}\n• **Deployed Capital**: ₹${fmt(report.wallet.deployedCapital)}\n• **Realized P&L**: ${fmtPnl(report.wallet.realizedPnl)}\n• **Peak NAV (HWM)**: ₹${fmt(report.wallet.peakCapital)}`,
        inline: false,
      },
    ],
    footer: { text: 'Automated 15-Min Health & Trading Status | NewSwing PMS' },
    timestamp: new Date().toISOString(),
  };

  return postToDiscord(embed);
}
