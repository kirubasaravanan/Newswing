/**
 * Recorder + validator pattern — the practical answer to "what factor
 * combination is actually profitable?" A synthetic backtest can't include
 * OI/PCR/VIX/option-chain data (no historical option-chain dataset exists —
 * every backtest here uses Black-Scholes on real underlying prices instead),
 * and an unfed genetic algorithm never gets wired to real outcomes. Instead:
 * log every live signal's full factor breakdown when it fires, then once its
 * linked trade resolves, stamp the real outcome and attribute it back to
 * each individual factor that was present — building up real, forward-tested
 * per-factor win rates over time.
 *
 * Honest limitation: this starts genuinely empty (same caveat as
 * regime-intelligence.ts) — there's no way to backfill factor breakdowns for
 * trades that closed before this recorder existed.
 */
import { db } from '@/lib/db';
import type { OptionsSignal } from './options-scanner';
import { assessReliability, type ReliabilityTier } from './stat-reliability';

/**
 * Strips dynamic numbers/price levels from a reason string so the same
 * underlying factor groups together regardless of the specific value that
 * triggered it — e.g. "RSI oversold at 28" and "RSI oversold at 24" both
 * normalize to the same bucket instead of being treated as distinct factors.
 */
export function normalizeFactorKey(reason: string): string {
  return reason
    .replace(/₹/g, '')
    .replace(/[-+]?\d+(\.\d+)?/g, '')
    .replace(/\s*@\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function recordSignal(sig: OptionsSignal, executed: boolean, tradeId?: string): Promise<string | null> {
  try {
    const rec = await db.signalRecord.create({
      data: {
        symbol: sig.symbol,
        direction: sig.direction,
        score: sig.score,
        confidence: sig.confidence,
        reasons: JSON.stringify(sig.reasons),
        executed,
        tradeId: tradeId || null,
      },
    });
    return rec.id;
  } catch {
    return null; // non-fatal — recording is best-effort, never blocks trading
  }
}

export async function resolveSignalByTradeId(tradeId: string, win: boolean, netPnl: number): Promise<void> {
  try {
    await db.signalRecord.updateMany({
      where: { tradeId },
      data: { resolved: true, win, netPnl, resolvedAt: new Date() },
    });
  } catch { /* non-fatal — attribution just misses this one if it fails */ }
}

export interface FactorAttribution {
  factor: string;
  totalTrades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  effectiveN: number;
  winRateCI: { lower: number; upper: number };
  reliabilityTier: ReliabilityTier;
}

/** Real per-factor win-rate attribution from resolved (closed) signals only. */
export async function getFactorAttribution(): Promise<FactorAttribution[]> {
  const resolved = await db.signalRecord.findMany({ where: { resolved: true } });

  const byFactor = new Map<string, { count: number; wins: number; totalPnl: number; entryDates: Date[] }>();
  for (const r of resolved) {
    let reasons: string[] = [];
    try { reasons = JSON.parse(r.reasons); } catch { continue; }
    const keys = new Set(reasons.map(normalizeFactorKey));
    for (const key of keys) {
      const bucket = byFactor.get(key) || { count: 0, wins: 0, totalPnl: 0, entryDates: [] };
      bucket.count++;
      if (r.win) bucket.wins++;
      bucket.totalPnl += r.netPnl || 0;
      bucket.entryDates.push(r.createdAt);
      byFactor.set(key, bucket);
    }
  }

  return Array.from(byFactor.entries())
    .map(([factor, s]) => {
      const reliability = assessReliability(s.wins, s.entryDates);
      return {
        factor,
        totalTrades: s.count,
        wins: s.wins,
        winRate: s.count > 0 ? Math.round((s.wins / s.count) * 1000) / 10 : 0,
        avgPnl: s.count > 0 ? Math.round((s.totalPnl / s.count) * 100) / 100 : 0,
        effectiveN: reliability.effectiveN,
        winRateCI: { lower: reliability.effectiveWinRate.lower, upper: reliability.effectiveWinRate.upper },
        reliabilityTier: reliability.tier,
      };
    })
    .sort((a, b) => b.winRate - a.winRate);
}
