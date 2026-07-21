/**
 * PMS Auto-Trade Engine v2 — Professional Portfolio Management System
 *
 * v2 Enhancements over v1:
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
import { getHistoricalData, getCurrentPrice } from '@/lib/trading/data-provider';
import { getFullUniverse, runL1Filter, type NSEStock } from '@/lib/trading/universe-scanner';
import { scanOptionsUniverse, type OptionsSignal } from '@/lib/trading/options-scanner';
import { EMA, ATR } from 'technicalindicators';
import { db } from '@/lib/db';

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
}

const DEFAULT_RULES: PositionRules = {
  maxPerStock: 50000, maxBuysPerMonth: 3, maxHoldingDays: 25,
  maxTotalPositions: 8, riskPerTradePct: 1.0,
  trailingStopR: 1.5, trailToR: 0.5, partialBookR: 2.0, partialBookPct: 30,
  cooldownDays: 3, maxSectorPct: 35, timeExitMins: 30,
  // v2 defaults
  maxDrawdownPct: 8,               // 8% max drawdown before circuit breaker
  dailyLossLimit: 5000,            // ₹5000 daily loss limit
  niftyRegimeFilter: true,         // Enable Nifty EMA200 filter
  atrTrailMultiplier: 2.0,         // 2x ATR trailing stop
  adaptiveSizing: true,            // Enable adaptive sizing
  streakPenaltyPct: 20,            // 20% size reduction per loss after 3 consecutive
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
  enabled: false, scanIntervalMin: 30, exitIntervalMin: 5,
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
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930;
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
      niftyRegimeFilter: m['rules_niftyRegimeFilter'] !== 'false',
      atrTrailMultiplier: parseFloat(m['rules_atrTrailMultiplier'] || '') || DEFAULT_RULES.atrTrailMultiplier,
      adaptiveSizing: m['rules_adaptiveSizing'] !== 'false',
      streakPenaltyPct: parseFloat(m['rules_streakPenaltyPct'] || '') || DEFAULT_RULES.streakPenaltyPct,
    };
  } catch { return DEFAULT_RULES; }
}

async function getSchedulerState(): Promise<SchedulerState> {
  try {
    const s = await db.appSettings.findMany();
    const m: Record<string, string> = {};
    for (const x of s) m[x.key] = x.value;
    return {
      enabled: m['sched_enabled'] === 'true',
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

async function getWallet() {
  let w = await db.capitalWallet.findFirst();
  if (!w) w = await db.capitalWallet.create({ data: { totalCapital: 200000, initialCapital: 200000, available: 200000 } });
  return w;
}

async function recalcWallet() {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const deployed = open.reduce((s, t) => s + t.entryPrice * t.qty, 0);
  const total = w.totalCapital + w.realizedPnl;
  let unrealizedPnl = 0;
  const syms = [...new Set(open.map(t => t.symbol))];
  for (const sym of syms) {
    try {
      const { price } = await getCurrentPrice(sym);
      for (const t of open.filter(t => t.symbol === sym)) {
        unrealizedPnl += (price - t.entryPrice) * t.qty;
      }
    } catch { /* skip */ }
  }
  await db.capitalWallet.update({ where: { id: w.id }, data: { deployed, available: total - deployed, unrealizedPnl, totalCapital: total } });
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
    try {
      const { price } = await getCurrentPrice(sym);
      for (const t of open.filter(t => t.symbol === sym)) {
        unrealizedPnl += (price - t.entryPrice) * t.qty;
      }
    } catch { /* skip */ }
  }

  const currentCapital = w.totalCapital + unrealizedPnl;
  // Peak = highest totalCapital value we've seen (initial + best realized)
  const peakCapital = Math.max(w.initialCapital, w.totalCapital + w.realizedPnl, currentCapital);
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
async function getATRTrailLevel(symbol: string, entryPrice: number, currentPrice: number, risk: number, rules: PositionRules): Promise<{ useATR: boolean; trailLevel: number; atr: number }> {
  if (rules.atrTrailMultiplier <= 0) {
    // Use fixed R-based trail (v1 behavior)
    const trailLevel = entryPrice + (risk * rules.trailToR);
    return { useATR: false, trailLevel, atr: 0 };
  }

  try {
    const { data } = await getHistoricalData(symbol, 30);
    if (data.length < 14) return { useATR: false, trailLevel: entryPrice + (risk * rules.trailToR), atr: 0 };

    const atrArr = ATR.calculate({
      period: 14,
      high: data.map(c => c.high),
      low: data.map(c => c.low),
      close: data.map(c => c.close),
    });
    if (atrArr.length === 0) return { useATR: false, trailLevel: entryPrice + (risk * rules.trailToR), atr: 0 };

    const atr = atrArr[atrArr.length - 1];
    // Trail level = highest close seen - ATR * multiplier (stored in notes, or use current price as proxy)
    // Since we don't track the high-water mark in DB, use: max(current, entry) - ATR * multiplier
    const highWaterMark = Math.max(currentPrice, entryPrice);
    const trailLevel = highWaterMark - (atr * rules.atrTrailMultiplier);
    return { useATR: true, trailLevel: Math.round(trailLevel * 100) / 100, atr: Math.round(atr * 100) / 100 };
  } catch {
    return { useATR: false, trailLevel: entryPrice + (risk * rules.trailToR), atr: 0 };
  }
}

// ── Gate Checks (v2 enhanced canOpen) ───────────────────
async function canOpen(symbol: string, entryPrice: number, qty: number, rules: PositionRules, sector?: string): Promise<{ ok: boolean; reason: string }> {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
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

  // Max positions check
  if (open.length >= rules.maxTotalPositions) return { ok: false, reason: `Max ${rules.maxTotalPositions} positions` };

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

  return { ok: true };
}

// ── Core Engine: Scan & Auto-Enter (v2) ────────────────
async function autoScanAndTrade(config: ScreeningConfig) {
  const rules = await getRules();
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

  if (rules.niftyRegimeFilter && regime.regime === 'BEARISH') {
    return {
      entries, skipped: [{ symbol: 'FILTER', reason: `Nifty regime BEARISH (Close ${regime.currentClose} < EMA200 ${regime.ema200})` }],
      l1Passed: 0, l2Signals: 0, totalScanned: stocks.length, circuitBreaker: false, niftyRegime,
    };
  }

  // v2: Circuit breaker & daily loss check
  await resetDailyCounters();
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

  // L2 V-Swing + auto-enter with v2 enhancements
  for (const { stock, data } of l1Pass) {
    try {
      const signal = runScreening(stock.symbol, data, niftyData, config);
      if (!signal) { skipped.push({ symbol: stock.symbol, reason: 'No V-Swing signal' }); continue; }

      // v2: Apply adaptive sizing
      let qty = signal.setupType === 'A+' ? signal.sizing.qtyA : signal.sizing.qtyB;
      if (adaptiveFactor < 1.0) {
        const adjustedQty = Math.max(1, Math.floor(qty * adaptiveFactor));
        skipped.push({
          symbol: stock.symbol, reason: `Adaptive sizing: ${qty} → ${adjustedQty} (${(adaptiveFactor * 100).toFixed(0)}% factor, ${consLosses} consecutive losses)`,
        });
        // Only show as info, still proceed with adjusted qty
        qty = adjustedQty;
      }
      if (qty <= 0) { skipped.push({ symbol: stock.symbol, reason: 'Qty=0' }); continue; }

      const check = await canOpen(stock.symbol, signal.entryPrice, qty, rules, stock.sector);
      if (!check.ok) { skipped.push({ symbol: stock.symbol, reason: check.reason }); continue; }

      const trade = await db.paperTrade.create({
        data: {
          symbol: stock.symbol, stockName: stock.name, direction: 'LONG',
          entryDate: new Date(), entryPrice: signal.entryPrice, qty,
          stopLoss: signal.stopLoss, targetPrice: signal.targetPrice,
          autoTraded: true,
          notes: `AUTO | ${signal.setupType} | Score:${signal.score}/6 | R:R:${signal.riskReward}x | Regime:${niftyRegime} | Factor:${(adaptiveFactor * 100).toFixed(0)}%`,
          tags: `auto,${signal.setupType === 'A+' ? 'aplus' : 'b'},score-${signal.score},${stock.sector || ''}`.replace(/,$/, ''),
        },
      });
      await db.autoTradeLog.create({
        data: {
          action: 'AUTO_ENTRY', symbol: stock.symbol, tradeId: trade.id,
          signal: JSON.stringify(signal), executed: true,
          reason: `${signal.setupType} | Score ${signal.score}/6 | Qty ${qty} | R:R ${signal.riskReward}x | Factor:${(adaptiveFactor * 100).toFixed(0)}%`,
        },
      });

      await resetDailyCounters();
      const st2 = await getSchedulerState();
      await setSchedulerKV('sched_todayEntries', String(st2.todayEntries + 1));
      await setSchedulerKV('sched_scanCount', String(st2.scanCount + 1));

      entries.push({
        symbol: stock.symbol, setupType: signal.setupType, score: signal.score,
        entryPrice: signal.entryPrice, qty, tradeId: trade.id,
        adaptiveFactor, niftyRegime,
      });
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
  const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN' }, orderBy: { entryDate: 'asc' } });
  const exits: any[] = [];
  const holding: any[] = [];
  const partialBooks: any[] = [];
  const warnings: any[] = [];

  const minsToClose = timeToClose();
  const shouldTimeExit = minsToClose <= rules.timeExitMins && minsToClose > 0;

  for (const trade of openTrades) {
    try {
      const { price: cp } = await getCurrentPrice(trade.symbol);
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
        const trail = await getATRTrailLevel(trade.symbol, trade.entryPrice, cp, risk, rules);
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
            const bookPnl = (cp - trade.entryPrice) * bookQty;
            await db.paperTrade.update({
              where: { id: trade.id },
              data: { qty: remainingQty, tags: (trade.tags ? trade.tags + ',' : '') + 'partial-booked' },
            });
            const w = await getWallet();
            await db.capitalWallet.update({ where: { id: w.id }, data: { realizedPnl: w.realizedPnl + bookPnl } });
            await db.autoTradeLog.create({
              action: 'PARTIAL_BOOK', symbol: trade.symbol, tradeId: trade.id,
              executed: true, reason: `Booked ${bookQty}/${trade.qty + bookQty} at ${rMultiple.toFixed(1)}R | P&L: ₹${bookPnl.toLocaleString()}`,
            });
            partialBooks.push({ symbol: trade.symbol, bookedQty: bookQty, remainingQty, rMultiple, pnl: bookPnl, exitPrice: cp });
          }
        }
      }

      // Execute full exit
      if (shouldExit) {
        const pnl = (exitPrice - trade.entryPrice) * exitQty;
        const pnlPct = ((exitPrice - trade.entryPrice) / trade.entryPrice) * 100;
        await db.paperTrade.update({
          where: { id: trade.id },
          data: { status: 'CLOSED', exitDate: new Date(), exitPrice, pnl, pnlPercent: pnlPct, exitReason: reason },
        });
        const w = await getWallet();
        await db.capitalWallet.update({ where: { id: w.id }, data: { realizedPnl: w.realizedPnl + pnl } });
        await db.autoTradeLog.create({
          action: `AUTO_EXIT_${reason}`, symbol: trade.symbol, tradeId: trade.id,
          executed: true, reason: `${reason} | ₹${trade.entryPrice}→₹${exitPrice} | P&L: ₹${pnl.toLocaleString()} | ${rMultiple.toFixed(1)}R`,
        });

        // v2: Track consecutive losses for adaptive sizing
        if (pnl < 0) {
          const newStreak = (await getSchedulerState()).consecutiveLosses + 1;
          await setSchedulerKV('sched_consecutiveLosses', String(newStreak));
        } else {
          await setSchedulerKV('sched_consecutiveLosses', '0');
          // Reset adaptive factor on win
          await setSchedulerKV('sched_lastAdaptiveFactor', '1');
        }

        await resetDailyCounters();
        const st2 = await getSchedulerState();
        await setSchedulerKV('sched_todayExits', String(st2.todayExits + 1));
        await setSchedulerKV('sched_todayPnl', String(st2.todayPnl + pnl));

        // v2: Check if we need to activate daily loss circuit breaker
        const updatedSt = await getSchedulerState();
        if (updatedSt.todayPnl < 0 && Math.abs(updatedSt.todayPnl) >= rules.dailyLossLimit) {
          await setSchedulerKV('sched_circuitBreaker', 'true');
          await setSchedulerKV('sched_circuitBreakerReason', `Daily loss ₹${Math.abs(updatedSt.todayPnl).toFixed(0)} >= ₹${rules.dailyLossLimit}`);
        }

        exits.push({
          symbol: trade.symbol, exitReason: reason, entryPrice: trade.entryPrice, exitPrice,
          pnl, pnlPercent: pnlPct, holdingDays: days, rMultiple: rMultiple.toFixed(2),
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

// ── Scheduler Control ──────────────────────────────────
async function runSchedulerTick() {
  if (!isMarketHours()) return { marketHours: false, message: 'Market closed' };
  const state = await getSchedulerState();
  if (!state.enabled) return { marketHours: true, enabled: false };

  await resetDailyCounters();
  const now = new Date();
  const results: any = { scanResult: null, exitResult: null };

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
    const nextExit = new Date(state.nextExitAt);
    if (now >= nextExit) {
      results.exitResult = await autoCheckExits();
      await setSchedulerKV('sched_lastExitAt', now.toISOString());
      const next = new Date(now.getTime() + state.exitIntervalMin * 60000);
      await setSchedulerKV('sched_nextExitAt', next.toISOString());
    }
  }

  return { ...results, marketHours: true, enabled: true, schedulerState: await getSchedulerState() };
}

// ── API Endpoints ──────────────────────────────────────
export async function GET() {
  try {
    const wallet = await recalcWallet();
    const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN', autoTraded: true }, orderBy: { entryDate: 'desc' } });
    const recentLogs = await db.autoTradeLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const rules = await getRules();
    const scheduler = await getSchedulerState();
    const sectorAlloc = await getSectorAllocation();
    const { drawdownPct, peakCapital, currentCapital } = await getPortfolioDrawdown();
    return NextResponse.json({
      success: true, wallet, rules, openTrades, recentLogs, scheduler, sectorAllocation: sectorAlloc,
      marketHours: isMarketHours(), timeToClose: timeToClose(),
      // v2 data
      drawdown: { drawdownPct: Math.round(drawdownPct * 100) / 100, peakCapital, currentCapital },
      consecutiveLosses: scheduler.consecutiveLosses,
      adaptiveFactor: scheduler.lastAdaptiveFactor,
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
        const result = await autoScanAndTrade(config);
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
    }
    const wallet = await recalcWallet();
    return NextResponse.json({ success: true, wallet });
  } catch (error) {
    console.error('Auto-trade error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}