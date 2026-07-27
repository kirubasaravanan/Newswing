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
import { assessReliability, type ReliabilityTier } from './stat-reliability';

// Structural, not OptionsSignal-specific — equity signals (ScreeningResult)
// don't share a type with options signals, but both have these 5 fields.
// This is what makes it possible to wire equity's runScreening() picks into
// the same recorder/attribution system options already used, instead of
// equity having no forward-tested per-factor attribution at all (a real gap
// found while auditing task 13 — rank-bucket-intelligence.ts already tracks
// win-rate-by-RS-rank for equity, but nothing tracked which of the 6
// trend/pullback/trigger/volume/RS/gap conditions actually predicts wins).
export interface RecordableSignal {
  symbol: string;
  direction: string;
  score: number;
  confidence: number;
  reasons: string[];
}

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

export async function recordSignal(sig: RecordableSignal, executed: boolean, tradeId?: string): Promise<string | null> {
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

export interface SymbolReputation {
  symbol: string;
  totalTrades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  effectiveN: number;
  winRateCI: { lower: number; upper: number };
  reliabilityTier: ReliabilityTier;
}

/**
 * Per-symbol track record — the same reliability math getFactorAttribution()
 * already uses (Wilson interval + by-day effective-N, stat-reliability.ts),
 * just grouped by SYMBOL instead of by factor/reason text. This is the real
 * gap vs ODSS's Conviction DNA (Elo + Bayesian + survivorship per-symbol
 * reputation): a "does THIS stock tend to perform well when picked,
 * regardless of which factors fired" question the factor-level attribution
 * above can't answer on its own. Reuses signalRecord — no new recording
 * infrastructure needed, this data was already being captured.
 */
export async function getSymbolReputation(): Promise<SymbolReputation[]> {
  const resolved = await db.signalRecord.findMany({ where: { resolved: true } });

  const bySymbol = new Map<string, { count: number; wins: number; totalPnl: number; entryDates: Date[] }>();
  for (const r of resolved) {
    const bucket = bySymbol.get(r.symbol) || { count: 0, wins: 0, totalPnl: 0, entryDates: [] };
    bucket.count++;
    if (r.win) bucket.wins++;
    bucket.totalPnl += r.netPnl || 0;
    bucket.entryDates.push(r.createdAt);
    bySymbol.set(r.symbol, bucket);
  }

  return Array.from(bySymbol.entries())
    .map(([symbol, s]) => {
      const reliability = assessReliability(s.wins, s.entryDates);
      return {
        symbol,
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

const REPUTATION_MAX_ADJUSTMENT = 15; // points, same scale as the IV-caution penalty
const REPUTATION_BASELINE_WIN_RATE = 50; // a strategy without edge is ~50% by construction; deviation from this is the signal

/**
 * Confidence adjustment (-15..+15) for a single symbol, based on its real
 * resolved track record. Returns null — never a fabricated 0 — until there's
 * enough independent (by-day) history to say anything (same LOW-tier "no
 * opinion" convention used everywhere else this session: IV percentile,
 * COT/CB data, session anticipation).
 */
export async function getSymbolReputationAdjustment(symbol: string): Promise<{ adjustment: number; reason: string } | null> {
  const all = await getSymbolReputation();
  const row = all.find((r) => r.symbol === symbol);
  if (!row || row.reliabilityTier === 'LOW') return null;
  const centerWinRate = (row.winRateCI.lower + row.winRateCI.upper) / 2;
  const deviation = centerWinRate - REPUTATION_BASELINE_WIN_RATE;
  // Scale so a +-20pp deviation from baseline reaches the full +-15 adjustment
  const adjustment = Math.max(-REPUTATION_MAX_ADJUSTMENT, Math.min(REPUTATION_MAX_ADJUSTMENT, (deviation / 20) * REPUTATION_MAX_ADJUSTMENT));
  const reason = adjustment >= 0
    ? `${symbol} track record: ${row.winRate}% win rate over ${row.totalTrades} resolved trades (${row.reliabilityTier} confidence)`
    : `${symbol} track record: ${row.winRate}% win rate over ${row.totalTrades} resolved trades — below baseline (${row.reliabilityTier} confidence)`;
  return { adjustment: Math.round(adjustment * 10) / 10, reason };
}
