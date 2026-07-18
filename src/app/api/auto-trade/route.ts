/**
 * PMS Auto-Trade Engine API
 * Full automation: scan, enter, trail stops, partial book, exit, scheduler
 */
import { NextRequest, NextResponse } from 'next/server';
import { runScreening, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData, getCurrentPrice } from '@/lib/trading/data-provider';
import { getFullUniverse, runL1Filter, type NSEStock } from '@/lib/trading/universe-scanner';
import { db } from '@/lib/db';

// ── Types ──────────────────────────────────────────────
interface PositionRules {
  maxPerStock: number;
  maxBuysPerMonth: number;
  maxHoldingDays: number;
  maxTotalPositions: number;
  riskPerTradePct: number;
  trailingStopR: number;       // Start trailing after this R-multiple profit
  trailToR: number;            // Trail stop to this R-multiple level
  partialBookR: number;        // Book partial at this R-multiple
  partialBookPct: number;      // Book this % of position
  cooldownDays: number;        // Re-entry cooldown after exit
  maxSectorPct: number;        // Max % in one sector
  timeExitMins: number;        // Exit before market close (mins)
}

const DEFAULT_RULES: PositionRules = {
  maxPerStock: 50000, maxBuysPerMonth: 3, maxHoldingDays: 25,
  maxTotalPositions: 8, riskPerTradePct: 1.0,
  trailingStopR: 1.5, trailToR: 0.5, partialBookR: 2.0, partialBookPct: 30,
  cooldownDays: 3, maxSectorPct: 35, timeExitMins: 30,
};

interface SchedulerState {
  enabled: boolean;
  scanIntervalMin: number;   // Minutes between auto-scans
  exitIntervalMin: number;   // Minutes between exit checks
  lastScanAt: string | null;
  lastExitAt: string | null;
  nextScanAt: string | null;
  nextExitAt: string | null;
  todayEntries: number;
  todayExits: number;
  todayPnl: number;
  scanCount: number;
}

const DEFAULT_SCHEDULER: SchedulerState = {
  enabled: false, scanIntervalMin: 30, exitIntervalMin: 5,
  lastScanAt: null, lastExitAt: null, nextScanAt: null, nextExitAt: null,
  todayEntries: 0, todayExits: 0, todayPnl: 0, scanCount: 0,
};

// ── Helpers ────────────────────────────────────────────
function isMarketHours(): boolean {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
  const day = ist.getDay();
  if (day === 0 || day === 6) return false; // Weekend
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;
  return mins >= 555 && mins <= 930; // 9:15 AM to 3:30 PM IST
}

function timeToClose(): number {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
  const h = ist.getHours();
  const m = ist.getMinutes();
  const mins = h * 60 + m;
  return Math.max(0, 930 - mins); // Minutes to 3:30 PM
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
  }
}

async function getWallet() {
  let w = await db.capitalWallet.findFirst();
  if (!w) w = await db.capitalWallet.create({ data: { totalCapital: 200000, available: 200000 } });
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
  return { ...w, deployed, available: total - deployed, unrealizedPnl, totalCapital: total };
}

async function getSectorAllocation(): Promise<Record<string, number>> {
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const w = await getWallet();
  const total = w.totalCapital;
  if (total <= 0) return {};
  const sectors: Record<string, number> = {};
  for (const t of open) {
    // Get sector from watchlist or tag
    const ws = await db.watchlistStock.findUnique({ where: { symbol: t.symbol } });
    const sector = ws?.sector || t.tags?.split(',').find((tag: string) => !['auto','aplus','b'].includes(tag)) || 'Unknown';
    sectors[sector] = (sectors[sector] || 0) + (t.entryPrice * t.qty);
  }
  // Convert to percentages
  const pct: Record<string, number> = {};
  for (const [k, v] of Object.entries(sectors)) pct[k] = (v / total) * 100;
  return pct;
}

async function canOpen(symbol: string, entryPrice: number, qty: number, rules: PositionRules, sector?: string): Promise<{ ok: boolean; reason: string }> {
  const w = await getWallet();
  const open = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
  const now = new Date();

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

  // Cooldown check — no re-entry within cooldown period after last exit
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

// ── Core Engine: Scan & Auto-Enter ─────────────────────
async function autoScanAndTrade(config: ScreeningConfig) {
  const rules = await getRules();
  const stocks = getFullUniverse();
  const entries: any[] = [];
  const skipped: any[] = [];
  let niftyData: any[] = [];

  try {
    const result = await getHistoricalData('NIFTY50', 350);
    niftyData = result.data;
  } catch {
    skipped.push({ symbol: 'NIFTY50', reason: 'Failed to fetch Nifty data for macro filter' });
    return { entries, skipped, l1Passed: 0, l2Signals: 0, totalScanned: stocks.length };
  }

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

  // L2 V-Swing + auto-enter
  for (const { stock, data } of l1Pass) {
    try {
      const signal = runScreening(stock.symbol, data, niftyData, config);
      if (!signal) { skipped.push({ symbol: stock.symbol, reason: 'No V-Swing signal' }); continue; }
      const qty = signal.setupType === 'A+' ? signal.sizing.qtyA : signal.sizing.qtyB;
      if (qty <= 0) { skipped.push({ symbol: stock.symbol, reason: 'Qty=0' }); continue; }

      const check = await canOpen(stock.symbol, signal.entryPrice, qty, rules, stock.sector);
      if (!check.ok) { skipped.push({ symbol: stock.symbol, reason: check.reason }); continue; }

      const trade = await db.paperTrade.create({
        data: {
          symbol: stock.symbol, stockName: stock.name, direction: 'LONG',
          entryDate: new Date(), entryPrice: signal.entryPrice, qty,
          stopLoss: signal.stopLoss, targetPrice: signal.targetPrice,
          autoTraded: true,
          notes: `AUTO | ${signal.setupType} | Score:${signal.score}/6 | R:R:${signal.riskReward}x`,
          tags: `auto,${signal.setupType === 'A+' ? 'aplus' : 'b'},score-${signal.score},${stock.sector || ''}`.replace(/,$/, ''),
        },
      });
      await db.autoTradeLog.create({
        data: {
          action: 'AUTO_ENTRY', symbol: stock.symbol, tradeId: trade.id,
          signal: JSON.stringify(signal), executed: true,
          reason: `${signal.setupType} | Score ${signal.score}/6 | Qty ${qty} | R:R ${signal.riskReward}x`,
        },
      });

      // Update scheduler daily counters
      await resetDailyCounters();
      const st = await getSchedulerState();
      await setSchedulerKV('sched_todayEntries', String(st.todayEntries + 1));
      await setSchedulerKV('sched_scanCount', String(st.scanCount + 1));

      entries.push({ symbol: stock.symbol, setupType: signal.setupType, score: signal.score, entryPrice: signal.entryPrice, qty, tradeId: trade.id });
    } catch (err) { skipped.push({ symbol: stock.symbol, reason: String(err) }); }
  }
  await recalcWallet();
  return { entries, skipped, l1Passed: l1Pass.length, l2Signals: entries.length, totalScanned: stocks.length };
}

// ── Core Engine: Check Exits with PMS Logic ───────────
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
      // 2. Hard TP hit — full exit at target
      else if (cp >= trade.targetPrice) {
        shouldExit = true; reason = 'TP_HIT'; exitPrice = trade.targetPrice;
      }
      // 3. Trailing stop logic
      else if (risk > 0 && rMultiple >= rules.trailingStopR) {
        // Trail stop to breakeven or trailToR level
        const trailLevel = trade.entryPrice + (risk * rules.trailToR);
        if (cp <= trailLevel) {
          shouldExit = true; reason = 'TRAIL_STOP'; exitPrice = trailLevel;
        }
      }
      // 4. Max holding days
      else if (days >= rules.maxHoldingDays) {
        shouldExit = true; reason = 'MAX_HOLDING_DAYS';
      }
      // 5. Time-based exit (before market close)
      else if (shouldTimeExit) {
        // Only time-exit if position is at a loss or marginal profit
        if (rMultiple < 0.5) {
          shouldExit = true; reason = 'TIME_EXIT'; exitPrice = cp;
        }
      }

      // 6. Partial booking (doesn't trigger full exit)
      if (!shouldExit && risk > 0 && rMultiple >= rules.partialBookR && trade.qty > 1) {
        // Check if partial booking already done (check tags)
        const alreadyBooked = trade.tags?.includes('partial-booked');
        if (!alreadyBooked) {
          const bookQty = Math.max(1, Math.floor(trade.qty * (rules.partialBookPct / 100)));
          const remainingQty = trade.qty - bookQty;
          if (remainingQty >= 1) {
            // Close partial
            const bookPnl = (cp - trade.entryPrice) * bookQty;
            await db.paperTrade.update({
              where: { id: trade.id },
              data: {
                qty: remainingQty,
                tags: (trade.tags ? trade.tags + ',' : '') + 'partial-booked',
              },
            });
            // Record the partial book in wallet
            const w = await getWallet();
            await db.capitalWallet.update({ where: { id: w.id }, data: { realizedPnl: w.realizedPnl + bookPnl } });
            await db.autoTradeLog.create({
              action: 'PARTIAL_BOOK', symbol: trade.symbol, tradeId: trade.id,
              executed: true, reason: `Booked ${bookQty}/${trade.qty + bookQty} at ${rMultiple.toFixed(1)}R | P&L: ₹${bookPnl.toLocaleString()}`,
            });
            partialBooks.push({
              symbol: trade.symbol, bookedQty: bookQty, remainingQty, rMultiple,
              pnl: bookPnl, exitPrice: cp,
            });
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

        // Update scheduler daily counters
        await resetDailyCounters();
        const st = await getSchedulerState();
        await setSchedulerKV('sched_todayExits', String(st.todayExits + 1));
        await setSchedulerKV('sched_todayPnl', String(st.todayPnl + pnl));

        exits.push({ symbol: trade.symbol, exitReason: reason, entryPrice: trade.entryPrice, exitPrice, pnl, pnlPercent: pnlPct, holdingDays: days, rMultiple: rMultiple.toFixed(2) });
      } else {
        // Build position health info for warnings
        const health: any = {
          symbol: trade.symbol, entryPrice: trade.entryPrice, currentPrice: cp,
          pnl: (cp - trade.entryPrice) * trade.qty,
          pnlPercent: ((cp - trade.entryPrice) / trade.entryPrice) * 100,
          holdingDays: days, maxHoldingDays: rules.maxHoldingDays,
          sl: trade.stopLoss, tp: trade.targetPrice, rMultiple: rMultiple.toFixed(2),
        };

        // SL proximity warning (within 10% of SL distance)
        if (risk > 0 && rMultiple > -1 && rMultiple < -0.7) {
          health.slWarning = true;
          warnings.push({ ...health, type: 'SL_PROXIMITY', message: `${trade.symbol} near stop loss (${rMultiple.toFixed(1)}R)` });
        }
        // Aging warning (80%+ of max holding days)
        if (days >= rules.maxHoldingDays * 0.8) {
          health.agingWarning = true;
          warnings.push({ ...health, type: 'AGING', message: `${trade.symbol} aging: ${days}/${rules.maxHoldingDays} days` });
        }

        holding.push(health);
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

  // Check if it's time to scan
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

  // Check if it's time to check exits
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
    return NextResponse.json({
      success: true, wallet, rules, openTrades, recentLogs, scheduler, sectorAllocation: sectorAlloc,
      marketHours: isMarketHours(), timeToClose: timeToClose(),
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
          // Arm scheduler — set next scan/exit times
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
    }
    const wallet = await recalcWallet();
    return NextResponse.json({ success: true, wallet });
  } catch (error) {
    console.error('Auto-trade error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}