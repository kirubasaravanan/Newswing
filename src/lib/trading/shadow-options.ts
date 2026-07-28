/**
 * Options shadow forward-test — records every signal the live scanner
 * (options-scanner.ts) produces above the sniper bar, whitelisted or not,
 * and tracks a simulated SL/TP outcome using real live premiums. No real
 * capital ever touches these rows.
 *
 * Built 2026-07-28: the options backtest (screening-engine.ts) is a
 * SEPARATE implementation from the live scanner and had drifted out of
 * sync with it as of 2026-07-27 (confirmed via git log), so its results
 * can't be trusted to decide whether the TOP-10 proven-symbols whitelist
 * should expand. This is real forward evidence instead — the same
 * philosophy as the SignalRecord recorder/attribution system, just scoped
 * to the FULL universe rather than only the symbols that already cleared
 * the whitelist.
 *
 * Honest limitation: this does NOT replicate the IV-percentile/OC-veto/
 * institutional-flow/reputation adjustments a real entry goes through —
 * it uses the raw technical scanner's score/confidence plus a real fetched
 * premium and the same structure-based SL/TP conversion. That's a
 * deliberate scope cut: it answers "does the raw scanner's pick quality
 * hold up across the whole universe," not "would every real-trade filter
 * have also approved this."
 */
import { db } from '@/lib/db';
import { fetchDhanOptionChain } from '@/lib/options/dhan-option-provider';
import { convertToPremiumTargets } from '@/lib/trading/market-structure';
import type { OptionsSignal } from '@/lib/trading/options-scanner';

export interface ShadowSizingContext {
  totalCapital: number;
  riskPerTradePct: number;
  getLotSize: (symbol: string) => number;
}

export async function recordShadowOptionSignals(
  signals: OptionsSignal[],
  inTop10Symbols: (symbol: string) => boolean,
  sizing: ShadowSizingContext
): Promise<{ recorded: number; skipped: number }> {
  let recorded = 0;
  let skipped = 0;

  for (const sig of signals) {
    try {
      // Dedup — one open shadow row per exact contract, same rule as real
      // entries (don't re-log a signal that's already being tracked).
      const existing = await db.shadowOptionSignal.findFirst({
        where: { symbol: sig.symbol, direction: sig.direction, strike: sig.strike, expiry: sig.expiry, status: 'OPEN' },
      });
      if (existing) {
        skipped++;
        continue;
      }

      let premium = 0;
      let realDelta = 0.5;
      try {
        const chain = await fetchDhanOptionChain(sig.symbol, sig.expiry);
        if (chain && chain.chain && chain.chain.length > 0) {
          const row = chain.chain.find(r => r.strike === sig.strike)
            || chain.chain.reduce((closest, r) =>
              Math.abs(r.strike - sig.strike) < Math.abs(closest.strike - sig.strike) ? r : closest
            );
          const quote = sig.direction === 'CE' ? row?.ce : row?.pe;
          if (quote && quote.ltp > 0) {
            premium = quote.ltp;
            realDelta = quote.delta || 0.5;
          }
        }
      } catch { /* no chain this cycle — skip, don't fabricate a premium */ }

      if (premium <= 0) {
        skipped++;
        continue;
      }

      const targets = convertToPremiumTargets(
        { stopSpotDistance: sig.stopSpotDistance, targetSpotDistance: sig.targetSpotDistance },
        realDelta,
        premium
      );
      const stopLoss = Math.round(premium * (1 + targets.stopLossPct / 100) * 100) / 100;
      const targetPrice = Math.round(premium * (1 + targets.targetPct / 100) * 100) / 100;

      // Notional sizing — same risk-based formula a real entry would use
      // (risk% of total capital / risk-per-lot), so "capital deployed" and
      // "tentative capital required" in the hourly report are apples-to-
      // apples with what real trading would actually cost, not a guess.
      const lotSize = sizing.getLotSize(sig.symbol);
      const riskBudget = sizing.totalCapital * (sizing.riskPerTradePct / 100);
      const riskPerLot = premium * (Math.abs(targets.stopLossPct) / 100) * lotSize;
      const lots = riskPerLot > 0 ? Math.max(1, Math.floor(riskBudget / riskPerLot)) : 1;
      const notionalQty = lots * lotSize;
      const notionalCapital = Math.round(premium * notionalQty * 100) / 100;

      await db.shadowOptionSignal.create({
        data: {
          symbol: sig.symbol,
          direction: sig.direction,
          strike: sig.strike,
          expiry: sig.expiry,
          score: sig.score,
          confidence: sig.confidence,
          entryPremium: premium,
          stopLoss,
          targetPrice,
          inTop10: inTop10Symbols(sig.symbol),
          notionalQty,
          notionalCapital,
        },
      });
      recorded++;
    } catch {
      skipped++; // best-effort — shadow recording never blocks real trading
    }
  }

  return { recorded, skipped };
}

export async function checkShadowOptionExits(): Promise<{ checked: number; resolved: number }> {
  let checked = 0;
  let resolved = 0;

  const open = await db.shadowOptionSignal.findMany({ where: { status: 'OPEN' } });
  if (open.length === 0) return { checked: 0, resolved: 0 };

  // One option-chain fetch per unique (symbol, expiry) this cycle, reused
  // across every open shadow row on that contract.
  const chainCache = new Map<string, Awaited<ReturnType<typeof fetchDhanOptionChain>>>();

  for (const row of open) {
    checked++;
    try {
      const cacheKey = `${row.symbol}_${row.expiry}`;
      if (!chainCache.has(cacheKey)) {
        chainCache.set(cacheKey, await fetchDhanOptionChain(row.symbol, row.expiry).catch(() => null));
      }
      const chain = chainCache.get(cacheKey);
      if (!chain || !chain.chain || chain.chain.length === 0) continue;

      const chainRow = chain.chain.find(r => r.strike === row.strike)
        || chain.chain.reduce((closest, r) =>
          Math.abs(r.strike - row.strike) < Math.abs(closest.strike - row.strike) ? r : closest
        );
      const quote = row.direction === 'CE' ? chainRow?.ce : chainRow?.pe;
      if (!quote || quote.ltp <= 0) continue; // no real quote this cycle — hold, don't guess

      const currentPremium = quote.ltp;
      const isExpiryDay = new Date(row.expiry).toDateString() === new Date().toDateString();
      const isNewDay = new Date(row.openedAt).toDateString() !== new Date().toDateString();

      let exitReason: string | null = null;
      let exitPremium = currentPremium;
      if (currentPremium <= row.stopLoss) {
        exitReason = 'SL_HIT';
        exitPremium = row.stopLoss;
      } else if (currentPremium >= row.targetPrice) {
        exitReason = 'TP_HIT';
        exitPremium = row.targetPrice;
      } else if (isExpiryDay || isNewDay) {
        exitReason = isExpiryDay ? 'EXPIRY_CLOSE' : 'DAY_ROLLOVER_CLOSE';
      }

      if (exitReason) {
        const pnlPercent = Math.round(((exitPremium / row.entryPremium) - 1) * 10000) / 100;
        const netPnl = Math.round((exitPremium - row.entryPremium) * row.notionalQty * 100) / 100;
        await db.shadowOptionSignal.update({
          where: { id: row.id },
          data: { status: 'CLOSED', exitPremium, exitReason, pnlPercent, netPnl, closedAt: new Date() },
        });
        resolved++;
      }
    } catch {
      // best-effort — leave this row OPEN, retry next cycle
    }
  }

  return { checked, resolved };
}

export interface ShadowSummaryBucket {
  count: number;
  wins: number;
  winRate: number;
  avgPnlPercent: number;
}

export async function getShadowOptionsSummary(): Promise<{
  top10: ShadowSummaryBucket;
  restOfUniverse: ShadowSummaryBucket;
  bySymbol: Array<{ symbol: string; inTop10: boolean } & ShadowSummaryBucket>;
}> {
  const closed = await db.shadowOptionSignal.findMany({ where: { status: 'CLOSED' } });

  function summarize(rows: typeof closed): ShadowSummaryBucket {
    const count = rows.length;
    const wins = rows.filter(r => (r.pnlPercent ?? 0) > 0).length;
    const avgPnlPercent = count > 0
      ? Math.round((rows.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / count) * 100) / 100
      : 0;
    return { count, wins, winRate: count > 0 ? Math.round((wins / count) * 1000) / 10 : 0, avgPnlPercent };
  }

  const bySymbolMap = new Map<string, typeof closed>();
  for (const r of closed) {
    const arr = bySymbolMap.get(r.symbol) || [];
    arr.push(r);
    bySymbolMap.set(r.symbol, arr);
  }
  const bySymbol = Array.from(bySymbolMap.entries()).map(([symbol, rows]) => ({
    symbol,
    inTop10: rows[0].inTop10,
    ...summarize(rows),
  })).sort((a, b) => b.count - a.count);

  return {
    top10: summarize(closed.filter(r => r.inTop10)),
    restOfUniverse: summarize(closed.filter(r => !r.inTop10)),
    bySymbol,
  };
}

export interface ShadowClosedDetail {
  symbol: string;
  direction: string;      // CE / PE
  strike: number;
  expiry: string;
  inTop10: boolean;
  entryPremium: number;
  exitPremium: number | null;
  exitReason: string | null;
  openedAt: Date;
  closedAt: Date | null;
  pnlPercent: number | null;
  netPnl: number | null;
}

/** Full per-signal detail for every shadow signal CLOSED since `since` — the
 * "what actually happened" list to go alongside the aggregate counts, so a
 * closedCount isn't just a number with no way to see which contract, strike,
 * or exit reason it was. */
export async function getShadowClosedSignalsSince(since: Date): Promise<ShadowClosedDetail[]> {
  const rows = await db.shadowOptionSignal.findMany({
    where: { status: 'CLOSED', closedAt: { gte: since } },
    orderBy: { closedAt: 'asc' },
  });
  return rows.map(r => ({
    symbol: r.symbol,
    direction: r.direction,
    strike: r.strike,
    expiry: r.expiry,
    inTop10: r.inTop10,
    entryPremium: r.entryPremium,
    exitPremium: r.exitPremium,
    exitReason: r.exitReason,
    openedAt: r.openedAt,
    closedAt: r.closedAt,
    pnlPercent: r.pnlPercent,
    netPnl: r.netPnl,
  }));
}

/** Full per-signal detail for every currently OPEN shadow signal — same
 * "see the actual contract, not just a count" need as the closed-detail
 * list above. */
export async function getShadowOpenSignalsDetail(): Promise<ShadowClosedDetail[]> {
  const rows = await db.shadowOptionSignal.findMany({ where: { status: 'OPEN' }, orderBy: { openedAt: 'asc' } });
  return rows.map(r => ({
    symbol: r.symbol,
    direction: r.direction,
    strike: r.strike,
    expiry: r.expiry,
    inTop10: r.inTop10,
    entryPremium: r.entryPremium,
    exitPremium: null,
    exitReason: null,
    openedAt: r.openedAt,
    closedAt: null,
    pnlPercent: null,
    netPnl: null,
  }));
}

export interface ShadowHourlyReport {
  openCount: number;
  capitalDeployed: number;         // notional capital across currently-OPEN shadow signals
  closedTodayCount: number;
  closedTodayWinRate: number;
  closedTodayNetPnl: number;
  capitalRequiredToday: number;    // notional capital across every shadow signal (open+closed) recorded today — "if you rotated through all of today's signals, roughly this much capital was needed"
  cumulativeClosedCount: number;
  cumulativeWinRate: number;
  cumulativeNetPnl: number;
  byExitReason: Array<{ reason: string; count: number; winRate: number; netPnl: number }>;
}

export async function getShadowOptionsHourlyReport(): Promise<ShadowHourlyReport> {
  const istNow = new Date(Date.now() + 5.5 * 3600000);
  const istMidnight = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()));
  const todayStartUtc = new Date(istMidnight.getTime() - 5.5 * 3600000);

  const [open, closedToday, recordedToday, allClosed] = await Promise.all([
    db.shadowOptionSignal.findMany({ where: { status: 'OPEN' } }),
    db.shadowOptionSignal.findMany({ where: { status: 'CLOSED', closedAt: { gte: todayStartUtc } } }),
    db.shadowOptionSignal.findMany({ where: { openedAt: { gte: todayStartUtc } } }),
    db.shadowOptionSignal.findMany({ where: { status: 'CLOSED' } }),
  ]);

  const capitalDeployed = Math.round(open.reduce((s, r) => s + r.notionalCapital, 0) * 100) / 100;
  const capitalRequiredToday = Math.round(recordedToday.reduce((s, r) => s + r.notionalCapital, 0) * 100) / 100;

  const closedTodayWins = closedToday.filter(r => (r.netPnl ?? 0) > 0).length;
  const closedTodayNetPnl = Math.round(closedToday.reduce((s, r) => s + (r.netPnl ?? 0), 0) * 100) / 100;

  const cumWins = allClosed.filter(r => (r.netPnl ?? 0) > 0).length;
  const cumulativeNetPnl = Math.round(allClosed.reduce((s, r) => s + (r.netPnl ?? 0), 0) * 100) / 100;

  const reasonMap = new Map<string, { count: number; wins: number; pnl: number }>();
  for (const r of allClosed) {
    const key = r.exitReason || 'UNKNOWN';
    const b = reasonMap.get(key) || { count: 0, wins: 0, pnl: 0 };
    b.count++;
    b.wins += (r.netPnl ?? 0) > 0 ? 1 : 0;
    b.pnl += r.netPnl ?? 0;
    reasonMap.set(key, b);
  }
  const byExitReason = Array.from(reasonMap.entries())
    .map(([reason, b]) => ({
      reason,
      count: b.count,
      winRate: Math.round((b.wins / b.count) * 1000) / 10,
      netPnl: Math.round(b.pnl * 100) / 100,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    openCount: open.length,
    capitalDeployed,
    closedTodayCount: closedToday.length,
    closedTodayWinRate: closedToday.length > 0 ? Math.round((closedTodayWins / closedToday.length) * 1000) / 10 : 0,
    closedTodayNetPnl,
    capitalRequiredToday,
    cumulativeClosedCount: allClosed.length,
    cumulativeWinRate: allClosed.length > 0 ? Math.round((cumWins / allClosed.length) * 1000) / 10 : 0,
    cumulativeNetPnl,
    byExitReason,
  };
}

export interface ShadowTimeSlotBucket {
  slot: string;       // e.g. "09:30-10:00" IST wall-clock
  count: number;
  winRate: number;
  netPnl: number;
  topSymbols: string[]; // top 2 symbols by count in this slot, for context
}

/**
 * Buckets every CLOSED shadow signal by IST wall-clock time-of-day
 * (ignoring the date, so patterns accumulate across days) — answers "does
 * 9:30-10:00 consistently outperform 11:30-12:00," not just "what happened
 * today." Best viewed once enough days have accumulated; a single day's
 * slots will be too thin to trust.
 */
export async function getShadowOptionsTimeOfDayBreakdown(slotMinutes: number = 30): Promise<ShadowTimeSlotBucket[]> {
  const closed = await db.shadowOptionSignal.findMany({ where: { status: 'CLOSED' } });

  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const buckets = new Map<string, { count: number; wins: number; pnl: number; symbols: Map<string, number> }>();

  for (const r of closed) {
    const ist = new Date(r.openedAt.getTime() + 5.5 * 3600000);
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const slotStart = Math.floor(mins / slotMinutes) * slotMinutes;
    const label = `${fmt(slotStart)}-${fmt(slotStart + slotMinutes)}`;

    const b = buckets.get(label) || { count: 0, wins: 0, pnl: 0, symbols: new Map<string, number>() };
    b.count++;
    b.wins += (r.netPnl ?? 0) > 0 ? 1 : 0;
    b.pnl += r.netPnl ?? 0;
    b.symbols.set(r.symbol, (b.symbols.get(r.symbol) || 0) + 1);
    buckets.set(label, b);
  }

  return Array.from(buckets.entries())
    .map(([slot, b]) => ({
      slot,
      count: b.count,
      winRate: Math.round((b.wins / b.count) * 1000) / 10,
      netPnl: Math.round(b.pnl * 100) / 100,
      topSymbols: Array.from(b.symbols.entries()).sort((a, b2) => b2[1] - a[1]).slice(0, 2).map(([s]) => s),
    }))
    .sort((a, b) => a.slot.localeCompare(b.slot));
}
