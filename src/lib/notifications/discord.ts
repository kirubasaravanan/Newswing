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
// Optional separate webhooks for options vs swing — if set, signals go to
// different Discord channels. Falls back to DISCORD_WEBHOOK_URL if not set.
const DISCORD_OPTIONS_WEBHOOK_URL = process.env.DISCORD_OPTIONS_WEBHOOK_URL || DISCORD_WEBHOOK_URL;
const DISCORD_SWING_WEBHOOK_URL = process.env.DISCORD_SWING_WEBHOOK_URL || DISCORD_WEBHOOK_URL;

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
  confluenceScore: number; // 0-100 scale (options-scanner.ts's sig.confidence) — NOT 0-10, see the "/10" bug fixed 2026-07-27
  setupType: string;
  direction: string;
  engine: 'OPTIONS' | 'SWING';
  dataSource: string;
  timestamp: string;
  /** Cosmetic only — e.g. '⭐ TOP-5 PRIORITY' — never affects trading/sizing. */
  priorityTag?: string;
  // [ADD 2026-07-27] Real per-trade SL/TP percentages (structure-based,
  // convertToPremiumTargets in route.ts) — the message used to hardcode
  // "(-25%)"/"(+50%)" labels from BEFORE that fix shipped, silently showing
  // the wrong number on every single options alert since. Optional so any
  // other caller not yet passing these doesn't break.
  stopLossPct?: number;
  targetPct?: number;
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

// ── Real Discord delivery health tracking ──────────────────────
// Previously the UI (sidebar.tsx) showed a hardcoded "Discord Feed: ACTIVE"
// badge that was never wired to any actual send result — it displayed
// "ACTIVE" even if the webhook was unset, revoked, or being rejected on
// every call. This tracks the real outcome of the most recent send attempt
// so the UI can reflect the truth instead.
let lastDiscordSuccess: boolean | null = null;
let lastDiscordAttemptAt: string | null = null;
let lastDiscordError: string | null = null;

export function getDiscordHealthStatus(): { ok: boolean | null; lastAttemptAt: string | null; lastError: string | null } {
  return { ok: lastDiscordSuccess, lastAttemptAt: lastDiscordAttemptAt, lastError: lastDiscordError };
}

async function postToDiscord(embed: object, channel: 'system' | 'options' | 'swing' = 'system'): Promise<boolean> {
  const url = channel === 'options' ? DISCORD_OPTIONS_WEBHOOK_URL
    : channel === 'swing' ? DISCORD_SWING_WEBHOOK_URL
    // 'system' previously had NO fallback at all — if DISCORD_WEBHOOK_URL was
    // unset but only the per-engine hooks were configured (the "dual broker
    // channel routing" setup), EOD summary / health-check / system alerts
    // failed permanently and silently. Fall back to whichever hook exists.
    : DISCORD_WEBHOOK_URL || DISCORD_SWING_WEBHOOK_URL || DISCORD_OPTIONS_WEBHOOK_URL;

  lastDiscordAttemptAt = new Date().toISOString();

  if (!url) {
    console.warn(`[Discord] Webhook URL not set for channel '${channel}' — notification not sent`);
    lastDiscordSuccess = false;
    lastDiscordError = `No webhook configured for channel '${channel}'`;
    return false;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[Discord] ❌ Webhook ${res.status}: ${body}`);
      lastDiscordSuccess = false;
      lastDiscordError = `HTTP ${res.status}`;
    } else {
      lastDiscordSuccess = true;
      lastDiscordError = null;
    }
    return res.ok;
  } catch (err) {
    console.error('[Discord] Error:', String(err));
    lastDiscordSuccess = false;
    lastDiscordError = String(err).substring(0, 200);
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

  const ok = await postToDiscord(embed, 'swing');
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

  const ok = await postToDiscord(embed, 'swing');
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
  return postToDiscord(embed, 'swing');
}

// ── Options Signals (unchanged) ────────────────────────────────

export async function sendDiscordSignal(signal: TradeSignal): Promise<boolean> {
  const emoji = signal.optionType === 'CE' ? '🟢' : '🔴';
  const embed = {
    title: `${emoji} OPTIONS SIGNAL: ${signal.symbol} ${signal.strike} ${signal.optionType}  |  ${signal.direction}${signal.priorityTag ? `  [${signal.priorityTag}]` : ''}`,
    description: `⭐ Setup ${signal.setupType}  |  Expiry: **${signal.expiry}**`,
    color: signal.optionType === 'CE' ? 0x00d4aa : 0xff4444,
    fields: [
      { name: '💰 Entry Premium', value: `₹${fmt(signal.premium)}`, inline: true },
      { name: '📊 Spot Price', value: `₹${fmt(signal.spotPrice)}`, inline: true },
      { name: '🎯 Strike', value: `${signal.strike}`, inline: true },
      { name: `🛑 Stop Loss${signal.stopLossPct !== undefined ? ` (${signal.stopLossPct.toFixed(0)}%)` : ''}`, value: `₹${fmt(signal.stopLoss)}`, inline: true },
      { name: `🎯 Take Profit${signal.targetPct !== undefined ? ` (+${signal.targetPct.toFixed(0)}%)` : ''}`, value: `₹${fmt(signal.takeProfit)}`, inline: true },
      { name: '📦 Lots / Qty', value: `${signal.lots} lots (${signal.lots * signal.lotSize} qty)`, inline: true },
      { name: '💵 Capital', value: `₹${signal.totalCapital.toLocaleString('en-IN')}`, inline: true },
      { name: '⭐ Confidence', value: `${Math.round(signal.confluenceScore)}%`, inline: true },
      { name: '🔌 Source', value: signal.dataSource, inline: true },
    ],
    footer: { text: '📋 PAPER TRADE SIGNAL — No real order placed | NewSwing PMS v2' },
    timestamp: new Date().toISOString(),
  };
  const ok = await postToDiscord(embed, 'options');
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
  return postToDiscord(embed, 'options');
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

// ── Scrip Master CSV Scheduled Update Alert ───────────────────
export async function sendDiscordScripMasterUpdate(contractCount: number, updateTime: string): Promise<boolean> {
  const embed = {
    title: `📥 DHANHQ SCRIP MASTER UPDATED`,
    description: `**Status**: ✅ Scrip Master CSV Successfully Downloaded & Cached\n**Total Option Contracts Loaded**: \`${contractCount.toLocaleString('en-IN')}\` contracts`,
    color: 0x00d4aa,
    fields: [
      { name: '⏰ Update Timestamp', value: updateTime, inline: true },
      { name: '📡 Exchange Segments', value: 'NSE_FNO, BSE_FNO', inline: true },
      { name: '🔒 Security Feed Status', value: '100% Real Broker Tickers Synced', inline: true },
    ],
    footer: { text: 'Scheduled Scrip Master Update | DhanHQ Broker v2 API | NewSwing PMS' },
    timestamp: new Date().toISOString(),
  };
  return postToDiscord(embed);
}

// ── Consolidated Daily EOD Performance Report ──────────────────
export interface EODSummaryReport {
  date: string;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  winRate: number;
  grossPnl: number;
  statutoryCosts: number;
  netPnl: number;
  netPnlPct: number;
  capitalDeployed: number;
  winningTradesList: string[];
  losingTradesList: string[];
  // Added for forward-test visibility (signals received, live concurrency,
  // profit factor, capital sizing) — see route.ts's dispatchEODSummary.
  optionsSignalsToday: number;   // real options signals generated today (not just ones that became trades)
  // Real PEAK concurrency for today, from a sweep of actual entry/exit
  // timestamps — NOT a point-in-time snapshot (which would be misleading for
  // options specifically, since they're force-closed by the 3:15pm
  // square-off well before this report is built).
  peakConcurrentOptions: number;
  peakConcurrentEquity: number;
  profitFactor: number;          // today's closed trades: gross win / gross loss
  avgCapitalPerTrade: number;    // real avg capital committed per currently-open trade
  estCapitalForConcurrency: number; // avgCapitalPerTrade x current open count — what it actually takes to run today's concurrency
  // Options shadow forward-test — cumulative (across all days so far) IST
  // time-of-day win-rate/PnL buckets, best 3 and worst 3 by netPnl. Only
  // included once at least a few slots have real sample size.
  shadowBestSlots?: Array<{ slot: string; count: number; winRate: number; netPnl: number; topSymbols: string[] }>;
  shadowWorstSlots?: Array<{ slot: string; count: number; winRate: number; netPnl: number; topSymbols: string[] }>;
}

export async function sendDiscordEODSummary(summary: EODSummaryReport): Promise<boolean> {
  const isProfitable = summary.netPnl >= 0;
  const emoji = isProfitable ? '🏆' : '📊';
  const color = isProfitable ? 0x00d4aa : 0xff4444;

  const winningText = summary.winningTradesList.length > 0
    ? summary.winningTradesList.slice(0, 8).join('\n')
    : 'No winning trades today';
  const losingText = summary.losingTradesList.length > 0
    ? summary.losingTradesList.slice(0, 8).join('\n')
    : 'No losing trades today';

  const embed = {
    title: `${emoji} CONSOLIDATED EOD TRADING PERFORMANCE REPORT — ${summary.date}`,
    description: `**Net Session Return**: **${summary.netPnl >= 0 ? '+' : ''}₹${fmt(summary.netPnl)} (${summary.netPnlPct >= 0 ? '+' : ''}${summary.netPnlPct.toFixed(2)}%)**`,
    color,
    fields: [
      { name: '📊 Total Trades', value: `${summary.totalTrades} Trades`, inline: true },
      { name: '✅ Win Rate', value: `${summary.winRate.toFixed(1)}% (${summary.winTrades}W / ${summary.lossTrades}L)`, inline: true },
      { name: '📈 Profit Factor', value: summary.profitFactor > 0 ? `${summary.profitFactor.toFixed(2)}x` : 'N/A', inline: true },
      { name: '📞 Options Signals Today', value: `${summary.optionsSignalsToday}`, inline: true },
      { name: '🟢 Peak Concurrent Positions Today', value: `${summary.peakConcurrentOptions} options / ${summary.peakConcurrentEquity} equity`, inline: true },
      { name: '💵 Deployed Capital', value: `₹${fmt(summary.capitalDeployed)}`, inline: true },
      { name: '💰 Gross P&L', value: fmtPnl(summary.grossPnl), inline: true },
      { name: '🏷️ Statutory Taxes & Fees', value: `−₹${fmt(summary.statutoryCosts)}`, inline: true },
      { name: '🏆 Net P&L (after all costs)', value: `**${fmtPnl(summary.netPnl)}**`, inline: true },
      { name: '💼 Avg Capital / Open Trade', value: `₹${fmt(summary.avgCapitalPerTrade)}`, inline: true },
      { name: '🏦 Capital Needed for Today\'s Concurrency', value: `₹${fmt(summary.estCapitalForConcurrency)}`, inline: true },
      { name: '🟢 Winning Trades', value: `\`\`\`\n${winningText}\n\`\`\``, inline: false },
      { name: '🔴 Losing Trades & SL Exits', value: `\`\`\`\n${losingText}\n\`\`\``, inline: false },
      ...(summary.shadowBestSlots && summary.shadowBestSlots.length ? [{
        name: '⏱️ Best time-of-day slots (options shadow, cumulative)',
        value: summary.shadowBestSlots.map(s => `• ${s.slot} IST — ${s.count} trades, ${s.winRate}% WR, net ₹${fmt(s.netPnl)} (${s.topSymbols.join(', ')})`).join('\n'),
        inline: false,
      }] : []),
      ...(summary.shadowWorstSlots && summary.shadowWorstSlots.length ? [{
        name: '⏱️ Worst time-of-day slots (options shadow, cumulative)',
        value: summary.shadowWorstSlots.map(s => `• ${s.slot} IST — ${s.count} trades, ${s.winRate}% WR, net ₹${fmt(s.netPnl)} (${s.topSymbols.join(', ')})`).join('\n'),
        inline: false,
      }] : []),
    ],
    footer: { text: 'Consolidated Market Close EOD Summary | NewSwing PMS Engine' },
    timestamp: new Date().toISOString(),
  };

  return postToDiscord(embed);
}

// ── Lightweight Hourly Market Hours Heartbeat Alert ─────────────────────
export interface SwingStockStatus {
  symbol: string;
  name: string;
  rank: number;
  weightPct: number;
  currentPrice: number;
  aligned: boolean;
  missing: string[];
  openPosition?: { entryPrice: number; qty: number; pnl: number; pnlPct: number };
}

export interface HeartbeatPayload {
  timeIST: string;
  niftyRegime: string;
  openPositions: number;
  unrealizedPnl: number;
  realizedPnl: number;
  nextSquareOffTime: string;
  swingStocks?: SwingStockStatus[];
  // [ADD 2026-07-27] Merged in from the old separate 15-min health check,
  // which was firing 4x as often as this heartbeat for heavily overlapping
  // information (open positions, regime, general status). One consolidated
  // hourly update instead of two competing periodic pings — see route.ts's
  // dispatchHourlyHeartbeat and the removed automatic health-check dispatch.
  circuitBreaker?: boolean;
  circuitBreakerReason?: string;
  optionsOpenPositions?: number;
  equityTradeReason?: string;
  optionsTradeReason?: string;
  availableCapital?: number;
  deployedCapital?: number;
  peakCapital?: number;
  // [ADD 2026-07-28] Was just a bare count ("Options Open: 1") with no way
  // to tell what it actually was or how it's doing — user flagged this
  // directly. Real per-position detail, same pattern as swingStocks above.
  optionsPositionsDetail?: Array<{ symbol: string; strike: number; direction: string; entryPrice: number; currentPremium: number | null; pnl: number | null }>;
}

export async function sendDiscordHeartbeat(payload: HeartbeatPayload): Promise<boolean> {
  const pnlSign = payload.unrealizedPnl >= 0 ? '+' : '';
  const pnlFormatted = `${pnlSign}₹${Math.round(payload.unrealizedPnl).toLocaleString('en-IN')}`;
  const isPos = payload.unrealizedPnl >= 0;

  // Build swing stocks field — shows the 7 ranked stocks with alignment status
  const swingFields: any[] = [];
  if (payload.swingStocks && payload.swingStocks.length > 0) {
    const alignedStocks = payload.swingStocks.filter(s => s.aligned);
    const waitingStocks = payload.swingStocks.filter(s => !s.aligned);

    // Aligned stocks (ready to buy trigger)
    if (alignedStocks.length > 0) {
      const lines = alignedStocks.map(s => {
        const base = `#${s.rank} ${s.symbol} @ ₹${s.currentPrice} (${Math.round(s.weightPct * 100)}%)`;
        if (s.openPosition) {
          const pnlStr = s.openPosition.pnl >= 0 ? `+₹${Math.round(s.openPosition.pnl).toLocaleString('en-IN')}` : `₹${Math.round(s.openPosition.pnl).toLocaleString('en-IN')}`;
          return `✅ ${base} | HELD @ ₹${s.openPosition.entryPrice} → ${pnlStr} (${s.openPosition.pnlPct > 0 ? '+' : ''}${s.openPosition.pnlPct}%)`;
        }
        return `✅ ${base} | 🎯 ALIGNED — buy trigger active`;
      });
      swingFields.push({ name: `🎯 Aligned & Ready (${alignedStocks.length}/7)`, value: lines.join('\n'), inline: false });
    }

    // Waiting stocks (not yet aligned — show what's missing)
    if (waitingStocks.length > 0) {
      const lines = waitingStocks.map(s => {
        const base = `#${s.rank} ${s.symbol} @ ₹${s.currentPrice}`;
        if (s.openPosition) {
          const pnlStr = s.openPosition.pnl >= 0 ? `+₹${Math.round(s.openPosition.pnl).toLocaleString('en-IN')}` : `₹${Math.round(s.openPosition.pnl).toLocaleString('en-IN')}`;
          return `📊 ${base} | HELD @ ₹${s.openPosition.entryPrice} → ${pnlStr} (${s.openPosition.pnlPct > 0 ? '+' : ''}${s.openPosition.pnlPct}%)`;
        }
        return `⏳ ${base} | Waiting: ${s.missing.join(', ').substring(0, 60)}`;
      });
      swingFields.push({ name: `⏳ Yet to Align (${waitingStocks.length}/7)`, value: lines.join('\n'), inline: false });
    }
  }

  const statusLine = payload.circuitBreaker
    ? `🚨 **HALTED** (${payload.circuitBreakerReason || 'circuit breaker active'})`
    : `🟢 OPEN (${payload.niftyRegime})`;

  const fields: any[] = [];
  // Capital + options summary — only shown when the caller actually supplied
  // it (keeps this payload usable for a lighter-weight call too, without
  // forcing every caller to fetch wallet/options status).
  if (payload.availableCapital !== undefined || payload.optionsOpenPositions !== undefined) {
    const lines: string[] = [];
    if (payload.optionsOpenPositions !== undefined) lines.push(`• **Options Open**: ${payload.optionsOpenPositions}`);
    if (payload.optionsPositionsDetail && payload.optionsPositionsDetail.length > 0) {
      for (const p of payload.optionsPositionsDetail) {
        const pnlStr = p.pnl == null ? '(live price unavailable)' : `${p.pnl >= 0 ? '+' : ''}₹${Math.round(p.pnl).toLocaleString('en-IN')}`;
        const premStr = p.currentPremium == null ? '?' : `₹${p.currentPremium}`;
        lines.push(`   ↳ ${p.symbol} ${p.strike} ${p.direction} @ ₹${p.entryPrice} → ${premStr} — ${pnlStr}`);
      }
    }
    if (payload.availableCapital !== undefined) lines.push(`• **Available**: ₹${Math.round(payload.availableCapital).toLocaleString('en-IN')}`);
    if (payload.deployedCapital !== undefined) lines.push(`• **Deployed**: ₹${Math.round(payload.deployedCapital).toLocaleString('en-IN')}`);
    if (payload.peakCapital !== undefined) lines.push(`• **Peak NAV**: ₹${Math.round(payload.peakCapital).toLocaleString('en-IN')}`);
    if (lines.length) fields.push({ name: '💰 Capital & Options', value: lines.join('\n'), inline: false });
  }
  // Only surface WHY nothing is trading when there's actually a reason worth
  // flagging (blocked/halted) — a routine "scanning, nothing met the bar yet"
  // reason on every single hourly ping is the kind of noise this merge was
  // meant to cut, not add back under a different field name.
  const noteworthy = (r?: string) => r && /BLOCKED|HALTED|🛑|🚨/.test(r);
  if (noteworthy(payload.equityTradeReason) || noteworthy(payload.optionsTradeReason)) {
    const lines: string[] = [];
    if (noteworthy(payload.equityTradeReason)) lines.push(`Equity: ${payload.equityTradeReason}`);
    if (noteworthy(payload.optionsTradeReason)) lines.push(`Options: ${payload.optionsTradeReason}`);
    fields.push({ name: '⚠️ Why nothing new is trading', value: lines.join('\n'), inline: false });
  }
  fields.push(...swingFields);

  const embed: any = {
    title: `💓 PMS Hourly Status [${payload.timeIST}]`,
    description: `• **Market**: ${statusLine}\n• **Open Positions**: ${payload.openPositions}\n• **Unrealized PnL**: **${pnlFormatted}**\n• **3:10 PM Square-Off**: Armed (${payload.nextSquareOffTime})`,
    color: payload.circuitBreaker ? 0xff4444 : isPos ? 0x00d4aa : 0xffa500,
    fields,
    footer: { text: 'NewSwing PMS Autonomous Engine | Hourly Status (merged health check, 2026-07-27)' },
    timestamp: new Date().toISOString(),
  };

  return postToDiscord(embed, 'swing');
}

// ── Hourly Postmortem Scan ───────────────────────────────────────────────
// Read-only reporting only — no trading-behavior change. Sent to the
// asset-class's own channel (options → 'options', equity → 'swing') so it
// never gets mixed with the other engine's findings, same separation the
// user asked for.
export interface PostmortemScanPayload {
  assetClass: 'equity' | 'options';
  lookbackDays: number;
  totalChecked: number;
  exitedEarlyCount: number;
  exitedEarlyPct: number;
  byExitReason: Record<string, { count: number; exitedEarly: number; justified: number; wash: number }>;
  worstExitReason: { reason: string; rate: number; count: number; exitedEarly: number } | null;
}

export async function sendDiscordPostmortemSummary(payload: PostmortemScanPayload): Promise<boolean> {
  const color = payload.exitedEarlyPct >= 50 ? 0xef4444 : payload.exitedEarlyPct >= 25 ? 0xf59e0b : 0x10b981;
  const label = payload.assetClass === 'options' ? 'Options' : 'Equity Swing';

  const fields: any[] = [
    { name: `Trades checked (${payload.lookbackDays}d)`, value: String(payload.totalChecked), inline: true },
    { name: 'Exited early', value: `${payload.exitedEarlyCount}/${payload.totalChecked} (${payload.exitedEarlyPct}%)`, inline: true },
  ];
  if (payload.worstExitReason) {
    fields.push({
      name: '⚠️ Worst exit reason',
      value: `\`${payload.worstExitReason.reason}\` — ${payload.worstExitReason.exitedEarly}/${payload.worstExitReason.count} (${payload.worstExitReason.rate}%) exited early`,
      inline: false,
    });
  }
  const reasonLines = Object.entries(payload.byExitReason)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([reason, b]) => `• \`${reason}\`: ${b.count} closed — ${b.exitedEarly} early, ${b.justified} justified, ${b.wash} wash`);
  if (reasonLines.length) fields.push({ name: 'By exit reason', value: reasonLines.join('\n').slice(0, 1000), inline: false });

  const embed = {
    title: `🔬 Hourly Postmortem Scan (${label})`,
    description: 'Real post-exit price movement vs. each trade\'s actual exit reason.',
    color,
    fields,
    timestamp: new Date().toISOString(),
  };

  return postToDiscord(embed, payload.assetClass === 'options' ? 'options' : 'swing');
}

// ── Options Shadow Forward-Test Hourly Report ───────────────────────────
// Full-universe shadow signals (no real capital) — see shadow-options.ts.
// Purpose: real forward evidence on trade frequency, concurrency, and PnL
// across the WHOLE options universe, to judge whether the current TOP-10
// concurrency cap (3) needs redesigning, not just the current TOP-10 gate.
export interface ShadowOptionsReportPayload {
  timeIST: string;
  openCount: number;
  capitalDeployed: number;
  closedTodayCount: number;
  closedTodayWinRate: number;
  closedTodayNetPnl: number;
  capitalRequiredToday: number;
  cumulativeClosedCount: number;
  cumulativeWinRate: number;
  cumulativeNetPnl: number;
  byExitReason: Array<{ reason: string; count: number; winRate: number; netPnl: number }>;
  // Full per-contract detail — what actually closed since the last report,
  // and what's currently open right now (not just aggregate counts).
  closedSinceLastReport: Array<{
    symbol: string; direction: string; strike: number; expiry: string; inTop10: boolean;
    entryPremium: number; exitPremium: number | null; exitReason: string | null;
    openedAtIST: string; closedAtIST: string; pnlPercent: number | null; netPnl: number | null;
  }>;
  currentlyOpen: Array<{
    symbol: string; direction: string; strike: number; expiry: string; inTop10: boolean;
    entryPremium: number; openedAtIST: string;
  }>;
}

export async function sendDiscordShadowOptionsReport(payload: ShadowOptionsReportPayload): Promise<boolean> {
  const color = payload.cumulativeNetPnl > 0 ? 0x10b981 : payload.cumulativeNetPnl < 0 ? 0xef4444 : 0xf59e0b;
  const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

  const fields: any[] = [
    {
      name: '📊 Concurrent (uncapped)',
      value: `${payload.openCount} open — capital deployed ${fmt(payload.capitalDeployed)}\n(real cap is 3 concurrent TOP-10 positions)`,
      inline: false,
    },
    {
      name: '📅 Today',
      value: `Closed: ${payload.closedTodayCount} — WinRate ${payload.closedTodayWinRate}% — Net ${fmt(payload.closedTodayNetPnl)}\nCapital required to rotate today's signals: ${fmt(payload.capitalRequiredToday)}`,
      inline: false,
    },
    {
      name: '📈 Cumulative (since shadow-test start)',
      value: `Closed: ${payload.cumulativeClosedCount} — WinRate ${payload.cumulativeWinRate}% — Net ${fmt(payload.cumulativeNetPnl)}`,
      inline: false,
    },
  ];

  if (payload.byExitReason.length) {
    const lines = payload.byExitReason
      .map(b => `• \`${b.reason}\`: ${b.count} — WinRate ${b.winRate}% — Net ${fmt(b.netPnl)}`)
      .join('\n')
      .slice(0, 1000);
    fields.push({ name: 'By exit reason (cumulative)', value: lines, inline: false });
  }

  if (payload.closedSinceLastReport.length) {
    const rows = payload.closedSinceLastReport
      .slice(0, 15)
      .map(r => `• ${r.symbol} ${r.direction} ${r.strike} (${r.expiry})${r.inTop10 ? ' [TOP10]' : ''} — ${r.openedAtIST}→${r.closedAtIST} — ₹${r.entryPremium}→₹${r.exitPremium ?? '?'} \`${r.exitReason}\` — ${r.pnlPercent != null ? r.pnlPercent + '%' : '?'}, net ${r.netPnl != null ? fmt(r.netPnl) : '?'}`);
    const extra = payload.closedSinceLastReport.length > 15 ? `\n…+${payload.closedSinceLastReport.length - 15} more` : '';
    fields.push({ name: `📋 Closed since last report (${payload.closedSinceLastReport.length})`, value: (rows.join('\n') + extra).slice(0, 1000), inline: false });
  }

  if (payload.currentlyOpen.length) {
    const rows = payload.currentlyOpen
      .slice(0, 15)
      .map(r => `• ${r.symbol} ${r.direction} ${r.strike} (${r.expiry})${r.inTop10 ? ' [TOP10]' : ''} — opened ${r.openedAtIST} @ ₹${r.entryPremium}`);
    const extra = payload.currentlyOpen.length > 15 ? `\n…+${payload.currentlyOpen.length - 15} more` : '';
    fields.push({ name: `📂 Currently open (${payload.currentlyOpen.length})`, value: (rows.join('\n') + extra).slice(0, 1000), inline: false });
  }

  const embed = {
    title: `🧪 Options Shadow Forward-Test [${payload.timeIST}]`,
    description: 'Full-universe signals (whitelisted or not), simulated SL/TP, no real capital. Tracking whether the current TOP-10/cap=3 design is leaving money on the table or is about right.',
    color,
    fields,
    timestamp: new Date().toISOString(),
  };

  return postToDiscord(embed, 'options');
}

// ── Weekly Monday 8:30 AM Rebalance Cycle Alert ─────────────────────────
export interface WeeklyRebalancePayload {
  rebalanceTime: string;
  top7Symbols: string[];
  vacantSlotsFilled: string[];
}

export async function sendDiscordWeeklyRebalanceNotice(payload: WeeklyRebalancePayload): Promise<boolean> {
  const embed = {
    title: `🔄 WEEKLY WATCHLIST REBALANCE EXECUTED [${payload.rebalanceTime}]`,
    description: `**Schedule**: Every Monday at 8:30 AM IST\n**Nifty 500 Relative Strength Scan Completed**`,
    color: 0x6366f1,
    fields: [
      { name: '🏆 Top 7 Leaders', value: payload.top7Symbols.join(', '), inline: false },
      { name: '📥 Open Slots Filled', value: payload.vacantSlotsFilled.join(', '), inline: false },
    ],
    footer: { text: 'Nifty 500 RS 7-Day Cycle | NewSwing PMS' },
    timestamp: new Date().toISOString(),
  };

  return postToDiscord(embed, 'swing');
}
