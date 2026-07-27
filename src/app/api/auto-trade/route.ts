/**
 * PMS Auto-Trade Engine v3 — Real Data End-to-End
 *
 * v3 Enhancements over v2:
 * 1. Discord real-time signals — every entry/exit/partial posted to Discord before DB write
 * 2. Transaction cost engine — gross P&L, net P&L, STT, brokerage, slippage all tracked
 * 3. Persistent peak capital — peakCapital stored in DB for accurate HWM drawdown
 * 4. Net P&L credited to wallet — costs are real charges deducted from capital
 * 5. minRR restored to 1.5 — mathematically correct for positive expectancy
 *
 * v2 Enhancements:
 * 1. Drawdown circuit breaker — pauses new entries if drawdown exceeds threshold
 * 2. Adaptive position sizing — reduces size after consecutive losses
 * 3. Nifty regime filter — only longs when Nifty > EMA200 (bullish regime)
 * 4. ATR-based trailing stop — uses volatility-adjusted trail instead of fixed R
 * 5. Daily loss limit — halts all new entries if daily loss exceeds threshold
 * 6. Consecutive loss streak tracking — tighter risk after 3+ losses in a row
 * 7. Max open drawdown check before new entry
 * 8. Position health scoring (0-100) for priority-based exit management
 * 9. Stale position acceleration — exits aging losers faster
 */
import { NextRequest, NextResponse } from 'next/server';
import { runScreening, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData, getCurrentPrice, getContractCurrentPrice } from '@/lib/trading/data-provider';
import { getFullUniverse, runL1Filter, type NSEStock } from '@/lib/trading/universe-scanner';
import { isNseTradingHoliday } from '@/lib/trading/market-hours';
import { scanOptionsUniverse, type OptionsSignal, SNIPER_MIN_SCORE, SNIPER_MIN_CONFIDENCE, INDEX_SYMBOLS } from '@/lib/trading/options-scanner';
import { convertToPremiumTargets } from '@/lib/trading/market-structure';
import { recordSignal, resolveSignalByTradeId, getSymbolReputationAdjustment } from '@/lib/trading/signal-recorder';
import { checkIndiaEventBlackout } from '@/lib/trading/india-event-calendar';
import { getInstitutionalFlowBias } from '@/lib/trading/institutional-flow';
import { fetchDhanOptionChain } from '@/lib/options/dhan-option-provider';
import { recordIV, getIVPercentile, getIVSpikePct } from '@/lib/options/iv-percentile';
import { updateOCConfluence } from '@/lib/options/oc-confluence';
import { getSmoothedScore } from '@/lib/options/score-stabilizer';
import { EMA, ATR } from 'technicalindicators';
import { db } from '@/lib/db';
import {
  calculateEquityCosts,
  calculateOptionsCosts,
  getSlippageAdjustedEntry,
  getSlippageAdjustedExit,
  type CostBreakdown,
} from '@/lib/trading/transaction-costs';
import {
  sendDiscordSignal,
  sendDiscordEquitySignal,
  sendDiscordEquityExit,
  sendDiscordEquityPartialBook,
  sendDiscordSystemAlert,
  type EquityTradeSignal,
} from '@/lib/notifications/discord';


// ── Types ──────────────────────────────────────────────
interface PositionRules {
  maxPerStock: number;
  maxBuysPerMonth: number;
  maxHoldingDays: number;
  maxTotalPositions: number;
  riskPerTradePct: number;
  trailingStopR: number;
  trailToR: number;
  partialBookR: number;
  partialBookPct: number;
  cooldownDays: number;
  maxSectorPct: number;
  timeExitMins: number;
  // v2 additions
  maxDrawdownPct: number;          // Halt entries if portfolio drawdown exceeds this %
  dailyLossLimit: number;          // Halt entries if daily realized loss exceeds this ₹
  niftyRegimeFilter: boolean;      // Only take longs when Nifty > EMA200
  atrTrailMultiplier: number;      // ATR multiplier for trailing stop (0 = use fixed R)
  adaptiveSizing: boolean;         // Reduce size after consecutive losses
  streakPenaltyPct: number;        // % size reduction per consecutive loss after 3
  // Options guardrails engine
  // [FIX] Were flat rupee amounts (₹20,000 / ₹40,000) picked when options
  // capital was ~₹3L (6.67%/13.33% of that). Capital has since moved (₹10L
  // live as of 2026-07-27) without these being touched, silently shrinking
  // the real protection to ~2%/4% of current capital — or the reverse on a
  // smaller account, where a flat ₹20K could be a much harsher % than
  // intended. Now a % of CURRENT capital, computed fresh at check time.
  optDailyLossCapPct: number;      // Halt new options entries once today's realized options loss hits this % of current capital
  optDailyProfitLockPct: number;   // Halt new options entries once today's realized options profit hits this % of current capital ("quit while ahead")
  optMaxPerSector: number;         // Max concurrent open options positions sharing the same sector
  optNoEntryMinsToClose: number;   // Don't open NEW options positions within this many minutes of the 3:15pm square-off
  optMaxIndexPositions: number;    // Max concurrent open options positions across ALL indices combined (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY move together on the same market-wide beta)
}

const DEFAULT_RULES: PositionRules = {
  maxPerStock: 75000,              // 25% max allocation of ₹3.0L capital
  maxBuysPerMonth: 3, 
  maxHoldingDays: 30,
  maxTotalPositions: 7,            // Top 7 Stock Leaders
  riskPerTradePct: 1.0,
  trailingStopR: 1.5, 
  trailToR: 0.5, 
  partialBookR: 2.0, 
  partialBookPct: 30,
  cooldownDays: 1, 
  maxSectorPct: 35, 
  timeExitMins: 30,
  // Dual-Broker Risk Controls
  maxDrawdownPct: 8,               // 8% max drawdown circuit breaker
  dailyLossLimit: 15000,           // ₹15,000 daily loss limit (5% of ₹3.0L)
  niftyRegimeFilter: true,         // Enable Nifty EMA200 filter
  atrTrailMultiplier: 2.0,         // 2x ATR trailing stop
  adaptiveSizing: true,            // Enable adaptive sizing
  streakPenaltyPct: 20,            // 20% size reduction per loss after 3 consecutive
  // Options guardrails — no equivalent existed before; the options engine only
  // had a flat entry-count cap (OPT_DAILY_LIMIT), with no P&L-based circuit
  // breaker at all (opt_todayPnl was read in status but never actually written).
  optDailyLossCapPct: 6.67,        // was flat ₹20,000 (~6.7% of the ₹3L capital it was set against) — now a real % of current capital
  optDailyProfitLockPct: 13.33,    // was flat ₹40,000 (~13.3% of ₹3L) — roughly one strong day's worth of wins, now scaled the same way
  optMaxPerSector: 2,              // avoid 3+ correlated single-sector bets blowing up together
  optNoEntryMinsToClose: 45,       // no fresh entries after ~2:45pm — no room to develop before 3:15pm square-off
  optMaxIndexPositions: 2,         // mirrors optMaxPerSector's logic — the 4 indices are one correlated basket, not 4 independent bets
};

interface SchedulerState {
  enabled: boolean;
  scanIntervalMin: number;
  exitIntervalMin: number;
  lastScanAt: string | null;
  lastExitAt: string | null;
  nextScanAt: string | null;
  nextExitAt: string | null;
  todayEntries: number;
  todayExits: number;
  todayPnl: number;
  scanCount: number;
  // v2 state
  circuitBreaker: boolean;         // True = halted due to drawdown/daily loss
  circuitBreakerReason: string;    // Why the breaker is active
  niftyRegime: 'BULLISH' | 'BEARISH' | 'UNKNOWN';
  consecutiveLosses: number;
  lastAdaptiveFactor: number;      // Current position size multiplier (0.0-1.0)
}

const DEFAULT_SCHEDULER: SchedulerState = {
  enabled: false, scanIntervalMin: 15, exitIntervalMin: 1, // 1-minute high speed exit monitor
  lastScanAt: null, lastExitAt: null, nextScanAt: null, nextExitAt: null,
  todayEntries: 0, todayExits: 0, todayPnl: 0, scanCount: 0,
  circuitBreaker: false, circuitBreakerReason: '',
  niftyRegime: 'UNKNOWN', consecutiveLosses: 0, lastAdaptiveFactor: 1.0,
};

// ── Position Health Score (0-100) ───────────────────────
interface HealthScore {
  score: number;
  factors: { name: string; impact: number; detail: string }[];
  urgency: 'CRITICAL' | 'WARNING' | 'OK';
}

function scorePositionHealth(
  cp: number, entryPrice: number, sl: number, tp: number,
  holdingDays: number, maxHoldingDays: number, rMultiple: number
): HealthScore {
  const factors: { name: string; impact: number; detail: string }[] = [];
  let score = 50; // Base score

  // Factor 1: R-multiple profit (±25 points)
  if (rMultiple >= 2) { score += 25; factors.push({ name: 'Profit', impact: 25, detail: `Strong ${rMultiple.toFixed(1)}R` }); }
  else if (rMultiple >= 1) { score += 15; factors.push({ name: 'Profit', impact: 15, detail: `Moderate ${rMultiple.toFixed(1)}R` }); }
  else if (rMultiple >= 0) { score += 5; factors.push({ name: 'Profit', impact: 5, detail: `Marginal ${rMultiple.toFixed(1)}R` }); }
  else if (rMultiple >= -0.5) { score -= 10; factors.push({ name: 'Loss', impact: -10, detail: `Small loss ${rMultiple.toFixed(1)}R` }); }
  else { score -= 25; factors.push({ name: 'Loss', impact: -25, detail: `Large loss ${rMultiple.toFixed(1)}R` }); }

  // Factor 2: SL proximity (±20 points)
  const risk = entryPrice - sl;
  const slDistPct = risk > 0 ? ((cp - sl) / risk) * 100 : 100;
  if (slDistPct < 20) { score -= 20; factors.push({ name: 'SL Proximity', impact: -20, detail: `${slDistPct.toFixed(0)}% to SL` }); }
  else if (slDistPct < 40) { score -= 10; factors.push({ name: 'SL Proximity', impact: -10, detail: `${slDistPct.toFixed(0)}% to SL` }); }
  else { score += 5; factors.push({ name: 'SL Distance', impact: 5, detail: `Safe at ${slDistPct.toFixed(0)}%` }); }

  // Factor 3: Age penalty (±15 points)
  const agePct = maxHoldingDays > 0 ? holdingDays / maxHoldingDays : 0;
  if (agePct >= 0.9) { score -= 15; factors.push({ name: 'Age', impact: -15, detail: `${holdingDays}/${maxHoldingDays}d (expired)` }); }
  else if (agePct >= 0.7) { score -= 8; factors.push({ name: 'Age', impact: -8, detail: `${holdingDays}/${maxHoldingDays}d (aging)` }); }
  else if (agePct < 0.3) { score += 5; factors.push({ name: 'Age', impact: 5, detail: `Fresh ${holdingDays}d` }); }

  // Factor 4: Trend to TP (±10 points)
  if (tp > entryPrice && cp > entryPrice) {
    const tpProgress = ((cp - entryPrice) / (tp - entryPrice)) * 100;
    if (tpProgress > 75) { score += 10; factors.push({ name: 'TP Progress', impact: 10, detail: `${tpProgress.toFixed(0)}% to TP` }); }
    else if (tpProgress > 40) { score += 5; factors.push({ name: 'TP Progress', impact: 5, detail: `${tpProgress.toFixed(0)}% to TP` }); }
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  let urgency: HealthScore['urgency'] = 'OK';
  if (score < 30) urgency = 'CRITICAL';
  else if (score < 55) urgency = 'WARNING';

  return { score, factors, urgency };
}

// ── Helpers ────────────────────────────────────────────
function isMarketHours(): boolean {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false;
  // NSE trading holidays (Republic Day, Diwali, etc.) — previously only
  // weekends were excluded, so the scheduler would scan/attempt to trade on
  // holidays when no real market data is actually updating.
  if (isNseTradingHoliday(now)) return false;
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930;
}

// Weekend/holiday check WITHOUT the intraday time restriction — used to gate
// dispatchers (health check, EOD summary) that are deliberately allowed to
// fire outside the strict 9:15-3:30 window on a real trading day, but must
// still never fire on a non-trading day. isMarketHours() above can't be
// reused directly for this since it also enforces the time-of-day window.
function isNonTradingDay(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
  const day = ist.getDay();
  if (day === 0 || day === 6) return true;
  return isNseTradingHoliday(now);
}


function timeToClose(): number {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;
  return Math.max(0, 930 - mins);
}

async function getRules(): Promise<PositionRules> {
  try {
    const s = await db.appSettings.findMany();
    const m: Record<string, string> = {};
    for (const x of s) m[x.key] = x.value;
    return {
      maxPerStock: parseFloat(m['rules_maxPerStock'] || '') || DEFAULT_RULES.maxPerStock,
      maxBuysPerMonth: parseInt(m['rules_maxBuysPerMonth'] || '') || DEFAULT_RULES.maxBuysPerMonth,
      maxHoldingDays: parseInt(m['rules_maxHoldingDays'] || '') || DEFAULT_RULES.maxHoldingDays,
      maxTotalPositions: parseInt(m['rules_maxTotalPositions'] || '') || DEFAULT_RULES.maxTotalPositions,
      riskPerTradePct: parseFloat(m['rules_riskPerTradePct'] || '') || DEFAULT_RULES.riskPerTradePct,
      trailingStopR: parseFloat(m['rules_trailingStopR'] || '') || DEFAULT_RULES.trailingStopR,
      trailToR: parseFloat(m['rules_trailToR'] || '') || DEFAULT_RULES.trailToR,
      partialBookR: parseFloat(m['rules_partialBookR'] || '') || DEFAULT_RULES.partialBookR,
      partialBookPct: parseFloat(m['rules_partialBookPct'] || '') || DEFAULT_RULES.partialBookPct,
      cooldownDays: parseInt(m['rules_cooldownDays'] || '') || DEFAULT_RULES.cooldownDays,
      maxSectorPct: parseFloat(m['rules_maxSectorPct'] || '') || DEFAULT_RULES.maxSectorPct,
      timeExitMins: parseInt(m['rules_timeExitMins'] || '') || DEFAULT_RULES.timeExitMins,
      // v2 rules
      maxDrawdownPct: parseFloat(m['rules_maxDrawdownPct'] || '') || DEFAULT_RULES.maxDrawdownPct,
      dailyLossLimit: parseFloat(m['rules_dailyLossLimit'] || '') || DEFAULT_RULES.dailyLossLimit,
      // Fail-safe default: ON unless explicitly disabled via the Rules tab UI.
      // (Previously defaulted OFF whenever unset, which silently left the
      // engine trading unfiltered through bearish regimes — confirmed live:
      // no rules_niftyRegimeFilter key existed in AppSettings while
      // sched_niftyRegime was BEARISH.)
      niftyRegimeFilter: m['rules_niftyRegimeFilter'] !== 'false',
      atrTrailMultiplier: parseFloat(m['rules_atrTrailMultiplier'] || '') || DEFAULT_RULES.atrTrailMultiplier,
      adaptiveSizing: m['rules_adaptiveSizing'] !== 'false',
      streakPenaltyPct: parseFloat(m['rules_streakPenaltyPct'] || '') || DEFAULT_RULES.streakPenaltyPct,
      optDailyLossCapPct: parseFloat(m['rules_optDailyLossCapPct'] || '') || DEFAULT_RULES.optDailyLossCapPct,
      optDailyProfitLockPct: parseFloat(m['rules_optDailyProfitLockPct'] || '') || DEFAULT_RULES.optDailyProfitLockPct,
      optMaxPerSector: parseInt(m['rules_optMaxPerSector'] || '') || DEFAULT_RULES.optMaxPerSector,
      optNoEntryMinsToClose: parseInt(m['rules_optNoEntryMinsToClose'] || '') || DEFAULT_RULES.optNoEntryMinsToClose,
      optMaxIndexPositions: parseInt(m['rules_optMaxIndexPositions'] || '') || DEFAULT_RULES.optMaxIndexPositions,
    };
  } catch { return DEFAULT_RULES; }
}

async function getSchedulerState(): Promise<SchedulerState> {
  try {
    const s = await db.appSettings.findMany();
    const m: Record<string, string> = {};
    for (const x of s) m[x.key] = x.value;
    return {
      enabled: m['sched_enabled'] !== 'false', // always-on: default true unless explicitly 'false'
      scanIntervalMin: parseInt(m['sched_scanIntervalMin'] || '') || DEFAULT_SCHEDULER.scanIntervalMin,
      exitIntervalMin: parseInt(m['sched_exitIntervalMin'] || '') || DEFAULT_SCHEDULER.exitIntervalMin,
      lastScanAt: m['sched_lastScanAt'] || null,
      lastExitAt: m['sched_lastExitAt'] || null,
      nextScanAt: m['sched_nextScanAt'] || null,
      nextExitAt: m['sched_nextExitAt'] || null,
      todayEntries: parseInt(m['sched_todayEntries'] || '0'),
      todayExits: parseInt(m['sched_todayExits'] || '0'),
      todayPnl: parseFloat(m['sched_todayPnl'] || '0'),
      scanCount: parseInt(m['sched_scanCount'] || '0'),
      // v2 state
      circuitBreaker: m['sched_circuitBreaker'] === 'true',
      circuitBreakerReason: m['sched_circuitBreakerReason'] || '',
      niftyRegime: (m['sched_niftyRegime'] as SchedulerState['niftyRegime']) || 'UNKNOWN',
      consecutiveLosses: parseInt(m['sched_consecutiveLosses'] || '0'),
      lastAdaptiveFactor: parseFloat(m['sched_lastAdaptiveFactor'] || '1'),
    };
  } catch { return DEFAULT_SCHEDULER; }
}

async function setSchedulerKV(k: string, v: string) {
  await db.appSettings.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
}

// ── Always-On Auto-Trade: one-time migration forces both schedulers ON ──
// User requirement: "IT should be always auto trade only" — both equity and
// options schedulers should be ON. This migration runs ONCE on first server
// start after the update, forces both schedulers ON + upgrades capital to
// ₹10L. After that, the user can toggle via UI and their choice is respected.
let _autoEnableDone = false;
async function maybeAutoEnableSchedulers() {
  if (_autoEnableDone) return;
  _autoEnableDone = true;
  try {
    const now = new Date();
    const migrationDone = (await db.appSettings.findUnique({ where: { key: 'sched_migrationDone' } }))?.value === 'true';

    if (!migrationDone) {
      // ── ONE-TIME MIGRATION: force both schedulers ON + upgrade capital ──
      console.log('[AutoTrade] Running one-time migration: force schedulers ON + capital → ₹10L');

      // Force equity scheduler ON
      await setSchedulerKV('sched_enabled', 'true');
      await setSchedulerKV('sched_nextScanAt', now.toISOString());
      await setSchedulerKV('sched_nextExitAt', now.toISOString());
      await setSchedulerKV('sched_scanIntervalMin', '15');
      await setSchedulerKV('sched_exitIntervalMin', '1');

      // Force options auto-trader ON
      await setSchedulerKV('opt_enabled', 'true');
      await setSchedulerKV('opt_nextScanAt', now.toISOString());
      await setSchedulerKV('opt_nextExitAt', now.toISOString());
      await setSchedulerKV('opt_scanIntervalMin', '15');
      await setSchedulerKV('opt_exitIntervalMin', '1');

      // Upgrade capital to ₹10L (regardless of current value — user requested)
      const w = await db.capitalWallet.findFirst();
      if (w) {
        await db.capitalWallet.update({
          where: { id: w.id },
          data: {
            totalCapital: 1000000,
            initialCapital: 1000000,
            available: 1000000 - w.deployed,
          },
        });
        console.log('[AutoTrade] Capital upgraded to ₹10L (forced migration)');
      }

      await setSchedulerKV('sched_migrationDone', 'true');
      console.log('[AutoTrade] Migration complete — both schedulers ON, capital ₹10L');
    } else {
      // Migration already done — just ensure nextScanAt/nextExitAt are set
      // (in case the server restarted and they expired)
      const st = await getSchedulerState();
      if (st.enabled && !st.nextScanAt) await setSchedulerKV('sched_nextScanAt', now.toISOString());
      if (st.enabled && !st.nextExitAt) await setSchedulerKV('sched_nextExitAt', now.toISOString());

      const optEnabled = (await db.appSettings.findUnique({ where: { key: 'opt_enabled' } }))?.value !== 'false';
      if (optEnabled) {
        const optScanAt = (await db.appSettings.findUnique({ where: { key: 'opt_nextScanAt' } }))?.value;
        const optExitAt = (await db.appSettings.findUnique({ where: { key: 'opt_nextExitAt' } }))?.value;
        if (!optScanAt) await setSchedulerKV('opt_nextScanAt', now.toISOString());
        if (!optExitAt) await setSchedulerKV('opt_nextExitAt', now.toISOString());
      }
    }
  } catch (err) {
    console.warn('[AutoTrade] Auto-enable failed (will retry next tick):', err);
    _autoEnableDone = false; // Retry on next tick
  }
}

async function resetDailyCounters() {
  const today = new Date().toISOString().split('T')[0];
  const lastReset = (await db.appSettings.findUnique({ where: { key: 'sched_lastResetDate' } }))?.value;
  if (lastReset !== today) {
    await setSchedulerKV('sched_todayEntries', '0');
    await setSchedulerKV('sched_todayExits', '0');
    await setSchedulerKV('sched_todayPnl', '0');
    await setSchedulerKV('sched_lastResetDate', today);
    // Reset circuit breaker on new day (fresh start)
    await setSchedulerKV('sched_circuitBreaker', 'false');
    await setSchedulerKV('sched_circuitBreakerReason', '');
  }
}

// ── Daily restricted-symbol re-check ────────────────────
// Catches the class of bug found manually this session (4 of 74
// SWING_PROVEN_SYMBOLS turned out to be trading under restricted
// trade-to-trade settlement; the TATAMOTORS demerger before that) — a
// stock's real trading status can drift without any static list here
// knowing. Piggybacks on the same once-per-day cadence as
// resetDailyCounters() and the Dhan scrip master's own daily refresh
// (dhan-option-provider.ts), rather than a new cron job.
async function checkRestrictedSymbolsDaily() {
  const today = new Date().toISOString().split('T')[0];
  const lastCheck = (await db.appSettings.findUnique({ where: { key: 'sched_lastSeriesCheckDate' } }))?.value;
  if (lastCheck === today) return;
  await setSchedulerKV('sched_lastSeriesCheckDate', today);
  try {
    const { SWING_PROVEN_SYMBOLS } = await import('@/lib/trading/swing-proven-symbols');
    const { findFlaggedSymbols } = await import('@/lib/trading/symbol-series-check');
    const flagged = findFlaggedSymbols(Array.from(SWING_PROVEN_SYMBOLS));
    if (flagged.length > 0) {
      const summary = flagged.map(f => `${f.symbol}:${f.series ?? 'NOT_FOUND'}`).join(', ');
      await db.autoTradeLog.create({
        data: {
          action: 'SWING_RESTRICTED_SYMBOL_ALERT', symbol: 'GUARDRAIL', signal: '', executed: false,
          reason: `${flagged.length} proven-symbol(s) now flagged (restricted series or not found in scrip master): ${summary} — review swing-proven-symbols.ts`,
        },
      });
      console.warn(`[SwingProvenSymbols] ${flagged.length} flagged: ${summary}`);
    }
  } catch (err) {
    console.warn('[SwingProvenSymbols] Daily series check failed (non-blocking):', err);
  }
}

async function getWallet() {
  let w = await db.capitalWallet.findFirst();
  if (!w) w = await db.capitalWallet.create({ data: { totalCapital: 1000000, initialCapital: 1000000, available: 1000000 } });
  return w;
}

// ── v3: Persistent Peak Capital Update ─────────────────
async function updatePeakCapital(currentNAV: number) {
  const w = await getWallet();
  const peak = Math.max(w.peakCapital || 0, w.initialCapital, currentNAV);
  if (peak > (w.peakCapital || 0)) {
    await db.capitalWallet.update({
      where: { id: w.id },
      data: { peakCapital: peak },
    });
  }
}

async function recalcWallet() {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const deployed = open.reduce((s, t) => s + t.entryPrice * t.qty, 0);
  // [FIX] totalCapital is ALREADY initialCapital + realizedPnl everywhere else
  // in this codebase (see trades/route.ts's newTotalCapital, risk-metrics's
  // back-calc of initialCapital = totalCapital - realizedPnl). Adding
  // realizedPnl again here double-counted it, and since the result was
  // persisted back into totalCapital below, every subsequent recalcWallet()
  // call compounded the error further — an unbounded, ever-inflating capital
  // figure that also fed the drawdown peak (via updatePeakCapital(nav)).
  const total = w.initialCapital + w.realizedPnl;
  let unrealizedPnl = 0;
  const syms = [...new Set(open.map(t => t.symbol))];
  for (const sym of syms) {
    // getContractCurrentPrice handles both plain equity symbols and composite
    // option contract symbols (SYMBOL_CE_STRIKE_EXPIRY) — getCurrentPrice alone
    // always throws for the latter, which was silently dropping all open
    // options exposure from unrealized P&L / NAV.
    const price = await getContractCurrentPrice(sym, 0);
    if (price <= 0) continue; // no real quote available — skip rather than fabricate
    for (const t of open.filter(t => t.symbol === sym)) {
      const diff = t.direction === 'SHORT' ? (t.entryPrice - price) : (price - t.entryPrice);
      unrealizedPnl += diff * t.qty;
    }
  }
  await db.capitalWallet.update({ where: { id: w.id }, data: { deployed, available: total - deployed, unrealizedPnl, totalCapital: total } });
  // Update peak capital whenever we recalc
  const nav = total + unrealizedPnl;
  await updatePeakCapital(nav);
  return { ...w, deployed, available: total - deployed, unrealizedPnl, totalCapital: total, initialCapital: w.initialCapital };
}

async function getSectorAllocation(): Promise<Record<string, number>> {
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const w = await getWallet();
  const total = w.totalCapital;
  if (total <= 0) return {};
  const sectors: Record<string, number> = {};
  for (const t of open) {
    const ws = await db.watchlistStock.findUnique({ where: { symbol: t.symbol } });
    const sector = ws?.sector || t.tags?.split(',').find((tag: string) => !['auto','aplus','b','partial-booked'].includes(tag)) || 'Unknown';
    sectors[sector] = (sectors[sector] || 0) + (t.entryPrice * t.qty);
  }
  const pct: Record<string, number> = {};
  for (const [k, v] of Object.entries(sectors)) pct[k] = (v / total) * 100;
  return pct;
}

// ── v2: Drawdown & Circuit Breaker ─────────────────────
async function getPortfolioDrawdown(): Promise<{ drawdownPct: number; peakCapital: number; currentCapital: number }> {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  let unrealizedPnl = 0;
  const syms = [...new Set(open.map(t => t.symbol))];
  for (const sym of syms) {
    // See recalcWallet() — getContractCurrentPrice covers options contracts too,
    // so large unrealized options losses actually trip the drawdown circuit breaker.
    const price = await getContractCurrentPrice(sym, 0);
    if (price <= 0) continue;
    for (const t of open.filter(t => t.symbol === sym)) {
      const diff = t.direction === 'SHORT' ? (t.entryPrice - price) : (price - t.entryPrice);
      unrealizedPnl += diff * t.qty;
    }
  }

  const currentCapital = w.totalCapital + unrealizedPnl;
  // Use persisted peakCapital for accurate HWM (v3: no longer recalculated from scratch)
  // [FIX] w.totalCapital already includes realizedPnl (see recalcWallet()) —
  // adding it again here inflated the peak candidate, making drawdownPct
  // read artificially high and risking a false-positive circuit-breaker trip.
  const peakCapital = Math.max(w.peakCapital || 0, w.initialCapital, w.totalCapital, currentCapital);
  const drawdownPct = peakCapital > 0 ? ((peakCapital - currentCapital) / peakCapital) * 100 : 0;
  return { drawdownPct, peakCapital, currentCapital };
}

async function getConsecutiveLosses(): Promise<number> {
  const recent = await db.paperTrade.findMany({
    where: { status: 'CLOSED', autoTraded: true, pnl: { not: null } },
    orderBy: { exitDate: 'desc' },
    take: 10,
  });
  let streak = 0;
  for (const t of recent) {
    if ((t.pnl || 0) < 0) streak++;
    else break;
  }
  return streak;
}

function getAdaptiveFactor(consecutiveLosses: number, rules: PositionRules): number {
  if (!rules.adaptiveSizing) return 1.0;
  if (consecutiveLosses < 3) return 1.0;
  // Reduce by streakPenaltyPct for each loss beyond 2, min 20% of original
  const reductions = consecutiveLosses - 2;
  const factor = 1.0 - (reductions * (rules.streakPenaltyPct / 100));
  return Math.max(0.2, Math.min(1.0, factor));
}

// ── v2: Nifty Regime Detection ──────────────────────────
async function getNiftyRegime(niftyData: any[]): Promise<{ regime: 'BULLISH' | 'BEARISH' | 'UNKNOWN'; ema200: number; currentClose: number }> {
  if (niftyData.length < 200) return { regime: 'UNKNOWN', ema200: 0, currentClose: 0 };
  const closes = niftyData.map(c => c.close);
  const ema200Arr = EMA.calculate({ period: 200, values: closes });
  if (ema200Arr.length === 0) return { regime: 'UNKNOWN', ema200: 0, currentClose: 0 };
  const ema200 = ema200Arr[ema200Arr.length - 1];
  const currentClose = closes[closes.length - 1];
  return {
    regime: currentClose > ema200 ? 'BULLISH' : 'BEARISH',
    ema200: Math.round(ema200 * 100) / 100,
    currentClose: Math.round(currentClose * 100) / 100,
  };
}

// ── v2: ATR-based Trailing Stop ─────────────────────────
async function getATRTrailLevel(symbol: string, entryPrice: number, currentPrice: number, risk: number, rules: PositionRules, entryDate: Date): Promise<{ useATR: boolean; trailLevel: number; atr: number }> {
  if (rules.atrTrailMultiplier <= 0) {
    // Use fixed R-based trail (v1 behavior)
    const trailLevel = entryPrice + (risk * rules.trailToR);
    return { useATR: false, trailLevel, atr: 0 };
  }

  try {
    // Fetch enough real history to cover both the ATR(14) warmup and the
    // position's full holding period, so the high-water-mark below reflects
    // every real candle since entry, not just the last 30 days.
    const daysSinceEntry = Math.max(1, Math.ceil((Date.now() - entryDate.getTime()) / 86400000));
    const lookbackDays = Math.max(45, daysSinceEntry + 20);
    const { data } = await getHistoricalData(symbol, lookbackDays);
    if (data.length < 14) return { useATR: false, trailLevel: entryPrice + (risk * rules.trailToR), atr: 0 };

    const atrArr = ATR.calculate({
      period: 14,
      high: data.map(c => c.high),
      low: data.map(c => c.low),
      close: data.map(c => c.close),
    });
    if (atrArr.length === 0) return { useATR: false, trailLevel: entryPrice + (risk * rules.trailToR), atr: 0 };

    const atr = atrArr[atrArr.length - 1];

    // Real high-water-mark: the actual highest real daily high since entry,
    // plus today's real live price. Previously this used max(currentPrice,
    // entryPrice) as its own "peak" proxy, which always equaled currentPrice
    // at call time — making the exit condition (cp <= trailLevel) mathematically
    // impossible and silently disabling the trailing stop entirely.
    const entryDateStr = entryDate.toISOString().split('T')[0];
    const candlesSinceEntry = data.filter(c => c.date >= entryDateStr);
    const highestSinceEntry = candlesSinceEntry.length > 0 ? Math.max(...candlesSinceEntry.map(c => c.high)) : entryPrice;
    const highWaterMark = Math.max(entryPrice, highestSinceEntry, currentPrice);
    const trailLevel = highWaterMark - (atr * rules.atrTrailMultiplier);
    return { useATR: true, trailLevel: Math.round(trailLevel * 100) / 100, atr: Math.round(atr * 100) / 100 };
  } catch {
    return { useATR: false, trailLevel: entryPrice + (risk * rules.trailToR), atr: 0 };
  }
}

// ── Gate Checks (v2 enhanced canOpen) ───────────────────
async function canOpen(symbol: string, entryPrice: number, qty: number, rules: PositionRules, sector?: string, skipMaxPositionsCheck: boolean = false): Promise<{ ok: boolean; reason: string }> {
  const w = await getWallet();
  // Equity-only: exclude options-tagged trades so the options engine's own
  // (much larger) daily limit doesn't silently consume the equity Top-7 slots.
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN', tags: { not: { contains: 'options' } } } });
  const now = new Date();

  // === v2: Circuit Breaker Check ===
  const { drawdownPct } = await getPortfolioDrawdown();
  if (drawdownPct >= rules.maxDrawdownPct) {
    return { ok: false, reason: `CIRCUIT BREAKER: Drawdown ${drawdownPct.toFixed(1)}% >= ${rules.maxDrawdownPct}%` };
  }

  // === v2: Daily Loss Limit ===
  await resetDailyCounters();
  const st = await getSchedulerState();
  if (st.todayPnl < 0 && Math.abs(st.todayPnl) >= rules.dailyLossLimit) {
    return { ok: false, reason: `DAILY LOSS LIMIT: ₹${Math.abs(st.todayPnl).toFixed(0)} >= ₹${rules.dailyLossLimit}` };
  }

  // Max positions check — skipped when the caller (autoScanAndTrade's
  // capacity-based rank-priority fill) already tracks remaining slots itself
  // via a real open-count snapshot taken once per cycle; letting THIS check
  // fire per-candidate in scan order would fill slots by whatever order
  // getFullUniverse() happens to return them in, not by RS rank priority.
  if (!skipMaxPositionsCheck && open.length >= rules.maxTotalPositions) return { ok: false, reason: `Max ${rules.maxTotalPositions} positions` };

  // Per-stock cap
  const stockOpen = open.filter(t => t.symbol === symbol);
  const stockDep = stockOpen.reduce((s, t) => s + t.entryPrice * t.qty, 0);
  if (stockDep + entryPrice * qty > rules.maxPerStock) return { ok: false, reason: `Max ₹${rules.maxPerStock}/stock` };

  // Duplicate position
  if (stockOpen.length > 0) return { ok: false, reason: 'Open position exists' };

  // Monthly cap
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthTrades = await db.paperTrade.count({ where: { symbol, entryDate: { gte: monthStart } } });
  if (monthTrades >= rules.maxBuysPerMonth) return { ok: false, reason: `Max ${rules.maxBuysPerMonth} buys/month` };

  // Capital check
  if (entryPrice * qty > w.available) return { ok: false, reason: 'Insufficient capital' };

  // Cooldown check
  if (rules.cooldownDays > 0) {
    const lastExit = await db.paperTrade.findFirst({
      where: { symbol, status: 'CLOSED', exitDate: { not: null } },
      orderBy: { exitDate: 'desc' },
    });
    if (lastExit?.exitDate) {
      const daysSinceExit = (now.getTime() - new Date(lastExit.exitDate).getTime()) / 86400000;
      if (daysSinceExit < rules.cooldownDays) {
        return { ok: false, reason: `Cooldown: ${Math.ceil(rules.cooldownDays - daysSinceExit)}d remaining` };
      }
    }
  }

  // Sector concentration check
  if (sector && rules.maxSectorPct > 0) {
    const sectorAlloc = await getSectorAllocation();
    const currentPct = sectorAlloc[sector] || 0;
    const newPct = currentPct + ((entryPrice * qty) / w.totalCapital) * 100;
    if (newPct > rules.maxSectorPct) {
      return { ok: false, reason: `Sector cap: ${sector} at ${currentPct.toFixed(1)}% (max ${rules.maxSectorPct}%)` };
    }
  }

  return { ok: true, reason: '' };
}

// ── Core Engine: Scan & Auto-Enter (v2) ────────────────
async function autoScanAndTrade(config: ScreeningConfig, bypassRegime: boolean = false) {
  const rules = await getRules();
  // Dynamic capital base — config.liveCapital previously came straight from
  // DEFAULT_CONFIG (a hardcoded ₹300,000 constant that never changed), so
  // rank-based position sizing (allocatedCapital = liveCapital * weightPct in
  // runScreening) stayed pegged to that number forever even as the real
  // wallet genuinely grew or shrank through actual realized P&L. Rank-based
  // weighting itself is fine to keep (rank 1 should size bigger than rank 7)
  // — what was missing was the BASE tracking real account size. rules.maxPerStock
  // (a flat ₹75k ceiling) still caps any single position regardless, so this
  // doesn't reintroduce runaway compounding — it just means sizing scales with
  // real capital until that ceiling binds, which is the intended behavior for
  // live forward-testing (distinct from the backtest's fixed-ticket-size fix,
  // which addressed thousands of trades compounding within ONE simulated run).
  const liveWallet = await getWallet();
  config = { ...config, liveCapital: liveWallet.totalCapital };
  const stocks = getFullUniverse();
  const entries: any[] = [];
  const skipped: any[] = [];
  let niftyData: any[] = [];
  let niftyRegime: 'BULLISH' | 'BEARISH' | 'UNKNOWN' = 'UNKNOWN';

  try {
    const result = await getHistoricalData('NIFTY50', 350);
    niftyData = result.data;
  } catch {
    skipped.push({ symbol: 'NIFTY50', reason: 'Failed to fetch Nifty data for macro filter' });
    return { entries, skipped, l1Passed: 0, l2Signals: 0, totalScanned: stocks.length, circuitBreaker: false, niftyRegime: 'UNKNOWN' };
  }

  // v2: Nifty Regime Filter
  const regime = await getNiftyRegime(niftyData);
  niftyRegime = regime.regime;
  await setSchedulerKV('sched_niftyRegime', regime.regime);

  if (rules.niftyRegimeFilter && regime.regime === 'BEARISH' && !bypassRegime) {
    return {
      entries, skipped: [{ symbol: 'FILTER', reason: `Nifty regime BEARISH (Close ${regime.currentClose} < EMA200 ${regime.ema200})` }],
      l1Passed: 0, l2Signals: 0, totalScanned: stocks.length, circuitBreaker: false, niftyRegime,
    };
  }

  // Tiered event blackout — RBI policy day, Union Budget day, or a
  // high-impact US macro print (FOMC/CPI/NFP, real via the same
  // ForexFactory feed the Forex engine already uses) — same concept Forex
  // already had (macro_filter.py), equity/options had none of this before.
  // Blanket "no new entries this tick" like the regime filter above;
  // existing open positions are managed regardless (matches Forex's own
  // convention — a blackout blocks new risk, never an existing exit).
  const eventBlackout = await checkIndiaEventBlackout();
  if (eventBlackout.inBlackout) {
    return {
      entries, skipped: [{ symbol: 'EVENT_BLACKOUT', reason: `${eventBlackout.event} (${eventBlackout.tier}, ${eventBlackout.minutesToEvent}min) — no new equity entries` }],
      l1Passed: 0, l2Signals: 0, totalScanned: stocks.length, circuitBreaker: false, niftyRegime,
    };
  }

  // Institutional flow (real FII/DII net cash-market flow) — INFORMATIONAL
  // ONLY for equity, not a scoring adjustment. Equity's runScreening() is a
  // flat boolean AND-gate + count score with no confidence field to nudge
  // (unlike options, which has one) — adding a weighted factor there would
  // mean touching the same core scoring redesign the user explicitly said
  // to leave alone. Logged once per day for real visibility instead.
  try {
    const flow = await getInstitutionalFlowBias();
    if (flow) {
      const today = new Date().toISOString().split('T')[0];
      const dayStartIST = new Date(today + 'T00:00:00+05:30');
      const alreadyLoggedToday = await db.autoTradeLog.findFirst({
        where: { action: 'INSTITUTIONAL_FLOW_INFO', createdAt: { gte: dayStartIST } },
      });
      if (!alreadyLoggedToday) {
        await db.autoTradeLog.create({
          data: { action: 'INSTITUTIONAL_FLOW_INFO', symbol: 'MARKET', signal: '', executed: false, reason: flow.reason },
        });
      }
    }
  } catch { /* NSE fetch failed this cycle — informational only, never blocks scanning */ }

  // v2: Circuit breaker & daily loss check
  await resetDailyCounters();
  await checkRestrictedSymbolsDaily();
  const { drawdownPct } = await getPortfolioDrawdown();
  const st = await getSchedulerState();
  if (drawdownPct >= rules.maxDrawdownPct) {
    await setSchedulerKV('sched_circuitBreaker', 'true');
    await setSchedulerKV('sched_circuitBreakerReason', `Drawdown ${drawdownPct.toFixed(1)}% >= ${rules.maxDrawdownPct}%`);
    return {
      entries, skipped: [{ symbol: 'CIRCUIT_BREAKER', reason: `Portfolio drawdown ${drawdownPct.toFixed(1)}% exceeds ${rules.maxDrawdownPct}% limit` }],
      l1Passed: 0, l2Signals: 0, totalScanned: stocks.length, circuitBreaker: true, niftyRegime,
    };
  }
  if (st.todayPnl < 0 && Math.abs(st.todayPnl) >= rules.dailyLossLimit) {
    await setSchedulerKV('sched_circuitBreaker', 'true');
    await setSchedulerKV('sched_circuitBreakerReason', `Daily loss ₹${Math.abs(st.todayPnl).toFixed(0)} >= ₹${rules.dailyLossLimit}`);
    return {
      entries, skipped: [{ symbol: 'DAILY_LIMIT', reason: `Daily loss ₹${Math.abs(st.todayPnl).toFixed(0)} exceeds ₹${rules.dailyLossLimit} limit` }],
      l1Passed: 0, l2Signals: 0, totalScanned: stocks.length, circuitBreaker: true, niftyRegime,
    };
  }

  // v2: Adaptive sizing factor
  const consLosses = await getConsecutiveLosses();
  await setSchedulerKV('sched_consecutiveLosses', String(consLosses));
  const adaptiveFactor = getAdaptiveFactor(consLosses, rules);
  await setSchedulerKV('sched_lastAdaptiveFactor', String(adaptiveFactor));

  // L1 filter in batches
  const BATCH = 15;
  const l1Pass: { stock: NSEStock; data: any[] }[] = [];
  for (let i = 0; i < stocks.length; i += BATCH) {
    const batch = stocks.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(async (stock) => {
      const { data } = await getHistoricalData(stock.symbol, 300);
      return { stock, data };
    }));
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const l1 = runL1Filter(r.value.stock.symbol, r.value.stock.name, r.value.stock.sector, r.value.stock.category, r.value.data);
      if (l1 && l1.passed) l1Pass.push(r.value);
    }
  }

  // ── Real weekly RS ranking (rs-ranking.ts) — replaces the previously
  //    hardcoded 7-symbol watchlist. Falls back to the static
  //    TOP_7_RANKED_SYMBOLS list only if no dynamic ranking has been
  //    computed yet (e.g. the very first tick before the bootstrap runs). ──
  const { getActiveTop7, getActiveVacantSlots } = await import('@/lib/trading/rs-ranking');
  const activeTop7 = await getActiveTop7();
  const activeVacant = await getActiveVacantSlots();
  const dynamicRankTable = [...activeTop7, ...activeVacant];
  const { TOP_7_RANKED_SYMBOLS: STATIC_TOP_7 } = await import('@/lib/trading/screening-engine');
  const extendedPool = activeTop7.length > 0 ? [...activeTop7, ...activeVacant] : STATIC_TOP_7;
  // symbol -> rank, for the wider (top-20) capacity-based pool below.
  const EXTENDED_POOL_RANKS = new Map(extendedPool.map(s => [s.symbol.toUpperCase(), s.rank]));

  // ── Capacity-based slot-filling (replaces strict "must be exactly one of
  //    the Top-7 identities") ─────────────────────────────────────────────
  // Previously a Top-7 stock with no valid technical setup today just left
  // that slot empty — the rank-8..20 "vacant slot candidates" were computed
  // and stored but never actually promoted into trading. Now: any stock in
  // the wider ranked pool (top ~20) that gets a real signal today is a
  // candidate; candidates are collected during the scan below, then filled
  // in RANK order (best RS first) up to however many equity slots are
  // actually open, instead of requiring the exact top-7 names to fire.
  //
  // Eligibility gate = intersection of "highly RS-ranked" (momentum, from
  // rs-ranking.ts) AND "proven fit for this exact rule-set" (real 5-year
  // backtest PF/trade-count filter, swing-proven-symbols.ts) — RS rank alone
  // isn't enough, since a stock can rank well on momentum and still be a
  // structurally bad fit for this strategy (the options backtest found
  // exactly this split with high-beta PSU names, and the full-universe
  // swing backtest found the same split).
  const { SWING_PROVEN_SYMBOLS } = await import('@/lib/trading/swing-proven-symbols');
  // Matches canOpen()'s original open-position query exactly (all open
  // non-options positions, not just autoTraded ones) so this doesn't change
  // what counts against the cap — just WHEN/how the cap is enforced.
  const openEquityCount = await db.paperTrade.count({
    where: { status: 'OPEN', tags: { not: { contains: 'options' } } },
  });
  const remainingSlots = Math.max(0, rules.maxTotalPositions - openEquityCount);
  const pendingCandidates: Array<{
    stock: NSEStock; signal: any; qty: number; actualEntryPrice: number;
    capitalDeployed: number; riskRs: number; rank: number;
  }> = [];

  // L2 V-Swing + auto-enter with v2 enhancements
  for (const { stock, data } of l1Pass) {
    try {
      const signal = runScreening(stock.symbol, data, config, niftyRegime === 'BULLISH', false, niftyData, dynamicRankTable);
      if (!signal) { skipped.push({ symbol: stock.symbol, reason: 'No V-Swing signal' }); continue; }

      // v2: Apply adaptive sizing
      // v3: Use sizing.qty from the engine (accounts for capital and weight)
      let qty = signal.sizing.qty;
      if (adaptiveFactor < 1.0) {
        const adjustedQty = Math.max(1, Math.floor(qty * adaptiveFactor));
        skipped.push({
          symbol: stock.symbol, reason: `Adaptive sizing: ${qty} → ${adjustedQty} (${(adaptiveFactor * 100).toFixed(0)}% factor, ${consLosses} consecutive losses)`,
        });
        // Only show as info, still proceed with adjusted qty
        qty = adjustedQty;
      }
      if (qty <= 0) { skipped.push({ symbol: stock.symbol, reason: 'Qty=0' }); continue; }

      const check = await canOpen(stock.symbol, signal.entryPrice, qty, rules, stock.sector, true);
      if (!check.ok) { skipped.push({ symbol: stock.symbol, reason: check.reason }); continue; }

      // ── v3: Apply slippage to actual entry price ──────────────────────
      const slippageAdjustedEntry = getSlippageAdjustedEntry(signal.entryPrice, stock.symbol);
      const actualEntryPrice = slippageAdjustedEntry;
      const capitalDeployed = actualEntryPrice * qty;
      const riskRs = (actualEntryPrice - signal.stopLoss) * qty;

      // ── v3: Build Discord signal payload ────────────────────────────────
      const w = await getWallet();
      const discordSignal: EquityTradeSignal = {
        symbol: stock.symbol,
        stockName: stock.name,
        entryPrice: actualEntryPrice,
        stopLoss: signal.stopLoss,
        targetPrice: signal.targetPrice,
        qty,
        riskReward: signal.riskReward,
        score: signal.score,
        setupType: signal.setupType as 'A+' | 'B',
        niftyRegime,
        adaptiveFactor,
        sector: stock.sector || 'Unknown',
        capital: capitalDeployed,
        riskRs: Math.max(0, riskRs),
        dataSource: 'Yahoo Finance / DhanHQ',
        tradeId: 'pending',  // will be updated after DB create
        timestamp: new Date().toISOString(),
      };

      // ── Discord signal dedup: at most once per symbol per trading day ──
      // Previously this posted unconditionally every scan cycle (every
      // scanIntervalMin, ~15 min) for as long as a setup stayed valid —
      // for the ~392 non-whitelisted symbols that never get an open position
      // (which is what naturally suppresses re-alerts for whitelisted
      // symbols via canOpen()'s "Open position exists" check), the same
      // ENTRY SIGNAL embed could repost dozens of times across a single day.
      const dayStartIST = new Date(istDateString(new Date()) + 'T00:00:00+05:30');
      const alreadyAlertedToday = await db.autoTradeLog.findFirst({
        where: { action: 'EQUITY_SIGNAL', symbol: stock.symbol, createdAt: { gte: dayStartIST } },
      });
      if (!alreadyAlertedToday) {
        try {
          await sendDiscordEquitySignal(discordSignal);
        } catch (discordErr) {
          console.warn('[Discord] Equity signal alert failed (non-blocking):', discordErr);
        }
        await db.autoTradeLog.create({
          data: {
            action: 'EQUITY_SIGNAL', symbol: stock.symbol,
            signal: JSON.stringify(discordSignal), executed: false,
            reason: `${signal.setupType} signal alerted @ ₹${actualEntryPrice}`,
          },
        });
      }

      // ── Pool eligibility: wider ranked pool (top ~20), not strict Top-7 ──
      const symUpper = stock.symbol.toUpperCase();
      const rank = EXTENDED_POOL_RANKS.get(symUpper);
      const inPool = rank !== undefined && SWING_PROVEN_SYMBOLS.has(symUpper);
      if (!inPool) continue;

      // canOpen() above already rejected this candidate if it has an open
      // position, is over the per-stock/monthly/capital limits, etc. — only
      // the max-total-positions gate was deferred to the rank-priority fill below.
      pendingCandidates.push({ stock, signal, qty, actualEntryPrice, capitalDeployed, riskRs, rank: rank! });
    } catch (err) { skipped.push({ symbol: stock.symbol, reason: String(err) }); }
  }

  // ── Rank-priority fill: best RS first, up to however many equity slots
  //    are actually open. A rank-1 stock with no signal today just cedes
  //    its slot to whichever lower-ranked pool member DID get a signal,
  //    instead of leaving capital idle. ──────────────────────────────────
  pendingCandidates.sort((a, b) => a.rank - b.rank);
  let slotsLeft = remainingSlots;
  for (const cand of pendingCandidates) {
    if (slotsLeft <= 0) {
      skipped.push({ symbol: cand.stock.symbol, reason: `Pool-eligible (rank ${cand.rank}) but all ${rules.maxTotalPositions} equity slots filled by higher-priority candidates` });
      continue;
    }
    const { stock, signal, qty, actualEntryPrice, rank } = cand;
    try {
      const trade = await db.paperTrade.create({
        data: {
          symbol: stock.symbol, stockName: stock.name, direction: 'LONG',
          entryDate: new Date(), entryPrice: actualEntryPrice, qty,
          stopLoss: signal.stopLoss, targetPrice: signal.targetPrice,
          autoTraded: true,
          notes: `AUTO v3 | ${signal.setupType} | Score:${signal.score}/6 | R:R:${signal.riskReward}x | Regime:${niftyRegime} | Factor:${(adaptiveFactor * 100).toFixed(0)}% | Slippage adj entry`,
          // rank-N tag feeds the rank-bucket win-rate tracker (rank-bucket-intelligence.ts)
          tags: `auto,${signal.setupType === 'A+' ? 'aplus' : 'b'},score-${signal.score},rank-${rank},${stock.sector || ''}`.replace(/,$/, ''),
        },
      });
      await db.autoTradeLog.create({
        data: {
          action: 'AUTO_ENTRY', symbol: stock.symbol, tradeId: trade.id,
          signal: JSON.stringify({ ...signal, slippageAdjustedEntry: actualEntryPrice }),
          executed: true,
          reason: `${signal.setupType} | Score ${signal.score}/6 | Qty ${qty} @ ₹${actualEntryPrice} | R:R ${signal.riskReward}x | Factor:${(adaptiveFactor * 100).toFixed(0)}% | Rank ${rank}`,
        },
      });

      // Recorder — equity never had this (only options did), despite
      // rank-bucket-intelligence.ts already tracking win-rate-by-RS-rank.
      // This adds the missing piece: which of the 6 individual conditions
      // (trend/pullback/trigger/volume/RS/gap) actually predicts a win,
      // from real forward-tested outcomes — resolved in autoCheckExits().
      const equityReasons: string[] = [];
      if (signal.checks.trendAbove) equityReasons.push('Trend above SMA200 and EMA20>EMA50');
      if (signal.checks.pullbackOk) equityReasons.push('Pullback to EMA20 zone');
      if (signal.checks.triggerOk) equityReasons.push('Breakout trigger (close > prior bar high)');
      if (signal.checks.volumeOk) equityReasons.push('Volume surge >=1.2x average');
      if (signal.checks.rsOk) equityReasons.push('Outperforming Nifty 50 (20-session relative strength)');
      if (signal.checks.gapOk) equityReasons.push('Bullish gap confirmation');
      await recordSignal(
        { symbol: stock.symbol, direction: 'LONG', score: signal.score, confidence: Math.round((signal.score / 6) * 1000) / 10, reasons: equityReasons },
        true,
        trade.id
      );

      await resetDailyCounters();
      const st2 = await getSchedulerState();
      await setSchedulerKV('sched_todayEntries', String(st2.todayEntries + 1));
      await setSchedulerKV('sched_scanCount', String(st2.scanCount + 1));

      entries.push({
        symbol: stock.symbol, setupType: signal.setupType, score: signal.score,
        entryPrice: actualEntryPrice, qty, tradeId: trade.id,
        adaptiveFactor, niftyRegime, rank,
      });
      slotsLeft--;
    } catch (err) { skipped.push({ symbol: stock.symbol, reason: String(err) }); }
  }

  await recalcWallet();
  return {
    entries, skipped, l1Passed: l1Pass.length, l2Signals: entries.length,
    totalScanned: stocks.length, circuitBreaker: false, niftyRegime,
    adaptiveFactor, consecutiveLosses: consLosses, drawdownPct,
  };
}

// ── Core Engine: Check Exits (v2 with health scoring) ─
async function autoCheckExits() {
  const rules = await getRules();
  // Equity-only: options positions have their own dedicated exit path
  // (autoOptionsCheckExits) with the correct cost model, expiry-day close,
  // and 3:15 PM square-off. Without this filter, options trades were also
  // processed here first with the wrong (equity) cost model.
  const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN', tags: { not: { contains: 'options' } } }, orderBy: { entryDate: 'asc' } });
  const exits: any[] = [];
  const holding: any[] = [];
  const partialBooks: any[] = [];
  const warnings: any[] = [];

  const minsToClose = timeToClose();
  const shouldTimeExit = minsToClose <= rules.timeExitMins && minsToClose > 0;

  // [FIX] Previously called getContractCurrentPrice() once per open
  // position inside this loop — N sequential Dhan API round-trips when
  // Dhan's own getDhanMarketQuotes() already accepts an array of many
  // securities in one call. It was just always being invoked with a
  // one-item array from a per-symbol call site. Batched here instead: one
  // real quote call for every open equity position's price, up front.
  const { getCurrentPricesBatch } = await import('@/lib/trading/data-provider');
  const priceMap = openTrades.length > 0 ? await getCurrentPricesBatch(openTrades.map((t) => t.symbol)) : {};

  for (const trade of openTrades) {
    try {
      const cp = priceMap[trade.symbol] ?? 0;
      if (cp <= 0) { holding.push({ symbol: trade.symbol, error: 'Price unavailable' }); continue; }

      const days = Math.floor((Date.now() - new Date(trade.entryDate).getTime()) / 86400000);
      const risk = trade.entryPrice - trade.stopLoss;
      const rMultiple = risk > 0 ? (cp - trade.entryPrice) / risk : 0;
      let shouldExit = false;
      let reason = '';
      let exitPrice = cp;
      let exitQty = trade.qty;

      // 1. Hard SL hit
      if (cp <= trade.stopLoss) {
        shouldExit = true; reason = 'SL_HIT'; exitPrice = trade.stopLoss;
      }
      // 2. Hard TP hit
      else if (cp >= trade.targetPrice) {
        shouldExit = true; reason = 'TP_HIT'; exitPrice = trade.targetPrice;
      }
      // 3. Trailing stop (v2: ATR-based if configured)
      else if (risk > 0 && rMultiple >= rules.trailingStopR) {
        const trail = await getATRTrailLevel(trade.symbol, trade.entryPrice, cp, risk, rules, new Date(trade.entryDate));
        if (trail.useATR) {
          // ATR trailing: only exit if price drops below ATR-based level
          if (cp <= trail.trailLevel) {
            shouldExit = true; reason = 'ATR_TRAIL_STOP'; exitPrice = trail.trailLevel;
          }
        } else {
          // Fixed R trailing (v1 behavior)
          const trailLevel = trade.entryPrice + (risk * rules.trailToR);
          if (cp <= trailLevel) {
            shouldExit = true; reason = 'TRAIL_STOP'; exitPrice = trailLevel;
          }
        }
      }
      // 4. Max holding days
      else if (days >= rules.maxHoldingDays) {
        shouldExit = true; reason = 'MAX_HOLDING_DAYS';
      }
      // 5. v2: Stale loser acceleration — exit aging losing positions faster
      else if (days >= rules.maxHoldingDays * 0.7 && rMultiple < -0.3) {
        shouldExit = true; reason = 'STALE_LOSER';
      }
      // 6. Time-based exit
      else if (shouldTimeExit) {
        if (rMultiple < 0.5) {
          shouldExit = true; reason = 'TIME_EXIT'; exitPrice = cp;
        }
      }

      // 7. Partial booking (doesn't trigger full exit)
      if (!shouldExit && risk > 0 && rMultiple >= rules.partialBookR && trade.qty > 1) {
        const alreadyBooked = trade.tags?.includes('partial-booked');
        if (!alreadyBooked) {
          const bookQty = Math.max(1, Math.floor(trade.qty * (rules.partialBookPct / 100)));
          const remainingQty = trade.qty - bookQty;
          if (remainingQty >= 1) {
            // ── v3: Deduct real transaction costs on the booked leg — previously
            //    credited gross P&L, inconsistent with full exits which correctly
            //    deduct costs before crediting the wallet. ──
            const bookCosts: CostBreakdown = calculateEquityCosts(trade.entryPrice, cp, bookQty, trade.symbol);
            const grossBookPnl = (cp - trade.entryPrice) * bookQty;
            const netBookPnl = grossBookPnl - bookCosts.totalCosts;
            await db.paperTrade.update({
              where: { id: trade.id },
              data: { qty: remainingQty, tags: (trade.tags ? trade.tags + ',' : '') + 'partial-booked' },
            });
            const w = await getWallet();
            await db.capitalWallet.update({
              where: { id: w.id },
              data: {
                realizedPnl: Math.round((w.realizedPnl + netBookPnl) * 100) / 100,
                totalCostsPaid: Math.round(((w.totalCostsPaid || 0) + bookCosts.totalCosts) * 100) / 100,
              },
            });
            await db.autoTradeLog.create({
              data: {
                action: 'PARTIAL_BOOK', symbol: trade.symbol, tradeId: trade.id,
                signal: '', executed: true,
                reason: `Booked ${bookQty}/${trade.qty + bookQty} at ${rMultiple.toFixed(1)}R | Net P&L: ₹${netBookPnl.toLocaleString()} (costs ₹${bookCosts.totalCosts.toFixed(2)})`,
              },
            });
            partialBooks.push({ symbol: trade.symbol, bookedQty: bookQty, remainingQty, rMultiple, pnl: netBookPnl, exitPrice: cp });

            // ── Discord partial-book alert (previously imported but never called) ──
            try {
              const notes = trade.notes || '';
              const setupMatch = notes.match(/([AB]\+?)\s*Setup|([AB]\+?)\s*score/i);
              const scoreMatch = notes.match(/Score:(\d)/i);
              await sendDiscordEquityPartialBook({
                signal: {
                  symbol: trade.symbol, stockName: trade.stockName || trade.symbol,
                  entryPrice: trade.entryPrice, stopLoss: trade.stopLoss, targetPrice: trade.targetPrice,
                  qty: trade.qty, riskReward: 0,
                  score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
                  setupType: (setupMatch?.[1] || setupMatch?.[2] || 'B') as 'A+' | 'B',
                  niftyRegime: 'N/A', adaptiveFactor: 1,
                  sector: trade.tags?.split(',').find(t => !['auto', 'aplus', 'b', 'partial-booked'].includes(t)) || 'Unknown',
                  capital: trade.entryPrice * trade.qty,
                  riskRs: (trade.entryPrice - trade.stopLoss) * trade.qty,
                  dataSource: 'DhanHQ/Yahoo', tradeId: trade.id, timestamp: trade.entryDate.toISOString(),
                },
                bookedQty: bookQty, remainingQty, bookPrice: cp,
                rMultiple: `${rMultiple.toFixed(2)}R`,
                grossPnl: Math.round(grossBookPnl * 100) / 100,
                netPnl: Math.round(netBookPnl * 100) / 100,
                totalCosts: Math.round(bookCosts.totalCosts * 100) / 100,
              });
            } catch (discordErr) {
              console.warn('[Discord] Partial-book notification failed (non-blocking):', discordErr);
            }
          }
        }
      }

      // Execute full exit
      if (shouldExit) {
        // ── v3: Apply exit slippage ─────────────────────────────────────────
        const slippageAdjustedExit = getSlippageAdjustedExit(exitPrice, trade.symbol);
        const actualExitPrice = slippageAdjustedExit;

        // ── v3: Calculate transaction costs ────────────────────────────────
        const costs: CostBreakdown = calculateEquityCosts(
          trade.entryPrice,
          actualExitPrice,
          exitQty,
          trade.symbol
        );
        const grossPnl = (actualExitPrice - trade.entryPrice) * exitQty;
        const netPnl = grossPnl - costs.totalCosts;
        const pnlPct = ((actualExitPrice - trade.entryPrice) / trade.entryPrice) * 100;

        await db.paperTrade.update({
          where: { id: trade.id },
          data: {
            status: 'CLOSED',
            exitDate: new Date(),
            exitPrice: Math.round(actualExitPrice * 100) / 100,
            // Legacy field (backward compat) — stores netPnl
            pnl: Math.round(netPnl * 100) / 100,
            pnlPercent: Math.round(pnlPct * 100) / 100,
            exitReason: reason,
            // v3 cost fields
            grossPnl: Math.round(grossPnl * 100) / 100,
            netPnl: Math.round(netPnl * 100) / 100,
            totalCosts: Math.round(costs.totalCosts * 100) / 100,
            brokerageCost: Math.round(costs.brokerage * 100) / 100,
            sttCost: Math.round(costs.stt * 100) / 100,
            slippageCost: Math.round(costs.slippage * 100) / 100,
            otherCharges: Math.round((costs.exchangeCharges + costs.gst + costs.sebiFees + costs.stampDuty) * 100) / 100,
          },
        });

        // ── v3: Credit NET P&L to wallet (not gross) ──────────────────────
        const w = await getWallet();
        await db.capitalWallet.update({
          where: { id: w.id },
          data: {
            realizedPnl: Math.round((w.realizedPnl + netPnl) * 100) / 100,
            totalCostsPaid: Math.round(((w.totalCostsPaid || 0) + costs.totalCosts) * 100) / 100,
          },
        });

        await db.autoTradeLog.create({
          data: {
            action: `AUTO_EXIT_${reason}`, symbol: trade.symbol, tradeId: trade.id,
            signal: '',
            executed: true,
            reason: `${reason} | ₹${trade.entryPrice}→₹${actualExitPrice.toFixed(2)} | Gross: ₹${grossPnl.toFixed(2)} | Costs: ₹${costs.totalCosts.toFixed(2)} | Net: ₹${netPnl.toFixed(2)} | ${rMultiple.toFixed(1)}R`,
          },
        });

        // ── v3: Discord exit notification ──────────────────────────────────
        try {
          const notes = trade.notes || '';
          const setupMatch = notes.match(/([AB]\+?)\s*Setup|([AB]\+?)\s*score/i);
          const scoreMatch = notes.match(/Score:(\d)/i);
          const discordExit = {
            signal: {
              symbol: trade.symbol,
              stockName: trade.stockName || trade.symbol,
              entryPrice: trade.entryPrice,
              stopLoss: trade.stopLoss,
              targetPrice: trade.targetPrice,
              qty: exitQty,
              riskReward: 0,
              score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
              setupType: (setupMatch?.[1] || setupMatch?.[2] || 'B') as 'A+' | 'B',
              niftyRegime: 'N/A',
              adaptiveFactor: 1,
              sector: trade.tags?.split(',').find(t => !['auto','aplus','b','partial-booked'].includes(t)) || 'Unknown',
              capital: trade.entryPrice * exitQty,
              riskRs: (trade.entryPrice - trade.stopLoss) * exitQty,
              dataSource: 'DhanHQ/Yahoo',
              tradeId: trade.id,
              timestamp: trade.entryDate.toISOString(),
            },
            exitPrice: actualExitPrice,
            exitReason: reason,
            holdingDays: days,
            rMultiple: `${rMultiple.toFixed(2)}R`,
            grossPnl: Math.round(grossPnl * 100) / 100,
            netPnl: Math.round(netPnl * 100) / 100,
            totalCosts: Math.round(costs.totalCosts * 100) / 100,
            brokerageCost: Math.round(costs.brokerage * 100) / 100,
            sttCost: Math.round(costs.stt * 100) / 100,
            slippageCost: Math.round(costs.slippage * 100) / 100,
            exitAt: new Date().toISOString(),
            status: netPnl > 0 ? 'WIN' : netPnl < 0 ? 'LOSS' : 'BREAKEVEN' as 'WIN' | 'LOSS' | 'BREAKEVEN',
          };
          await sendDiscordEquityExit(discordExit);
        } catch (discordErr) {
          console.warn('[Discord] Exit notification failed (non-blocking):', discordErr);
        }

        // v2: Track consecutive losses for adaptive sizing
        if (netPnl < 0) {
          const newStreak = (await getSchedulerState()).consecutiveLosses + 1;
          await setSchedulerKV('sched_consecutiveLosses', String(newStreak));
        } else {
          await setSchedulerKV('sched_consecutiveLosses', '0');
          await setSchedulerKV('sched_lastAdaptiveFactor', '1');
        }

        // Validator — stamp the real outcome back onto this trade's recorded
        // signal (mirrors autoOptionsCheckExits' resolveSignalByTradeId) so
        // getFactorAttribution() can finally compute real per-factor win
        // rates for equity too, not just options.
        await resolveSignalByTradeId(trade.id, netPnl > 0, netPnl);

        await resetDailyCounters();
        const st2 = await getSchedulerState();
        await setSchedulerKV('sched_todayExits', String(st2.todayExits + 1));
        await setSchedulerKV('sched_todayPnl', String(st2.todayPnl + netPnl));

        // v2: Check if we need to activate daily loss circuit breaker
        const updatedSt = await getSchedulerState();
        if (updatedSt.todayPnl < 0 && Math.abs(updatedSt.todayPnl) >= rules.dailyLossLimit) {
          await setSchedulerKV('sched_circuitBreaker', 'true');
          await setSchedulerKV('sched_circuitBreakerReason', `Daily loss ₹${Math.abs(updatedSt.todayPnl).toFixed(0)} >= ₹${rules.dailyLossLimit}`);
        }

        exits.push({
          symbol: trade.symbol, exitReason: reason, entryPrice: trade.entryPrice, exitPrice: actualExitPrice,
          grossPnl, netPnl, totalCosts: costs.totalCosts,
          pnlPercent: pnlPct, holdingDays: days, rMultiple: rMultiple.toFixed(2),
        });
      } else {
        // v2: Position Health Score
        const health = scorePositionHealth(cp, trade.entryPrice, trade.stopLoss, trade.targetPrice, days, rules.maxHoldingDays, rMultiple);
        const healthData: any = {
          symbol: trade.symbol, entryPrice: trade.entryPrice, currentPrice: cp,
          pnl: (cp - trade.entryPrice) * trade.qty,
          pnlPercent: ((cp - trade.entryPrice) / trade.entryPrice) * 100,
          holdingDays: days, maxHoldingDays: rules.maxHoldingDays,
          sl: trade.stopLoss, tp: trade.targetPrice, rMultiple: rMultiple.toFixed(2),
          healthScore: health.score, healthUrgency: health.urgency, healthFactors: health.factors,
        };

        if (health.urgency === 'CRITICAL') {
          healthData.slWarning = true;
          warnings.push({ ...healthData, type: health.score < 20 ? 'SL_PROXIMITY' : 'AGING', message: `${trade.symbol} health ${health.score}/100 (${health.urgency})` });
        } else if (health.urgency === 'WARNING') {
          warnings.push({ ...healthData, type: 'AGING', message: `${trade.symbol} health ${health.score}/100` });
        }

        holding.push(healthData);
      }
    } catch { holding.push({ symbol: trade.symbol, error: 'Price fetch failed' }); }
  }

  if (exits.length > 0 || partialBooks.length > 0) await recalcWallet();
  return { exits, holding, partialBooks, warnings, timeToClose: minsToClose, marketHours: isMarketHours() };
}

// ── IST Time Helpers ───────────────────────────────────
function getISTDate(d: Date = new Date()): Date {
  // Shift the absolute moment by IST offset so getHours()/getDay() reflect IST
  return new Date(d.getTime() + (5.5 * 60 * 60 * 1000) + (d.getTimezoneOffset() * 60 * 1000));
}

function istTimeStr(d: Date = new Date()): string {
  return d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function istDateString(d: Date = new Date()): string {
  return getISTDate(d).toISOString().split('T')[0];
}

// ── DhanHQ Token Expiry Check ──────────────────────────
// DhanHQ access tokens are JWTs that expire every 24 hours. When expired,
// ALL live data calls fail and the app silently falls back to Yahoo Finance
// (equities only — options chain has NO fallback and returns null).
// This surfaces the expiry in the Discord health check so the user knows to refresh.
function checkDhanHQTokenExpiry(): { configured: boolean; expired: boolean; expiresAt?: string; message: string } {
  const token = process.env.OPTIONS_DHAN_ACCESS_TOKEN || process.env.DHAN_ACCESS_TOKEN || '';
  if (!token) {
    return { configured: false, expired: false, message: 'DhanHQ token NOT configured — live broker data unavailable' };
  }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return { configured: true, expired: true, message: 'DhanHQ token malformed' };
    const payloadB64 = parts[1];
    const padded = payloadB64 + '='.repeat((4 - (payloadB64.length % 4)) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'));
    const exp = payload.exp;
    if (typeof exp !== 'number') return { configured: true, expired: false, message: 'DhanHQ token has no exp claim' };
    const nowSec = Math.floor(Date.now() / 1000);
    const expired = nowSec >= exp;
    const expiresAt = new Date(exp * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    return {
      configured: true,
      expired,
      expiresAt,
      message: expired
        ? `🚨 DHANHQ TOKEN EXPIRED at ${expiresAt} IST — refresh token to restore live data & options chain`
        : `✅ DhanHQ token valid (expires ${expiresAt} IST)`,
    };
  } catch {
    return { configured: true, expired: true, message: 'DhanHQ token decode failed — treat as expired' };
  }
}

// ── Swing Stocks Status (for hourly heartbeat) ─────────
// Checks the Top 7 ranked swing stocks: are they aligned (all 4 conditions
// met for a buy trigger)? What's the current price vs the entry trigger?
// If there's an open position, show entry price + unrealized P&L.
// Narrow version — this week's live RS-ranked Top 7 only. Used ONLY for the
// hourly Discord heartbeat, which needs to stay short; the dashboard uses
// getSwingUniverseStatus() below instead, which covers the real (wider)
// eligible pool. Kept as its own function rather than a .slice(0,7) of the
// wider one because the wider one is ranked by backtest PF, not live RS rank
// — the heartbeat specifically wants this week's RS leaders.
async function getSwingTop7Status(): Promise<Array<{
  symbol: string; name: string; rank: number; weightPct: number;
  currentPrice: number; aligned: boolean; missing: string[];
  openPosition?: { entryPrice: number; qty: number; pnl: number; pnlPct: number };
}>> {
  try {
    const { runScreening, DEFAULT_CONFIG, TOP_7_RANKED_SYMBOLS: STATIC_TOP_7 } = await import('@/lib/trading/screening-engine');
    const { getActiveTop7, getActiveVacantSlots } = await import('@/lib/trading/rs-ranking');
    const activeTop7 = await getActiveTop7();
    const activeVacant = await getActiveVacantSlots();
    const dynamicRankTable = [...activeTop7, ...activeVacant];
    const watchlistStocks = activeTop7.length > 0 ? activeTop7 : STATIC_TOP_7;

    const results: Array<{
      symbol: string; name: string; rank: number; weightPct: number;
      currentPrice: number; aligned: boolean; missing: string[];
      openPosition?: { entryPrice: number; qty: number; pnl: number; pnlPct: number };
    }> = [];

    let niftyData: any[] = [];
    try {
      niftyData = (await getHistoricalData('NIFTY50', 350)).data;
    } catch { /* RS check below will simply stay unproven without Nifty data */ }

    for (const stock of watchlistStocks) {
      try {
        const { data } = await getHistoricalData(stock.symbol, 300);
        const { price } = await getCurrentPrice(stock.symbol);
        // includeUnmet=true so we get the signal even if not all conditions met
        const signal = runScreening(stock.symbol, data, DEFAULT_CONFIG, true, true, niftyData, dynamicRankTable);

        const aligned = signal
          ? signal.checks.trendAbove && signal.checks.pullbackOk && signal.checks.triggerOk && signal.checks.volumeOk
          : false;
        const missing = signal?.missingConditions || ['No data'];

        const openTrade = await db.paperTrade.findFirst({
          where: { symbol: stock.symbol, status: 'OPEN', autoTraded: true },
        });

        results.push({
          symbol: stock.symbol,
          name: stock.name,
          rank: stock.rank,
          weightPct: stock.weightPct,
          currentPrice: Math.round(price * 100) / 100,
          aligned,
          missing: missing.slice(0, 3), // top 3 missing conditions
          openPosition: openTrade ? {
            entryPrice: openTrade.entryPrice,
            qty: openTrade.qty,
            pnl: Math.round((price - openTrade.entryPrice) * openTrade.qty * 100) / 100,
            pnlPct: Math.round(((price - openTrade.entryPrice) / openTrade.entryPrice) * 10000) / 100,
          } : undefined,
        });
      } catch { /* skip individual stock errors */ }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Hourly Status Dispatcher (merged heartbeat + health check) ──────────
// [FIX 2026-07-27] This used to be a separate hourly "heartbeat" running
// alongside an automatic 15-min "health check" — the two overlapped heavily
// (both reported open positions, Nifty regime, general status) and together
// produced up to ~5 periodic status pings an hour on top of real trade
// alerts. Consolidated into ONE hourly update carrying everything useful
// from both: circuit-breaker state, capital summary, and WHY equity/options
// aren't trading if something's actually blocking them (health check's
// diagnostic value) alongside the per-stock alignment table (heartbeat's
// unique value). The old automatic 15-min dispatch is gone — see the
// removed block in runSchedulerTickInner(); buildSystemHealthReport() and
// the manual on-demand `health_check` action are untouched for debugging.
async function dispatchHourlyHeartbeat(now: Date) {
  const lastHbStr = (await db.appSettings.findUnique({ where: { key: 'sched_lastHeartbeatAt' } }))?.value;
  const lastHbTime = lastHbStr ? new Date(lastHbStr).getTime() : 0;
  if (now.getTime() - lastHbTime < 60 * 60000) return; // 1 hour cadence

  try {
    const { sendDiscordHeartbeat } = await import('@/lib/notifications/discord');
    const st = await getSchedulerState();
    const w = await recalcWallet();
    const openCount = await db.paperTrade.count({ where: { status: 'OPEN', autoTraded: true } });
    const health = await buildSystemHealthReport();

    // Fetch the 7 swing stocks' alignment status for the heartbeat
    const swingStocks = await getSwingTop7Status();

    await sendDiscordHeartbeat({
      timeIST: istTimeStr(now),
      niftyRegime: st.niftyRegime || 'UNKNOWN',
      openPositions: openCount,
      unrealizedPnl: w.unrealizedPnl || 0,
      realizedPnl: w.realizedPnl || 0,
      nextSquareOffTime: '3:10 PM IST',
      swingStocks,
      circuitBreaker: health.circuitBreaker,
      circuitBreakerReason: health.circuitBreakerReason,
      optionsOpenPositions: health.options.openPositions,
      equityTradeReason: health.equity.tradeReason,
      optionsTradeReason: health.options.tradeReason,
      availableCapital: health.wallet.availableCapital,
      deployedCapital: health.wallet.deployedCapital,
      peakCapital: health.wallet.peakCapital,
    });
    await setSchedulerKV('sched_lastHeartbeatAt', now.toISOString());
  } catch (err) {
    console.warn('[AutoTrade] Hourly heartbeat dispatch error:', err);
  }
}

// ── Real max-concurrency calculation ────────────────────────────────────
// "How many were open at once" cannot be answered by checking status='OPEN'
// at the moment the EOD report runs (3:30pm+) — options are force-closed by
// 3:15pm, so that snapshot is almost always 0 for options specifically, and
// even for equity a snapshot only shows ONE instant, not the day's peak.
// This instead sweeps the REAL entryDate/exitDate timestamps of every trade
// that overlapped today's session at all, and finds the true maximum number
// of simultaneously-open positions — a standard interval-overlap count, not
// a fabricated estimate.
async function computeMaxConcurrency(dayStart: Date, dayEnd: Date, now: Date, tagFilter: 'options' | 'equity'): Promise<number> {
  const tagWhere = tagFilter === 'options'
    ? { tags: { contains: 'options' } }
    : { tags: { not: { contains: 'options' } } };

  const relevant = await db.paperTrade.findMany({
    where: {
      ...tagWhere,
      entryDate: { lte: dayEnd },
      OR: [
        { status: 'OPEN' },
        { status: 'CLOSED', exitDate: { gte: dayStart } },
      ],
    },
  });

  const events: { t: number; delta: number }[] = [];
  for (const t of relevant) {
    const start = Math.max(new Date(t.entryDate).getTime(), dayStart.getTime());
    const rawEnd = t.status === 'OPEN' ? now.getTime() : new Date(t.exitDate as Date).getTime();
    const end = Math.min(rawEnd, dayEnd.getTime());
    if (end <= start) continue;
    events.push({ t: start, delta: 1 });
    events.push({ t: end, delta: -1 });
  }
  events.sort((a, b) => a.t - b.t || b.delta - a.delta);

  let running = 0;
  let max = 0;
  for (const e of events) {
    running += e.delta;
    max = Math.max(max, running);
  }
  return max;
}

// ── EOD Summary Dispatcher (fires once per day after 3:30 PM IST market close) ──
async function dispatchEODSummary(now: Date) {
  // Never on a weekend/holiday — this had no day check at all before, only
  // a time check, so a fresh start on a Saturday/Sunday afternoon (with
  // sched_lastEODDate still holding Friday's date) would fire a bogus EOD
  // summary for a day nothing actually traded.
  if (isNonTradingDay(now)) return;

  const ist = getISTDate(now);
  const istMins = ist.getHours() * 60 + ist.getMinutes();

  // Only fire after 15:30 IST (3:30 PM market close)
  if (istMins < 930) return;

  const today = istDateString(now);
  const lastEODDate = (await db.appSettings.findUnique({ where: { key: 'sched_lastEODDate' } }))?.value;
  if (lastEODDate === today) return; // Already sent today

  try {
    const { sendDiscordEODSummary } = await import('@/lib/notifications/discord');

    // Query today's closed auto-trades (IST day boundary)
    const dayStart = new Date(today + 'T00:00:00+05:30');
    const dayEnd = new Date(today + 'T23:59:59+05:30');
    const closedTrades = await db.paperTrade.findMany({
      where: {
        status: 'CLOSED',
        autoTraded: true,
        exitDate: { gte: dayStart, lte: dayEnd },
      },
    });

    const totalTrades = closedTrades.length;
    const winTrades = closedTrades.filter(t => (t.netPnl ?? t.pnl ?? 0) > 0).length;
    const lossTrades = closedTrades.filter(t => (t.netPnl ?? t.pnl ?? 0) < 0).length;
    const winRate = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;
    const grossPnl = closedTrades.reduce((s, t) => s + (t.grossPnl ?? 0), 0);
    const statutoryCosts = closedTrades.reduce((s, t) => s + (t.totalCosts ?? 0), 0);
    const netPnl = closedTrades.reduce((s, t) => s + (t.netPnl ?? t.pnl ?? 0), 0);
    const w = await getWallet();
    const capitalDeployed = w.deployed || 0;
    const netPnlPct = w.totalCapital > 0 ? (netPnl / w.totalCapital) * 100 : 0;

    const winningTradesList = closedTrades
      .filter(t => (t.netPnl ?? t.pnl ?? 0) > 0)
      .map(t => `${t.symbol}: +₹${Math.round(t.netPnl ?? t.pnl ?? 0).toLocaleString('en-IN')} (${t.exitReason || 'CLOSED'})`);
    const losingTradesList = closedTrades
      .filter(t => (t.netPnl ?? t.pnl ?? 0) < 0)
      .map(t => `${t.symbol}: ₹${Math.round(t.netPnl ?? t.pnl ?? 0).toLocaleString('en-IN')} (${t.exitReason || 'CLOSED'})`);

    // ── Forward-test visibility: signals received, live concurrency, real
    //    profit factor, and real capital-per-trade sizing ──────────────────
    const grossWinPnl = closedTrades.filter(t => (t.netPnl ?? t.pnl ?? 0) > 0).reduce((s, t) => s + (t.netPnl ?? t.pnl ?? 0), 0);
    const grossLossPnl = Math.abs(closedTrades.filter(t => (t.netPnl ?? t.pnl ?? 0) < 0).reduce((s, t) => s + (t.netPnl ?? t.pnl ?? 0), 0));
    const profitFactor = grossLossPnl > 0 ? Math.round((grossWinPnl / grossLossPnl) * 100) / 100 : (grossWinPnl > 0 ? 999 : 0);

    const optionsSignalsToday = await db.autoTradeLog.count({
      where: { action: 'AUTO_ENTRY', symbol: { contains: '_' }, createdAt: { gte: dayStart, lte: dayEnd } },
    });

    // Real PEAK concurrency for today (see computeMaxConcurrency) — not a
    // point-in-time snapshot, which is meaningless for options once they've
    // been force-closed by the 3:15pm square-off.
    const peakConcurrentOptions = await computeMaxConcurrency(dayStart, dayEnd, now, 'options');
    const peakConcurrentEquity = await computeMaxConcurrency(dayStart, dayEnd, now, 'equity');

    // Real avg capital per trade — from today's trades that were actually
    // open at some point (same relevance window as the concurrency sweep).
    const todaysTrades = await db.paperTrade.findMany({
      where: { entryDate: { lte: dayEnd }, OR: [{ status: 'OPEN' }, { status: 'CLOSED', exitDate: { gte: dayStart } }] },
    });
    const avgCapitalPerTrade = todaysTrades.length > 0
      ? Math.round(todaysTrades.reduce((s, t) => s + t.entryPrice * t.qty, 0) / todaysTrades.length)
      : 0;
    const estCapitalForConcurrency = avgCapitalPerTrade * (peakConcurrentOptions + peakConcurrentEquity);

    await sendDiscordEODSummary({
      date: today,
      totalTrades,
      winTrades,
      lossTrades,
      winRate,
      grossPnl: Math.round(grossPnl * 100) / 100,
      statutoryCosts: Math.round(statutoryCosts * 100) / 100,
      netPnl: Math.round(netPnl * 100) / 100,
      netPnlPct: Math.round(netPnlPct * 100) / 100,
      capitalDeployed: Math.round(capitalDeployed * 100) / 100,
      winningTradesList,
      losingTradesList,
      optionsSignalsToday,
      peakConcurrentOptions,
      peakConcurrentEquity,
      profitFactor,
      avgCapitalPerTrade,
      estCapitalForConcurrency,
    });
    await setSchedulerKV('sched_lastEODDate', today);
  } catch (err) {
    console.warn('[AutoTrade] EOD summary dispatch error:', err);
  }
}

// ── Weekly Monday 8:30 AM Rebalance Notice Dispatcher ──
async function dispatchWeeklyRebalanceNotice(now: Date) {
  const ist = getISTDate(now);
  const istDay = ist.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const istMins = ist.getHours() * 60 + ist.getMinutes();

  // Only fire on Monday (1) between 8:30 AM and 11:00 AM IST
  if (istDay !== 1) return;
  if (istMins < 510 || istMins > 660) return; // 8:30 AM = 510, 11:00 AM = 660

  const today = istDateString(now);
  const lastRebalDate = (await db.appSettings.findUnique({ where: { key: 'sched_lastRebalanceDate' } }))?.value;
  if (lastRebalDate === today) return; // Already sent today

  try {
    const { sendDiscordWeeklyRebalanceNotice } = await import('@/lib/notifications/discord');
    const { computeWeeklyRSRanking, getActiveTop7, getActiveVacantSlots } = await import('@/lib/trading/rs-ranking');

    // Recompute the real weekly RS ranking (real historical prices vs. real
    // Nifty 50 returns — see rs-ranking.ts) before reporting it. This can
    // take a few minutes for the full NSE universe; it's fine to await here
    // since this only runs once, in the pre-market 8:30-11:00 AM window,
    // guarded above by the once-per-cycleDate check.
    await computeWeeklyRSRanking();
    const top7 = await getActiveTop7();
    const vacant = await getActiveVacantSlots();

    await sendDiscordWeeklyRebalanceNotice({
      rebalanceTime: istTimeStr(now),
      top7Symbols: top7.map(s => `${s.symbol} (${Math.round(s.weightPct * 100)}%)`),
      vacantSlotsFilled: vacant.map(s => `${s.symbol} (${Math.round(s.weightPct * 100)}%)`),
    });
    await setSchedulerKV('sched_lastRebalanceDate', today);
  } catch (err) {
    console.warn('[AutoTrade] Weekly rebalance notice dispatch error:', err);
  }
}

// ── Scheduler Control ──────────────────────────────────
// In-memory mutex: this app runs as a single persistent Node process
// (see daemon.js), and a tick can legitimately take 2+ minutes to scan
// hundreds of stocks. Without this guard, the 30s server timer + the GET
// handler's fire-and-forget trigger + multiple independent frontend
// pollers can all invoke overlapping ticks, racing on every timestamp-gated
// Discord dispatcher, the daily P&L/loss-limit counters, and wallet credits
// on concurrent exits (can silently defeat the circuit breaker or
// double-credit P&L). One flag serializes everything below it.
let tickInProgress = false;

async function runSchedulerTick() {
  if (tickInProgress) return { skipped: true, reason: 'Previous tick still running' };
  tickInProgress = true;
  try {
    return await runSchedulerTickInner();
  } finally {
    tickInProgress = false;
  }
}

async function runSchedulerTickInner() {
  const now = new Date();

  // Auto-enable schedulers on first run (always-on auto-trade mode)
  await maybeAutoEnableSchedulers();

  // Bootstrap the real weekly RS ranking on first run if none exists yet —
  // otherwise a fresh deployment would trade off an empty dynamic watchlist
  // until the next Monday 8:30 AM rebalance window.
  try {
    const { ensureWeeklyRankingBootstrapped } = await import('@/lib/trading/rs-ranking');
    await ensureWeeklyRankingBootstrapped();
  } catch (err) {
    console.warn('[AutoTrade] Weekly ranking bootstrap error:', err);
  }

  // ── Always-on scheduled Discord dispatchers (run regardless of market hours) ──
  await dispatchEODSummary(now);
  await dispatchWeeklyRebalanceNotice(now);

  // [REMOVED 2026-07-27] The automatic 15-min Discord health check used to
  // dispatch here. Its own comment admitted it ran "regardless of the
  // intraday market-hours window" — firing every 15 minutes around the
  // clock, long after market close, for information that heavily overlapped
  // the hourly heartbeat anyway (open positions, regime, general status).
  // Folded into ONE consolidated hourly update instead (see
  // dispatchHourlyHeartbeat above, called below at the end of this
  // function) — no more automatic 15-min pings at all. `buildSystemHealthReport()`
  // and the manual `health_check` API action are untouched for on-demand use.
  const healthCheckSent = false; // kept in the return shape below so existing callers reading this field don't break

  if (!isMarketHours()) return { marketHours: false, message: 'Market closed', healthCheckSent };
  const state = await getSchedulerState();
  if (!state.enabled) return { marketHours: true, enabled: false, healthCheckSent };

  await resetDailyCounters();
  const results: any = { scanResult: null, exitResult: null, healthCheckSent };

  // ── Equity Swing scan & exit ──
  if (state.nextScanAt) {
    const nextScan = new Date(state.nextScanAt);
    if (now >= nextScan) {
      const config: ScreeningConfig = DEFAULT_CONFIG;
      results.scanResult = await autoScanAndTrade(config);
      await setSchedulerKV('sched_lastScanAt', now.toISOString());
      const next = new Date(now.getTime() + state.scanIntervalMin * 60000);
      await setSchedulerKV('sched_nextScanAt', next.toISOString());
    }
  }

  if (state.nextExitAt) {
    const nextExitTime = new Date(state.nextExitAt);
    if (now >= nextExitTime) {
      results.exitResult = await autoCheckExits();
      const nextExitDate = new Date(now.getTime() + state.exitIntervalMin * 60000);
      await setSchedulerKV('sched_nextExitAt', nextExitDate.toISOString());
    }
  }

  // ── Options scan & exit (auto-scheduled when opt_enabled) ──
  const optEnabled = (await db.appSettings.findUnique({ where: { key: 'opt_enabled' } }))?.value === 'true';
  if (optEnabled) {
    const optScanAtStr = (await db.appSettings.findUnique({ where: { key: 'opt_nextScanAt' } }))?.value;
    const optExitAtStr = (await db.appSettings.findUnique({ where: { key: 'opt_nextExitAt' } }))?.value;
    const optScanInt = parseInt((await db.appSettings.findUnique({ where: { key: 'opt_scanIntervalMin' } }))?.value || '15', 10);
    const optExitInt = parseInt((await db.appSettings.findUnique({ where: { key: 'opt_exitIntervalMin' } }))?.value || '1', 10);

    const optScanAt = optScanAtStr ? new Date(optScanAtStr) : now;
    if (now >= optScanAt) {
      try {
        results.optionsScanResult = await autoOptionsScanAndTrade();
        await setSchedulerKV('opt_lastScanAt', now.toISOString());
        const next = new Date(now.getTime() + optScanInt * 60000);
        await setSchedulerKV('opt_nextScanAt', next.toISOString());
      } catch (err) {
        console.warn('[AutoTrade] Options scan error:', err);
      }
    }

    const optExitAt = optExitAtStr ? new Date(optExitAtStr) : now;
    if (now >= optExitAt) {
      try {
        results.optionsExitResult = await autoOptionsCheckExits();
        await setSchedulerKV('opt_lastExitAt', now.toISOString());
        const next = new Date(now.getTime() + optExitInt * 60000);
        await setSchedulerKV('opt_nextExitAt', next.toISOString());
      } catch (err) {
        console.warn('[AutoTrade] Options exit check error:', err);
      }
    }
  }

  // ── Hourly Heartbeat (market hours only) ──
  await dispatchHourlyHeartbeat(now);

  return { ...results, marketHours: true, enabled: true, schedulerState: await getSchedulerState() };
}

// ── Options Auto-Trade Functions ────────────────────────
// Index lot sizes verified against NSE circular FAOP70616.pdf (effective the
// Jan-2026 contract series onward): NIFTY 65, BANKNIFTY 30, FINNIFTY 60,
// MIDCPNIFTY 120. These must be updated again whenever NSE revises them —
// check the NSE F&O circulars page before assuming these are still current.
export function getOptionLotSize(symbol: string): number {
  const sym = symbol.toUpperCase();
  if (sym === 'NIFTY' || sym === 'NIFTY50') return 65;
  if (sym === 'BANKNIFTY') return 30;
  if (sym === 'FINNIFTY') return 60;
  if (sym === 'MIDCPNIFTY') return 120;

  // Stock options official exchange lot sizes — kept in sync with the
  // verified table in src/lib/options/black-scholes.ts (see its comment for
  // sourcing/verification notes).
  if (sym === 'RELIANCE') return 250; // unverified in this pass
  if (sym === 'SBIN') return 750; // unverified in this pass
  if (sym === 'LT') return 175;
  if (sym === 'TCS') return 175; // unverified in this pass
  if (sym === 'INFY') return 400;
  if (sym === 'HDFCBANK') return 650;
  if (sym === 'ICICIBANK') return 700;
  if (sym === 'BAJFINANCE') return 750;
  // Tata Motors demerged 2025-10-01 — continuing entity (Dhan security ID
  // 3456, unchanged) now trades as "TMPV"; lot size verified live against
  // the Dhan scrip master (2026-07-27), replacing the old unverified 550.
  // The new "TMCV" entity has no F&O contracts at all yet.
  if (sym === 'TMPV') return 1600;
  if (sym === 'BHARTIARTL') return 475;
  if (sym === 'HAL') return 300; // unverified in this pass

  return 100;
}

async function autoOptionsScanAndTrade(minConfidence: number = SNIPER_MIN_CONFIDENCE, minScore: number = SNIPER_MIN_SCORE): Promise<{
  signalsGenerated: number; entriesCreated: number; errors: string[];
}> {
  const errors: string[] = [];
  let entriesCreated = 0;

  try {
    // Reset daily options counters if new day
    const today = new Date().toISOString().split('T')[0];
    const lastOptReset = (await db.appSettings.findUnique({ where: { key: 'opt_lastResetDate' } }))?.value;
    if (lastOptReset !== today) {
      await db.appSettings.upsert({ where: { key: 'opt_todayEntries' }, update: { value: '0' }, create: { key: 'opt_todayEntries', value: '0' } });
      await db.appSettings.upsert({ where: { key: 'opt_todayPnl' }, update: { value: '0' }, create: { key: 'opt_todayPnl', value: '0' } });
      await db.appSettings.upsert({ where: { key: 'opt_lastResetDate' }, update: { value: today }, create: { key: 'opt_lastResetDate', value: today } });
    }

    const todayEntriesStr = (await db.appSettings.findUnique({ where: { key: 'opt_todayEntries' } }))?.value || '0';
    let todayEntries = parseInt(todayEntriesStr, 10);

    // Sniper mode: a handful of trades a day, not 30-50 — the scoring bar in
    // options-scanner.ts now does the real filtering; this cap is just a
    // defense-in-depth backstop in case scoring ever over-fires.
    const OPT_DAILY_LIMIT = 10;
    if (todayEntries >= OPT_DAILY_LIMIT) {
      return { signalsGenerated: 0, entriesCreated: 0, errors: [`Daily options entry limit (${OPT_DAILY_LIMIT}) reached`] };
    }

    // Tiered event blackout — same as equity's autoScanAndTrade above;
    // options are more sensitive to this than equity given intraday
    // leverage/theta, not less.
    const eventBlackout = await checkIndiaEventBlackout();
    if (eventBlackout.inBlackout) {
      await db.autoTradeLog.create({ data: { action: 'OPT_EVENT_BLACKOUT', symbol: 'GUARDRAIL', signal: '', executed: false, reason: `${eventBlackout.event} (${eventBlackout.tier}, ${eventBlackout.minutesToEvent}min) — no new options entries` } });
      return { signalsGenerated: 0, entriesCreated: 0, errors: [`Event blackout: ${eventBlackout.event}`] };
    }

    // ── Options guardrails engine ───────────────────────────────────────
    // Previously the options engine had NO P&L-based circuit breaker at all
    // (opt_todayPnl was read in the status endpoint but never written by
    // anything) — only the flat entry-count cap above. These gates close
    // that gap: stop digging on a bad day, stop pressing on a good one,
    // don't open fresh risk with no runway before square-off, and — new —
    // don't keep opening options positions if the WHOLE portfolio (equity +
    // options combined, see getPortfolioDrawdown()) is already down big.
    const rules = await getRules();
    const optTodayPnl = parseFloat((await db.appSettings.findUnique({ where: { key: 'opt_todayPnl' } }))?.value || '0');

    // Portfolio-wide drawdown circuit breaker — equity's autoScanAndTrade
    // already halts on this (rules.maxDrawdownPct), but the options entry
    // path never checked it at all: the portfolio could be down past the
    // drawdown limit and options would keep opening fresh risk regardless.
    // getPortfolioDrawdown() already includes options' own unrealized P&L in
    // the calculation (its own comment confirms this) — it just was never
    // consulted here as a gate.
    const { drawdownPct } = await getPortfolioDrawdown();
    if (drawdownPct >= rules.maxDrawdownPct) {
      await db.autoTradeLog.create({ data: { action: 'OPT_CIRCUIT_BREAKER', symbol: 'GUARDRAIL', signal: '', executed: false, reason: `Portfolio drawdown ${drawdownPct.toFixed(1)}% >= ${rules.maxDrawdownPct}% — no new options entries` } });
      return { signalsGenerated: 0, entriesCreated: 0, errors: [`Portfolio drawdown ${drawdownPct.toFixed(1)}% exceeds ${rules.maxDrawdownPct}% limit`] };
    }

    // Daily loss cap / profit lock — now a % of CURRENT capital (see the
    // PositionRules field comments for why this changed from a flat ₹
    // amount), computed fresh each check so it stays meaningful as capital
    // actually grows or shrinks.
    const wallet = await getWallet();
    const optDailyLossCapAmount = wallet.totalCapital * (rules.optDailyLossCapPct / 100);
    const optDailyProfitLockAmount = wallet.totalCapital * (rules.optDailyProfitLockPct / 100);

    if (optTodayPnl <= -optDailyLossCapAmount) {
      await db.autoTradeLog.create({ data: { action: 'OPT_CIRCUIT_BREAKER', symbol: 'GUARDRAIL', signal: '', executed: false, reason: `Daily options loss cap hit: ₹${optTodayPnl.toFixed(0)} <= -₹${optDailyLossCapAmount.toFixed(0)} (${rules.optDailyLossCapPct}% of ₹${wallet.totalCapital.toFixed(0)} capital)` } });
      return { signalsGenerated: 0, entriesCreated: 0, errors: [`Daily options loss cap reached (₹${optTodayPnl.toFixed(0)})`] };
    }
    if (optTodayPnl >= optDailyProfitLockAmount) {
      await db.autoTradeLog.create({ data: { action: 'OPT_PROFIT_LOCK', symbol: 'GUARDRAIL', signal: '', executed: false, reason: `Daily options profit lock hit: ₹${optTodayPnl.toFixed(0)} >= ₹${optDailyProfitLockAmount.toFixed(0)} (${rules.optDailyProfitLockPct}% of ₹${wallet.totalCapital.toFixed(0)} capital) — quitting while ahead` } });
      return { signalsGenerated: 0, entriesCreated: 0, errors: [`Daily options profit lock reached (₹${optTodayPnl.toFixed(0)}) — no new entries today`] };
    }
    if (timeToClose() <= rules.optNoEntryMinsToClose) {
      return { signalsGenerated: 0, entriesCreated: 0, errors: [`Within ${rules.optNoEntryMinsToClose}min of square-off — no new entries`] };
    }

    // Correlated-exposure tally — count currently OPEN options positions per
    // sector so the entry loop below can block piling into 3+ correlated
    // single-sector bets that would all move together on one sector shock.
    const openOptionsForSector = await db.paperTrade.findMany({
      where: { status: 'OPEN', tags: { contains: 'options' } },
      select: { symbol: true, notes: true },
    });
    const sectorOpenCount: Record<string, number> = {};
    // Index correlation tally — NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY are all
    // driven by the same broad-market beta, so treat them as ONE correlated
    // basket (mirrors the sector cap above, and Forex's CORRELATION_GROUPS/
    // MAX_CORR_TRADES pattern for FX pairs) rather than 4 independent bets.
    let openIndexCount = 0;
    for (const t of openOptionsForSector) {
      try {
        const sec = t.notes ? (JSON.parse(t.notes).sector as string | undefined) : undefined;
        if (sec) sectorOpenCount[sec] = (sectorOpenCount[sec] || 0) + 1;
      } catch { /* ignore unparsable notes */ }
      const underlying = t.symbol.split('_')[0];
      if (INDEX_SYMBOLS.includes(underlying)) openIndexCount++;
    }

    // Adaptive de-risking — mirrors the equity swing engine's getAdaptiveFactor
    // (consecutive real losses shrink size before the hard daily-loss circuit
    // breaker above ever trips). Options previously had no equivalent — a
    // losing streak traded the same size right up until optDailyLossCap hit.
    // Tracked as its own opt_* counter, separate from swing's sched_* one,
    // since these are different books with independent P&L.
    const optConsecutiveLosses = parseInt((await db.appSettings.findUnique({ where: { key: 'opt_consecutiveLosses' } }))?.value || '0', 10);
    const optAdaptiveFactor = getAdaptiveFactor(optConsecutiveLosses, rules);

    // ── Risk-based sizing setup — fetch capital once, track running balance ──
    // Options previously ignored risk entirely: every entry traded exactly 1
    // exchange lot (getOptionLotSize) regardless of premium, and nothing
    // checked available capital before creating the trade. This is the exact
    // "fixed size, wildly different ₹ risk" bug ODSS's own paper-trader found
    // and fixed in its history (its header comment: "a ₹1.77 option risked
    // ₹3.7k while a ₹88 option risked ₹18.5k — same size, 5x the risk, same
    // capital"). Now sized to rules.riskPerTradePct of total capital per
    // trade, capped by what's actually available, walked down like ODSS's
    // selectAffordableStrike. availableCapitalTracker is decremented as each
    // trade in this scan commits, so a burst of signals in one cycle can't
    // collectively overspend the wallet.
    const walletState = await recalcWallet();
    let availableCapitalTracker = walletState.available;
    const equityForRisk = walletState.totalCapital;

    const { OPTIONS_TOP10_SYMBOLS, OPTIONS_TOP5_PRIORITY, OPT_TOP10_CONCURRENCY_CAP } = await import('@/lib/trading/options-proven-symbols');
    // Stock-options concurrency tally (TOP-10 basket, cap=3 — see
    // options-proven-symbols.ts for the real backtest this was picked from).
    // Separate from the index-correlation count above: this caps how many
    // TOP-10 stock-options names can be open at once, indices aren't part of
    // this basket at all.
    let openTop10Count = 0;
    for (const t of openOptionsForSector) {
      const underlying = t.symbol.split('_')[0];
      if (OPTIONS_TOP10_SYMBOLS.has(underlying)) openTop10Count++;
    }

    // Run the options scanner across full F&O universe
    const scanResult = await scanOptionsUniverse(50, minScore); // Get up to 50 signals

    // User request: temporarily remove the 14-symbol whitelist — paper-trade
    // ALL eligible signals so the open-position check suppresses duplicates
    // and stops Discord flooding. Will revert to top-14 whitelist once testing
    // is complete and capital is back to ₹3L.
    //
    // Proven-PF gate — being highly scored/confident today is a different
    // signal from "this specific stock's price action actually suits the
    // options rule-set" (the 171-symbol backtest found many high-scoring
    // names go to near-zero capital over 5 real years — see PENDING.md #1
    // and options-proven-symbols.ts). Narrowed from the full 20-symbol
    // proven list to just the TOP-10 (by PF) per the 2026-07-25 concurrency
    // backtest decision — see options-proven-symbols.ts for the 6-scenario
    // comparison this came from. Index signals aren't gated — there is no
    // historical-options backtest for indices to gate them against.
    // Live dynamic prioritization (ODSS-inspired — see the port note in
    // worklog/Obsidian): the confluence score above is already computed
    // fresh every scan across the full F&O universe (getFNOUniverse(),
    // options-scanner.ts) — the proven-symbols filter is a deliberate,
    // backtested SAFETY gate (which symbols are allowed to trade at all),
    // not stale data, and stays as-is. What WAS static despite the scoring
    // being live: when the sector/index/TOP10-concurrency caps below have
    // fewer open slots than eligible signals this scan, the loop previously
    // took whichever symbol happened to come first in scan order (not
    // sorted at all) — meaning a mediocre signal could claim a scarce slot
    // ahead of a stronger one purely by iteration order.
    const highConfidenceRaw = scanResult.signals
      .filter(s => s.confidence >= minConfidence)
      .filter(s => INDEX_SYMBOLS.includes(s.symbol) || OPTIONS_TOP10_SYMBOLS.has(s.symbol.toUpperCase()));

    // Score stabilizer (ODSS conviction-engine-inspired, scoped down — see
    // score-stabilizer.ts) — ranks by an EMA-smoothed score across scans
    // rather than this single scan's raw confidence, so a symbol that's
    // been consistently decent isn't edged out of a scarce slot by another
    // symbol's one-scan noise spike. The MIN_CONFIDENCE gate above still
    // applies to the raw score (a real signal-quality bar); only the
    // PRIORITY ORDER for scarce-slot competition uses the smoothed score.
    const withSmoothed = await Promise.all(
      highConfidenceRaw.map(async (s) => ({
        sig: s,
        smoothed: await getSmoothedScore(s.symbol, s.direction, s.confidence),
      }))
    );
    withSmoothed.sort((a, b) => b.smoothed - a.smoothed);
    const highConfidence = withSmoothed.map((w) => w.sig);

    for (let i = 0; i < highConfidence.length; i++) {
      const sig = highConfidence[i];
      const originalTechnicalConfidence = sig.confidence; // before any IV/OC/reputation adjustment below — for the decision-trace record
      const tradeSymbol = `${sig.symbol}_${sig.direction}_${sig.strike}_${sig.expiry}`;
      const exchangeLotSize = getOptionLotSize(sig.symbol);

      // ── DUPLICATE SUPPRESSION (BEFORE sending any signal) ──────────────
      // Rule: once a strike is triggered, don't re-trigger until that trade
      // closes (profit or loss). Prevents Discord flooding with the same
      // strike every scan cycle.
      //
      // 1. Skip if there's an OPEN position for this exact contract — the
      //    trade is still active and hasn't resolved yet.
      const existingOpen = await db.paperTrade.findFirst({
        where: { symbol: tradeSymbol, status: 'OPEN', tags: { contains: 'options' } },
      });
      if (existingOpen) continue;

      // 2. Skip if we signaled this contract in the last 30 minutes — this
      //    catches non-paper-traded signals (where no position is created)
      //    and provides a brief buffer after a trade closes before re-entry.
      const recentSignal = await db.autoTradeLog.findFirst({
        where: {
          symbol: tradeSymbol,
          createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
        },
      });
      if (recentSignal) continue;

      // 3. Correlated-exposure block — don't let 3+ concurrent options
      //    positions pile into the same sector (they'd all move together on
      //    one sector-wide shock instead of behaving like diversified bets).
      if (sig.sector && (sectorOpenCount[sig.sector] || 0) >= rules.optMaxPerSector) {
        await db.autoTradeLog.create({
          data: {
            action: 'OPT_SECTOR_BLOCKED',
            symbol: tradeSymbol,
            signal: '',
            executed: false,
            reason: `Skipped — ${sectorOpenCount[sig.sector]} positions already open in ${sig.sector} (max ${rules.optMaxPerSector})`,
          },
        });
        continue;
      }

      // 3.5. Index-concentration block — NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY
      // are all driven by the same broad-market beta; don't let them stack
      // up as if they were 4 independent, diversified bets.
      if (INDEX_SYMBOLS.includes(sig.symbol) && openIndexCount >= rules.optMaxIndexPositions) {
        await db.autoTradeLog.create({
          data: {
            action: 'OPT_INDEX_BLOCKED', symbol: tradeSymbol, signal: '', executed: false,
            reason: `Skipped — ${openIndexCount} index positions already open (max ${rules.optMaxIndexPositions}, indices trade as one correlated basket)`,
          },
        });
        continue;
      }

      // 3.6. TOP-10 concurrency cap — the 2026-07-25 concurrency backtest
      // decision (see options-proven-symbols.ts): trade the full TOP-10 for
      // signal coverage, but cap concurrent open TOP-10 stock-options
      // positions at OPT_TOP10_CONCURRENCY_CAP (3) — the lower-drawdown end
      // of the tested TOP-10 scenarios, not the 46.5%-DD cap=5/cap=10 ones.
      if (OPTIONS_TOP10_SYMBOLS.has(sig.symbol) && openTop10Count >= OPT_TOP10_CONCURRENCY_CAP) {
        await db.autoTradeLog.create({
          data: {
            action: 'OPT_TOP10_CAP_BLOCKED', symbol: tradeSymbol, signal: '', executed: false,
            reason: `Skipped — ${openTop10Count} TOP-10 options positions already open (cap ${OPT_TOP10_CONCURRENCY_CAP}, per 2026-07-25 concurrency backtest)`,
          },
        });
        continue;
      }

      // ── Fetch REAL live option premium (+ real delta) from DhanHQ Option Chain ───────
      let premium = 0;
      let realDelta = 0.5;
      let ivCautionPenalty = 0; // 0..1, applied to confidence below (graduated, not a hard block by itself)
      let ivCautionReason = '';
      let ivPercentileSnapshot: number | null = null;
      let ocSummary: { score: number; entrySignal: string; oiAction: string } | null = null;
      try {
        const chain = await fetchDhanOptionChain(sig.symbol, sig.expiry);
        if (chain && chain.chain && chain.chain.length > 0) {
          // Find exact strike, or fall back to NEAREST strike (not middle)
          const row = chain.chain.find(r => r.strike === sig.strike)
            || chain.chain.reduce((closest, r) =>
              Math.abs(r.strike - sig.strike) < Math.abs(closest.strike - sig.strike) ? r : closest
            );
          const quote = sig.direction === 'CE' ? row?.ce : row?.pe;
          if (quote && quote.ltp > 0) {
            premium = quote.ltp;
            realDelta = quote.delta || 0.5;
          }

          // ── IV regime gating (ported from ODSS's iv-percentile.ts +
          // oc-confluence.ts's getIVSpikePct) — only meaningful now that
          // real per-strike IV exists (dhan-option-provider.ts's
          // impliedVolatility() wiring, fixed this same session). Straddle
          // study cited in ODSS's own code (74,515 direction-neutral
          // observations): buying when IV sits in the richest 20% of a
          // symbol's own range is consistently the worst-performing bucket.
          // Matches ODSS's real behavior exactly: percentile alone and a
          // mild spike are graduated confidence penalties (never a hard
          // block by themselves); only a severe spike (>=45%/hr) hard-skips,
          // same as ODSS forcing entrySignal to WAIT at that threshold.
          try {
            const atmRows = chain.chain.filter(r => r.moneyness === 'ATM');
            const ivValues = atmRows.flatMap(r => [r.ce?.iv, r.pe?.iv]).filter((v): v is number => !!v && v > 0);
            if (ivValues.length > 0) {
              const atmIV = ivValues.reduce((a, b) => a + b, 0) / ivValues.length;
              await recordIV(sig.symbol, atmIV);
              const pct = await getIVPercentile(sig.symbol, atmIV);
              ivPercentileSnapshot = pct;
              if (pct !== null && pct >= 0.8) {
                ivCautionPenalty = Math.max(ivCautionPenalty, 0.15);
                ivCautionReason = `IV in richest ${Math.round((1 - pct) * 100)}% for ${sig.symbol} — historically the worst time to buy`;
              }
              const spike = await getIVSpikePct(sig.symbol);
              if (spike !== null && spike >= 25) {
                ivCautionPenalty = Math.max(ivCautionPenalty, 0.15);
                ivCautionReason = `ATM IV +${spike}% in the last hour — premiums expensive`;
                if (spike >= 45) {
                  ivCautionPenalty = 1; // hard skip — mirrors ODSS forcing entrySignal to WAIT at this threshold
                  ivCautionReason = `ATM IV spiked +${spike}% in the last hour — standing down until it settles`;
                }
              }
            }
          } catch { /* no chain / not enough IV history yet — no caution, not a block */ }

          // ── Order-flow / OI confluence (ported from ODSS's oc-confluence.ts) ──
          // Tracks how OI, PCR and ATM delta actually move over 5m/15m/1h and
          // scores whether the REAL option chain agrees with this technical
          // signal — something the confluence scanner never looked at before
          // (it's built entirely from price/structure technicals). Mirrors
          // ODSS's real production behavior: a chain that's actively AVOIDing
          // this direction vetoes the entry for this scan (skip, not a
          // permanent block — it can still fire next scan if the chain
          // turns). ODSS's "promote a WAIT signal to ENTER_NOW" half isn't
          // ported — newswing's signals are pass/fail against the confluence
          // gate already, there's no WAIT tier to promote from.
          try {
            const oc = await updateOCConfluence(sig.symbol, chain, sig.direction);
            if (oc) ocSummary = { score: oc.ocScore, entrySignal: oc.entrySignal, oiAction: oc.oiAction };
            if (oc && oc.entrySignal === 'AVOID') {
              await db.autoTradeLog.create({
                data: {
                  action: 'OPT_OC_VETO', symbol: tradeSymbol, signal: '', executed: false,
                  reason: `Skipped — chain contradicts: ${oc.headline}`,
                },
              });
              continue;
            }
          } catch { /* no chain history yet — no veto, not a block */ }
        }
      } catch (err) {
        console.warn(`[Options Auto-Trade] Real LTP fetch failed for ${sig.symbol} ${sig.strike} ${sig.direction}:`, err);
      }

      if (premium <= 0) continue;

      if (ivCautionPenalty >= 1) {
        await db.autoTradeLog.create({
          data: {
            action: 'OPT_IV_STANDDOWN', symbol: tradeSymbol, signal: '', executed: false,
            reason: `Skipped — ${ivCautionReason}`,
          },
        });
        continue;
      }
      if (ivCautionPenalty > 0) {
        sig.confidence = Math.max(0, sig.confidence - ivCautionPenalty * 100);
      }

      // ── Symbol reputation (ported from ODSS's Conviction DNA, scoped down —
      // see getSymbolReputationAdjustment in signal-recorder.ts) — does THIS
      // symbol actually perform well when picked, regardless of which
      // factors fired? Built on the existing signalRecord data (no new
      // recording infra needed). Returns null (no adjustment) until there's
      // enough independent by-day history — never guesses on thin data.
      let reputationNote: string | undefined;
      try {
        const rep = await getSymbolReputationAdjustment(sig.symbol);
        if (rep) {
          sig.confidence = Math.max(0, Math.min(100, sig.confidence + rep.adjustment));
          reputationNote = rep.reason;
        }
      } catch { /* signalRecord not queryable this cycle — no adjustment, not a block */ }

      // ── Institutional flow bias (real FII/DII net cash-market flow, NSE) —
      // the "smart money" signal Forex already has via real CFTC COT
      // positioning; equity/options had no analogous signal before this.
      // Market-wide (not symbol-specific), so applies the same way to every
      // signal this scan. Modest cap (+-8, smaller than reputation's +-15) —
      // research (2026-07-27) found FII/DII flow is more a lagging
      // confirmation than a leading predictor, so this stays a small nudge,
      // not a strong factor. Returns null (no adjustment) if NSE's real
      // endpoint fails or the combined flow is inside the neutral band.
      let institutionalFlowNote: string | undefined;
      try {
        const flow = await getInstitutionalFlowBias();
        if (flow && flow.adjustment !== 0) {
          sig.confidence = Math.max(0, Math.min(100, sig.confidence + flow.adjustment));
          institutionalFlowNote = flow.reason;
        }
      } catch { /* NSE fetch failed this cycle — no adjustment, not a block */ }

      // ── Structure-based adaptive SL/TP (replaces a flat -25%/+50%) ──────
      // Uses the real underlying spot-distance-to-support/resistance
      // computed at scan time (sig.stopSpotDistance/targetSpotDistance),
      // converted via the REAL fetched premium and REAL delta just above —
      // never a placeholder premium.
      const structureTargets = convertToPremiumTargets(
        { stopSpotDistance: sig.stopSpotDistance, targetSpotDistance: sig.targetSpotDistance },
        realDelta,
        premium
      );
      const sl = Math.round(premium * (1 + structureTargets.stopLossPct / 100) * 100) / 100;
      const tp = Math.round(premium * (1 + structureTargets.targetPct / 100) * 100) / 100;

      // ── Risk-based lot sizing ────────────────────────────────────────
      // riskPerLot = what 1 exchange lot actually loses if SL is hit (premium
      // move * lot size), not the full premium paid — matches how the SL is
      // actually defined (a % move in premium, structureTargets.stopLossPct).
      const riskPerLot = premium * (Math.abs(structureTargets.stopLossPct) / 100) * exchangeLotSize;
      const riskBudget = equityForRisk * (rules.riskPerTradePct / 100);
      const lotsByRisk = riskPerLot > 0 ? Math.floor(riskBudget / riskPerLot) : 0;
      const lotsByCapital = Math.floor(availableCapitalTracker / (premium * exchangeLotSize));
      let lots = Math.min(lotsByRisk, lotsByCapital);
      // Never go below 1 lot purely from the risk budget being tight (a
      // single lot is still allowed if capital covers it) — but never trade
      // if capital genuinely can't cover even 1 lot.
      if (lots < 1 && lotsByCapital >= 1) lots = 1;
      if (optAdaptiveFactor < 1.0) lots = Math.max(1, Math.floor(lots * optAdaptiveFactor));

      if (lots < 1) {
        await db.autoTradeLog.create({
          data: {
            action: 'OPT_INSUFFICIENT_CAPITAL', symbol: tradeSymbol, signal: '', executed: false,
            reason: `Skipped — 1 lot (${exchangeLotSize} qty @ ₹${premium}) needs ₹${(premium * exchangeLotSize).toFixed(0)}, only ₹${availableCapitalTracker.toFixed(0)} available`,
          },
        });
        continue;
      }

      await db.autoTradeLog.create({
        data: {
          action: 'OPT_RISK_SIZING', symbol: tradeSymbol, signal: '', executed: false,
          reason: `Risk sizing: ${lots} lot(s) x ${exchangeLotSize} = ${lots * exchangeLotSize} qty (risk budget ₹${riskBudget.toFixed(0)} @ ${rules.riskPerTradePct}%, risk/lot ₹${riskPerLot.toFixed(0)}, capital cap ${lotsByCapital} lots, adaptive factor ${(optAdaptiveFactor * 100).toFixed(0)}%)`,
        },
      });

      const qty = lots * exchangeLotSize;
      const totalCapNeeded = premium * qty;

      // ── Send Discord Signal Alert ──────────────────────────────────────
      try {
        await sendDiscordSignal({
          symbol: sig.symbol,
          strike: sig.strike,
          optionType: sig.direction,
          expiry: sig.expiry,
          spotPrice: sig.entryPrice,
          premium,
          stopLoss: sl,
          takeProfit: tp,
          lotSize: exchangeLotSize,
          lots,
          totalCapital: totalCapNeeded,
          confluenceScore: sig.confidence,
          stopLossPct: structureTargets.stopLossPct,
          targetPct: structureTargets.targetPct,
          setupType: sig.score >= 40 ? 'A+' : 'B',
          direction: sig.direction === 'CE' ? 'CALL BUY 🟢' : 'PUT BUY 🔴',
          engine: 'OPTIONS',
          dataSource: 'DhanHQ Broker v2 API',
          timestamp: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
          // Visibility only — doesn't affect trading/sizing. Flags the
          // highest-conviction 5-of-the-10 names so signal quality can be
          // eyeballed at a glance without narrowing real trade flow to 5.
          priorityTag: OPTIONS_TOP5_PRIORITY.has(sig.symbol) ? '⭐ TOP-5 PRIORITY' : undefined,
        });
      } catch (discordErr) {
        console.warn('[Discord Options Signal] Alert dispatch failed:', discordErr);
      }

      // ── Log the signal for cooldown tracking ───────────────────────────
      // Every signal is logged so the 30-min cooldown check above can suppress
      // duplicates. ALL eligible signals are now paper-traded (no whitelist).
      const dailyLimitReached = todayEntries >= OPT_DAILY_LIMIT;
      await db.autoTradeLog.create({
        data: {
          action: 'AUTO_ENTRY',
          symbol: tradeSymbol,
          signal: JSON.stringify(sig),
          executed: !dailyLimitReached,
          reason: `Options ${sig.direction} signal @ ₹${premium} (conf:${sig.confidence}, score:${sig.score})${dailyLimitReached ? ' — daily limit reached, signal only' : ''}`,
        },
      });

      // ── Paper Trade Creation: ALL eligible signals (whitelist removed) ──
      if (dailyLimitReached) {
        // Recorder — log the factor breakdown even for signals that didn't
        // get traded, so the validator can later see whether the daily cap
        // is turning away signals that would have won.
        await recordSignal(sig, false);
        continue;
      }

      const createdTrade = await db.paperTrade.create({
        data: {
          symbol: tradeSymbol,
          stockName: `${sig.direction} ${sig.strike} ${sig.expiry}`,
          direction: sig.direction,
          entryDate: new Date(),
          entryPrice: premium,
          qty,
          stopLoss: sl,
          targetPrice: tp,
          status: 'OPEN',
          autoTraded: true,
          // regime-XXX tag feeds the Layer-3 statistical win-rate-by-regime
          // tracker (regime-intelligence.ts) — starts genuinely empty and
          // only becomes meaningful after real trades accumulate.
          tags: `options,intraday,regime-${sig.marketRegime}`,
          notes: JSON.stringify({
            spotPrice: sig.entryPrice,
            strike: sig.strike,
            expiry: sig.expiry,
            confidence: sig.confidence,
            score: sig.score,
            reasons: sig.reasons,
            rsi: sig.rsi,
            adx: sig.adx,
            atrPct: sig.atrPct,
            realLtpFetched: true,
            sector: sig.sector,
            // Multi-engine decision trace (ODSS-inspired — see the port note
            // in Obsidian/worklog): each of these was computed by an
            // independent check (technical confluence already in `score`/
            // `reasons` above; IV-regime, order-flow/OI, and symbol
            // reputation below) that can graduate the final confidence up or
            // down or veto outright. Recorded here so the decision is
            // auditable after the fact, not just a black-box number — and so
            // getSymbolReputationAdjustment() has real data to compound on
            // for future signals on this symbol.
            decisionVote: {
              technicalConfidence: originalTechnicalConfidence,
              ivPercentile: ivPercentileSnapshot,
              ivCautionReason: ivCautionReason || undefined,
              ocConfluence: ocSummary,
              symbolReputation: reputationNote,
              institutionalFlow: institutionalFlowNote,
              finalConfidence: sig.confidence,
            },
          }),
        },
      });

      // Recorder — log this signal's full factor breakdown linked to the
      // trade that will validate it once it closes (see resolveSignalByTradeId
      // in autoOptionsCheckExits). This is what makes real per-factor
      // win-rate attribution possible later via getFactorAttribution().
      await recordSignal(sig, true, createdTrade.id);

      if (sig.sector) sectorOpenCount[sig.sector] = (sectorOpenCount[sig.sector] || 0) + 1;
      if (INDEX_SYMBOLS.includes(sig.symbol)) openIndexCount++;
      if (OPTIONS_TOP10_SYMBOLS.has(sig.symbol)) openTop10Count++;
      availableCapitalTracker -= totalCapNeeded;
      todayEntries++;
      entriesCreated++;
      await db.appSettings.upsert({ where: { key: 'opt_todayEntries' }, update: { value: String(todayEntries) }, create: { key: 'opt_todayEntries', value: String(todayEntries) } });
    }

    // opt_todayEntries is already persisted inside the loop via upsert; refresh lastScanAt only
    await setSchedulerKV('opt_lastScanAt', new Date().toISOString());

    return { signalsGenerated: scanResult.signals.length, entriesCreated, errors };
  } catch (err: any) {
    errors.push(String(err?.message || err));
    return { signalsGenerated: 0, entriesCreated, errors };
  }
}

async function autoOptionsCheckExits(): Promise<{ checked: number; exited: number; errors: string[] }> {
  const errors: string[] = [];
  let checked = 0;
  let exited = 0;

  try {
    const openOptions = await db.paperTrade.findMany({
      where: { status: 'OPEN', tags: { contains: 'options' }, autoTraded: true },
    });

    const minsToClose = timeToClose();
    const isIntradayCloseTime = minsToClose <= 15 && minsToClose > 0; // 3:15 PM IST square-off

    for (const trade of openOptions) {
      checked++;
      try {
        const underlying = trade.symbol.split('_')[0];
        const { price: currentSpot } = await getCurrentPrice(underlying);
        if (!currentSpot) continue;

        const notes = trade.notes ? JSON.parse(trade.notes) : {};
        const direction = trade.direction;
        const expiry = notes.expiry || '';
        const strike = notes.strike || 0;

        // ── Fetch REAL live option premium from DhanHQ Option Chain ───────
        let currentPremium = 0;
        if (expiry && strike > 0) {
          try {
            const chain = await fetchDhanOptionChain(underlying, expiry);
            if (chain && chain.chain && chain.chain.length > 0) {
              // Exact strike, or fall back to NEAREST strike (matches the entry
              // path). The live chain only returns a window of strikes around the
              // CURRENT ATM, so a trending underlying can push this position's
              // original strike outside that window even though Dhan is healthy.
              const row = chain.chain.find(r => r.strike === strike)
                || chain.chain.reduce((closest, r) =>
                  Math.abs(r.strike - strike) < Math.abs(closest.strike - strike) ? r : closest
                );
              const quote = direction === 'CE' ? row?.ce : row?.pe;
              if (quote && quote.ltp > 0) {
                currentPremium = quote.ltp;
              }
            }
          } catch { /* handled below */ }
        }

        const hasRealPremium = currentPremium > 0;
        const isNewTradingDay = new Date(trade.entryDate).toDateString() !== new Date().toDateString();
        const mustSquareOffNow = isIntradayCloseTime || isNewTradingDay;

        if (!hasRealPremium && !mustSquareOffNow) {
          // No real premium this cycle (token expired, chain down, or the
          // contract fell outside Dhan's returned strike window) and no
          // mandatory close pending — hold the position and retry next tick
          // rather than fabricating a synthetic premium via an arbitrary
          // delta-like formula to decide a real SL/TP exit.
          continue;
        }
        if (!hasRealPremium) {
          // Mandatory square-off (3:15 PM or day rollover) with no live quote
          // available — close flat at the real entry price rather than
          // inventing a directional price move.
          currentPremium = trade.entryPrice;
        }

        let exitReason: string | null = null;
        let exitPrice = currentPremium;

        // 1. Check Fixed SL (-25%) — only on a real premium
        if (hasRealPremium && currentPremium <= trade.stopLoss) {
          exitReason = 'SL_HIT';
          exitPrice = trade.stopLoss;
        }
        // 2. Check Fixed TP (+50%) — only on a real premium
        else if (hasRealPremium && currentPremium >= trade.targetPrice) {
          exitReason = 'TP_HIT';
          exitPrice = trade.targetPrice;
        }
        // 3. Mandatory Intraday 3:15 PM Exit (No Overnight Carry)
        else if (isIntradayCloseTime) {
          exitReason = 'INTRADAY_315PM_SQUAREOFF';
          exitPrice = currentPremium;
        }
        else if (isNewTradingDay) {
          exitReason = 'EXPIRY_CLOSE';
        }

        if (exitReason) {
          const grossPnl = (exitPrice - trade.entryPrice) * trade.qty;
          const lotSize = 1; // 1 lot
          const costs = calculateOptionsCosts(trade.entryPrice, exitPrice, lotSize, trade.qty, 'BUY', underlying);
          const netPnl = grossPnl - costs.totalCosts;
          const pnlPercent = ((exitPrice / trade.entryPrice) - 1) * 100;

          await db.paperTrade.update({
            where: { id: trade.id },
            data: {
              status: 'CLOSED',
              exitDate: new Date(),
              exitPrice: Math.round(exitPrice * 100) / 100,
              pnl: Math.round(netPnl * 100) / 100,
              pnlPercent: Math.round(pnlPercent * 100) / 100,
              grossPnl: Math.round(grossPnl * 100) / 100,
              netPnl: Math.round(netPnl * 100) / 100,
              totalCosts: Math.round(costs.totalCosts * 100) / 100,
              brokerageCost: Math.round(costs.brokerage * 100) / 100,
              sttCost: Math.round(costs.stt * 100) / 100,
              slippageCost: Math.round(costs.slippage * 100) / 100,
              otherCharges: Math.round((costs.exchangeCharges + costs.gst + costs.sebiFees + costs.stampDuty) * 100) / 100,
              exitReason,
            },
          });

          // Credit Net P&L to wallet
          const w = await getWallet();
          await db.capitalWallet.update({
            where: { id: w.id },
            data: {
              realizedPnl: Math.round((w.realizedPnl + netPnl) * 100) / 100,
              totalCostsPaid: Math.round(((w.totalCostsPaid || 0) + costs.totalCosts) * 100) / 100,
            },
          });

          // Feed the options daily-P&L guardrail (opt_todayPnl) — previously
          // this key was only ever read by the status endpoint and never
          // written anywhere, so the daily loss cap / profit lock in
          // autoOptionsScanAndTrade() had nothing real to check against.
          const prevOptTodayPnl = parseFloat((await db.appSettings.findUnique({ where: { key: 'opt_todayPnl' } }))?.value || '0');
          const newOptTodayPnl = Math.round((prevOptTodayPnl + netPnl) * 100) / 100;
          await db.appSettings.upsert({ where: { key: 'opt_todayPnl' }, update: { value: String(newOptTodayPnl) }, create: { key: 'opt_todayPnl', value: String(newOptTodayPnl) } });

          // Adaptive de-risking — mirrors the equity swing engine's
          // consecutive-loss streak tracking (see autoScanAndTrade), now
          // applied to the options book with its own independent counter.
          if (netPnl < 0) {
            const prevStreak = parseInt((await db.appSettings.findUnique({ where: { key: 'opt_consecutiveLosses' } }))?.value || '0', 10);
            await setSchedulerKV('opt_consecutiveLosses', String(prevStreak + 1));
          } else {
            await setSchedulerKV('opt_consecutiveLosses', '0');
          }

          // Validator — stamp the real outcome back onto this trade's
          // recorded signal so getFactorAttribution() can compute real
          // per-factor win rates from actual forward results.
          await resolveSignalByTradeId(trade.id, netPnl > 0, netPnl);

          await db.autoTradeLog.create({
            data: {
              action: 'AUTO_EXIT_' + exitReason,
              symbol: trade.symbol,
              tradeId: trade.id,
              signal: '',
              executed: true,
              reason: `${exitReason} @ ₹${exitPrice.toFixed(2)} | Gross: ₹${grossPnl.toFixed(2)} | Costs: ₹${costs.totalCosts.toFixed(2)} | Net: ₹${netPnl.toFixed(2)}`,
            },
          });

          // ── Discord exit outcome notification — previously an options
          //    position got an entry alert and then permanent silence on
          //    how it resolved (sendDiscordPaperResult was only wired to a
          //    manual test endpoint, never called from the live exit path). ──
          try {
            const { sendDiscordPaperResult } = await import('@/lib/notifications/discord');
            const status: 'WIN' | 'LOSS' | 'OPEN' = netPnl > 0 ? 'WIN' : netPnl < 0 ? 'LOSS' : 'OPEN';
            await sendDiscordPaperResult({
              signal: {
                symbol: underlying,
                strike,
                optionType: direction as 'CE' | 'PE',
                expiry,
                spotPrice: notes.spotPrice || trade.entryPrice,
                premium: trade.entryPrice,
                stopLoss: trade.stopLoss,
                takeProfit: trade.targetPrice,
                lotSize: trade.qty,
                lots: 1,
                totalCapital: trade.entryPrice * trade.qty,
                confluenceScore: notes.confidence || 0,
                setupType: (notes.score || 0) >= 40 ? 'A+' : 'B',
                direction: direction === 'CE' ? 'CALL BUY 🟢' : 'PUT BUY 🔴',
                engine: 'OPTIONS',
                dataSource: 'DhanHQ Broker v2 API',
                timestamp: trade.entryDate.toISOString(),
              },
              exitPremium: exitPrice,
              pnl: Math.round(netPnl * 100) / 100,
              pnlPct: Math.round(pnlPercent * 100) / 100,
              exitReason,
              exitAt: new Date().toISOString(),
              status,
            });
          } catch (discordErr) {
            console.warn('[Discord] Options exit notification failed (non-blocking):', discordErr);
          }

          exited++;
        }
      } catch (e) {
        // Skip individual errors
      }
    }

    await setSchedulerKV('opt_lastExitAt', new Date().toISOString());
    return { checked, exited, errors };
  } catch (err: any) {
    errors.push(String(err?.message || err));
    return { checked, exited, errors };
  }
}

async function getOptionsStatus() {
  const openOptions = await db.paperTrade.findMany({
    where: { status: 'OPEN', tags: { contains: 'options' }, autoTraded: true },
    orderBy: { entryDate: 'desc' },
  });
  const recentOptsLogs = await db.autoTradeLog.findMany({
    where: { symbol: { contains: '_CE' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  // Also get PE logs
  const peLogs = await db.autoTradeLog.findMany({
    where: { symbol: { contains: '_PE' } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  // Guardrail-engine events (circuit breaker / profit lock / sector block) —
  // these don't carry a _CE/_PE symbol so the two queries above miss them.
  const guardrailLogs = await db.autoTradeLog.findMany({
    where: { action: { in: ['OPT_CIRCUIT_BREAKER', 'OPT_PROFIT_LOCK', 'OPT_SECTOR_BLOCKED'] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const allOptLogs = [...recentOptsLogs, ...peLogs, ...guardrailLogs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 30);

  const s = await db.appSettings.findMany();
  const m: Record<string, string> = {};
  for (const x of s) m[x.key] = x.value;
  const rules = await getRules();
  const optTodayPnl = parseFloat(m['opt_todayPnl'] || '0');
  const walletForGuardrails = await getWallet();
  const dailyLossCapAmount = walletForGuardrails.totalCapital * (rules.optDailyLossCapPct / 100);
  const dailyProfitLockAmount = walletForGuardrails.totalCapital * (rules.optDailyProfitLockPct / 100);
  const { drawdownPct: portfolioDrawdownPct } = await getPortfolioDrawdown();

  return {
    enabled: m['opt_enabled'] !== 'false', // always-on: default true unless explicitly 'false'
    openPositions: openOptions.length,
    todayEntries: parseInt(m['opt_todayEntries'] || '0'),
    todayExits: parseInt(m['opt_todayExits'] || '0'),
    todayPnl: optTodayPnl,
    guardrails: {
      dailyLossCap: Math.round(dailyLossCapAmount),
      dailyLossCapPct: rules.optDailyLossCapPct,
      dailyProfitLock: Math.round(dailyProfitLockAmount),
      dailyProfitLockPct: rules.optDailyProfitLockPct,
      lossCapHit: optTodayPnl <= -dailyLossCapAmount,
      profitLockHit: optTodayPnl >= dailyProfitLockAmount,
      portfolioDrawdownPct: Math.round(portfolioDrawdownPct * 10) / 10,
      maxDrawdownPct: rules.maxDrawdownPct,
      drawdownBreakerActive: portfolioDrawdownPct >= rules.maxDrawdownPct,
      maxPerSector: rules.optMaxPerSector,
      maxIndexPositions: rules.optMaxIndexPositions,
      noEntryMinsToClose: rules.optNoEntryMinsToClose,
      consecutiveLosses: parseInt(m['opt_consecutiveLosses'] || '0', 10),
      adaptiveFactor: getAdaptiveFactor(parseInt(m['opt_consecutiveLosses'] || '0', 10), rules),
    },
    lastScanAt: m['opt_lastScanAt'] || null,
    lastExitAt: m['opt_lastExitAt'] || null,
    openTrades: openOptions,
    recentLogs: allOptLogs,
  };
}

declare global {
  var _autoTradeTimer: NodeJS.Timeout | undefined;
}

if (!globalThis._autoTradeTimer) {
  globalThis._autoTradeTimer = setInterval(() => {
    runSchedulerTick().catch((err) => {
      console.warn('[AutoTrade Timer] Background tick warning:', String(err).substring(0, 100));
    });
  }, 30_000);
}

// ── API Endpoints ──────────────────────────────────────
export async function GET() {
  try {
    // NOTE: Do NOT await runSchedulerTick() here — it scans 399 stocks and
    // takes 2+ minutes, which would block the GET response and freeze the UI.
    // The background setInterval timer (30s) already handles scheduler ticks.
    // Fire-and-forget to nudge the timer if it hasn't run yet.
    runSchedulerTick().catch(() => null);

    // Return cached wallet state (don't fetch live prices on every poll —
    // that's the background timer's job). recalcWallet() fetches live prices
    // for ALL open positions which can take 30+ seconds.
    const wallet = await getWallet();
    const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN', autoTraded: true }, orderBy: { entryDate: 'desc' } });
    const recentLogs = await db.autoTradeLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const rules = await getRules();
    const scheduler = await getSchedulerState();
    const sectorAlloc = await getSectorAllocation();
    // Skip live drawdown calc on GET (it fetches prices for all open positions)
    // — use the persisted peakCapital and current wallet total instead
    const drawdownPct = wallet.peakCapital > 0
      ? Math.max(0, ((wallet.peakCapital - wallet.totalCapital) / wallet.peakCapital) * 100)
      : 0;
    const optionsStatus = await getOptionsStatus();
    const { getDiscordHealthStatus } = await import('@/lib/notifications/discord');
    return NextResponse.json({
      success: true, wallet, rules, openTrades, recentLogs, scheduler, sectorAllocation: sectorAlloc,
      marketHours: isMarketHours(), timeToClose: timeToClose(),
      // v2 data
      drawdown: { drawdownPct: Math.round(drawdownPct * 100) / 100, peakCapital: wallet.peakCapital || wallet.initialCapital, currentCapital: wallet.totalCapital },
      consecutiveLosses: scheduler.consecutiveLosses,
      adaptiveFactor: scheduler.lastAdaptiveFactor,
      // Options data
      options: optionsStatus,
      // Real Discord delivery health — replaces the sidebar's previously
      // hardcoded "ACTIVE" badge with the actual outcome of the last send.
      discordHealth: getDiscordHealthStatus(),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action: string = body.action || 'get_status';
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };

    switch (action) {
      case 'scan_and_trade': {
        const result = await autoScanAndTrade(config, body.bypassRegime === true);
        return NextResponse.json({ success: true, action, ...result });
      }
      case 'check_exits': {
        const result = await autoCheckExits();
        return NextResponse.json({ success: true, action, ...result });
      }
      case 'scheduler_tick': {
        const result = await runSchedulerTick();
        return NextResponse.json({ success: true, action, ...result });
      }
      case 'scheduler_toggle': {
        const enabled = body.enabled;
        if (enabled) {
          const now = new Date();
          const state = await getSchedulerState();
          const scanMin = body.scanIntervalMin || state.scanIntervalMin;
          const exitMin = body.exitIntervalMin || state.exitIntervalMin;
          await setSchedulerKV('sched_enabled', 'true');
          await setSchedulerKV('sched_scanIntervalMin', String(scanMin));
          await setSchedulerKV('sched_exitIntervalMin', String(exitMin));
          await setSchedulerKV('sched_nextScanAt', now.toISOString());
          await setSchedulerKV('sched_nextExitAt', now.toISOString());
          await resetDailyCounters();
        } else {
          await setSchedulerKV('sched_enabled', 'false');
          await setSchedulerKV('sched_nextScanAt', '');
          await setSchedulerKV('sched_nextExitAt', '');
        }
        return NextResponse.json({ success: true, scheduler: await getSchedulerState() });
      }
      case 'update_wallet': {
        const { totalCapital } = body;
        if (totalCapital) {
          const w = await getWallet();
          const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
          const deployed = open.reduce((s, t) => s + t.entryPrice * t.qty, 0);
          await db.capitalWallet.update({ where: { id: w.id }, data: { totalCapital, available: totalCapital - deployed } });
          const updated = await recalcWallet();
          return NextResponse.json({ success: true, wallet: updated });
        }
        break;
      }
      case 'update_rules': {
        const rules = body.rules;
        if (rules) {
          for (const [key, value] of Object.entries(rules)) {
            await db.appSettings.upsert({
              where: { key: `rules_${key}` },
              create: { key: `rules_${key}`, value: String(value) },
              update: { value: String(value) },
            });
          }
          return NextResponse.json({ success: true, rules: await getRules() });
        }
        break;
      }
      case 'reset_circuit_breaker': {
        // v2: Manual circuit breaker reset
        await setSchedulerKV('sched_circuitBreaker', 'false');
        await setSchedulerKV('sched_circuitBreakerReason', '');
        return NextResponse.json({ success: true, scheduler: await getSchedulerState() });
      }
      // ── Options Auto-Trade Actions ──
      case 'options_scan_and_trade': {
        const minConf = typeof body.minConfidence === 'number' ? body.minConfidence : 55;
        const minScore = typeof body.minScore === 'number' ? body.minScore : 40;
        const result = await autoOptionsScanAndTrade(minConf, minScore);
        return NextResponse.json({ success: true, action, ...result });
      }
      case 'options_check_exits': {
        const result = await autoOptionsCheckExits();
        return NextResponse.json({ success: true, action, ...result });
      }
      case 'options_status': {
        const status = await getOptionsStatus();
        return NextResponse.json({ success: true, action, ...status });
      }
      case 'options_toggle': {
        const enabled = body.enabled;
        await setSchedulerKV('opt_enabled', String(!!enabled));
        if (enabled) {
          const now = new Date();
          // Initialize options scheduler cadence so runSchedulerTick picks it up
          await setSchedulerKV('opt_nextScanAt', now.toISOString());
          await setSchedulerKV('opt_nextExitAt', now.toISOString());
          await setSchedulerKV('opt_scanIntervalMin', String(typeof body.scanIntervalMin === 'number' ? body.scanIntervalMin : 15));
          await setSchedulerKV('opt_exitIntervalMin', String(typeof body.exitIntervalMin === 'number' ? body.exitIntervalMin : 1));
        } else {
          await setSchedulerKV('opt_nextScanAt', '');
          await setSchedulerKV('opt_nextExitAt', '');
        }
        return NextResponse.json({ success: true, options: await getOptionsStatus() });
      }
      case 'health_check': {
        const { sendDiscordHealthCheck } = await import('@/lib/notifications/discord');
        const report = await buildSystemHealthReport();
        const sent = await sendDiscordHealthCheck(report);
        return NextResponse.json({ success: true, sent, report });
      }
    }
    const wallet = await recalcWallet();
    return NextResponse.json({ success: true, wallet });
  } catch (error) {
    console.error('Auto-trade error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

async function buildSystemHealthReport() {
  const { sendDiscordHealthCheck } = await import('@/lib/notifications/discord');
  type HealthCheckReport = import('@/lib/notifications/discord').HealthCheckReport;
  const w = await recalcWallet();
  const rules = await getRules();
  const st = await getSchedulerState();
  const optStatus = await getOptionsStatus();
  const { drawdownPct } = await getPortfolioDrawdown();
  const mHours = isMarketHours();
  const minsToClose = timeToClose();

  const openEquityCount = (await db.paperTrade.findMany({ where: { status: 'OPEN', autoTraded: true } })).length;
  const openOptCount = optStatus.openPositions;

  // Check DhanHQ token health (root cause of "no live data" when expired)
  const dhanStatus = checkDhanHQTokenExpiry();

  // Determine Equity Trading Reason
  let equityReason = 'ℹ️ Engine scanning 500+ NSE universe. No new A+ setup met min 1.5 R:R threshold';
  if (!mHours) {
    equityReason = '🌙 Market is closed (Trading hours: 9:15 AM – 3:30 PM IST)';
  } else if (dhanStatus.expired) {
    equityReason = dhanStatus.message + ' (equity falling back to Yahoo Finance)';
  } else if (st.circuitBreaker) {
    equityReason = `🚨 HALTED: Circuit Breaker active (${st.circuitBreakerReason})`;
  } else if (st.niftyRegime === 'BEARISH' && rules.niftyRegimeFilter) {
    equityReason = '🛑 BLOCKED: Nifty is in Bearish Regime (< EMA200). New longs paused for risk protection.';
  } else if (openEquityCount >= rules.maxTotalPositions) {
    equityReason = `🛑 BLOCKED: Max position limit reached (${openEquityCount}/${rules.maxTotalPositions})`;
  } else if (w.available < 25000) {
    equityReason = `🛑 BLOCKED: Insufficient available capital (₹${w.available.toFixed(0)} < min trade allocation)`;
  }

  // Determine Options Trading Reason
  let optReason = 'ℹ️ DhanHQ Live Feed Active. No ATM momentum breakout setup triggered on indices/stocks';
  if (!mHours) {
    optReason = '🌙 Market is closed (Intraday Options trade 9:15 AM – 3:15 PM IST)';
  } else if (dhanStatus.expired) {
    // Options chain has NO Yahoo fallback — expired token means zero options signals
    optReason = dhanStatus.message + ' — options chain UNAVAILABLE (no fallback)';
  } else if (!optStatus.enabled) {
    optReason = '⏸️ Options Auto-Trader is currently disabled in app settings';
  } else if (optStatus.todayEntries >= 50) {
    optReason = '🛑 Daily options entry limit (50) reached';
  }

  const report: HealthCheckReport = {
    marketHours: mHours,
    timeToCloseMins: minsToClose,
    engineStatus: st.circuitBreaker ? 'HALTED' : mHours ? 'ACTIVE' : 'IDLE',
    circuitBreaker: st.circuitBreaker,
    circuitBreakerReason: st.circuitBreakerReason,
    niftyRegime: st.niftyRegime || 'UNKNOWN',
    equity: {
      enabled: st.enabled,
      openPositions: openEquityCount,
      maxPositions: rules.maxTotalPositions,
      lastScanStatus: st.lastScanAt ? `Last scan @ ${new Date(st.lastScanAt).toLocaleTimeString()}` : 'No scan yet',
      tradeReason: equityReason,
    },
    options: {
      enabled: optStatus.enabled,
      openPositions: openOptCount,
      lastScanStatus: optStatus.lastScanAt ? `Last scan @ ${new Date(optStatus.lastScanAt).toLocaleTimeString()}` : 'No scan yet',
      tradeReason: optReason,
    },
    wallet: {
      totalCapital: w.totalCapital,
      availableCapital: w.available,
      deployedCapital: w.deployed,
      realizedPnl: w.realizedPnl,
      peakCapital: w.peakCapital || w.initialCapital,
    },
  };

  return report;
}