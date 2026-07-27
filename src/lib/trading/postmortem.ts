/**
 * Trade post-mortem — join what's already being recorded but never read
 * back together. PaperTrade already stores entryDate/exitDate (hold
 * duration is free) and exitReason (TP_HIT/SL_HIT/TRAIL_STOP/etc); a
 * separate SignalRecord table already stores the per-factor reasons/score/
 * confidence for both equity and options, linked by tradeId — but nothing
 * joins them, and nothing computes median (only risk-metrics' avgHoldingDays
 * mean exists) or P&L-by-exit-reason. Options additionally has a much
 * richer JSON blob in PaperTrade.notes (the decisionVote block) that
 * /api/trades and /api/options/trades return as an unparsed string.
 *
 * Ported from the same post-mortem work done on the Forex engine this
 * session (engine/postmortem.py + data/recorder.py's enriched
 * get_recent_trades_from_db()) — same idea, this codebase's existing data
 * model.
 */
import { db } from '@/lib/db';

export interface TradePostmortem {
  id: string;
  symbol: string;
  assetClass: 'equity' | 'options';
  direction: string;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  stopLoss: number;
  targetPrice: number;
  netPnl: number | null;
  pnlPercent: number | null;
  exitReason: string | null;
  entryDate: string;
  exitDate: string | null;
  holdDurationMin: number | null;
  // From SignalRecord (both asset classes) — real factor breakdown at
  // signal time, not just the flat PaperTrade.notes summary string.
  reasons: string[];
  score: number | null;
  confidence: number | null;
  resolved: boolean;
  win: boolean | null;
  // Options only — the richer decisionVote/spot/strike/expiry block
  // already stored in PaperTrade.notes but never parsed back out.
  optionsDetail: Record<string, unknown> | null;
}

function isOptionsTrade(tags: string | null): boolean {
  return !!tags && tags.split(',').map((t) => t.trim()).includes('options');
}

export async function getTradePostmortems(
  assetClass: 'equity' | 'options' | 'all' = 'all',
  limit = 100
): Promise<TradePostmortem[]> {
  const trades = await db.paperTrade.findMany({
    where: { status: 'CLOSED' },
    orderBy: { exitDate: 'desc' },
    take: limit * 2, // over-fetch before asset-class filtering, same as options-scanner's own pattern elsewhere
  });

  const tradeIds = trades.map((t) => t.id);
  const signalRecords = await db.signalRecord.findMany({
    where: { tradeId: { in: tradeIds } },
  });
  const byTradeId = new Map(signalRecords.map((r) => [r.tradeId, r]));

  const result: TradePostmortem[] = [];
  for (const t of trades) {
    const isOptions = isOptionsTrade(t.tags);
    if (assetClass === 'equity' && isOptions) continue;
    if (assetClass === 'options' && !isOptions) continue;

    const sr = t.id ? byTradeId.get(t.id) : undefined;
    let reasons: string[] = [];
    let optionsDetail: Record<string, unknown> | null = null;
    if (isOptions && t.notes) {
      try {
        const parsed = JSON.parse(t.notes);
        optionsDetail = parsed;
        if (Array.isArray(parsed.reasons)) reasons = parsed.reasons;
      } catch {
        // notes wasn't JSON (older manual trade) — fall through to SignalRecord only
      }
    }
    if (reasons.length === 0 && sr?.reasons) {
      try { reasons = JSON.parse(sr.reasons); } catch { /* leave empty */ }
    }

    let holdDurationMin: number | null = null;
    if (t.exitDate) {
      holdDurationMin = Math.round(
        ((new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 60000) * 10
      ) / 10;
    }

    result.push({
      id: t.id,
      symbol: t.symbol,
      assetClass: isOptions ? 'options' : 'equity',
      direction: t.direction,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      qty: t.qty,
      stopLoss: t.stopLoss,
      targetPrice: t.targetPrice,
      netPnl: t.netPnl ?? t.pnl,
      pnlPercent: t.pnlPercent,
      exitReason: t.exitReason,
      entryDate: t.entryDate.toISOString(),
      exitDate: t.exitDate ? t.exitDate.toISOString() : null,
      holdDurationMin,
      reasons,
      score: sr?.score ?? null,
      confidence: sr?.confidence ?? null,
      resolved: sr?.resolved ?? false,
      win: sr?.win ?? null,
      optionsDetail,
    });
    if (result.length >= limit) break;
  }
  return result;
}

export interface ExitReasonBreakdown {
  exitReason: string;
  count: number;
  netPnl: number;
  avgDurationMin: number;
}

export interface PostmortemStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  avgDurationMin: number;
  medianDurationMin: number;
  byExitReason: ExitReasonBreakdown[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Same aggregation the Forex engine's post-mortem computed — real
 * P&L-by-exit-reason breakdown and median (not just mean) hold duration.
 * Neither existed anywhere in this codebase before (risk-metrics' own
 * avgHoldingDays is the only prior duration stat, and it's mean-only,
 * ungrouped by exit reason). */
export function computePostmortemStats(trades: TradePostmortem[]): PostmortemStats {
  const durations = trades.filter((t) => t.holdDurationMin != null).map((t) => t.holdDurationMin as number);
  const wins = trades.filter((t) => (t.netPnl ?? 0) > 0).length;
  const netPnl = trades.reduce((sum, t) => sum + (t.netPnl ?? 0), 0);

  const byReason = new Map<string, { count: number; pnl: number; durations: number[] }>();
  for (const t of trades) {
    const reason = t.exitReason || 'UNKNOWN';
    const bucket = byReason.get(reason) || { count: 0, pnl: 0, durations: [] };
    bucket.count++;
    bucket.pnl += t.netPnl ?? 0;
    if (t.holdDurationMin != null) bucket.durations.push(t.holdDurationMin);
    byReason.set(reason, bucket);
  }

  return {
    totalTrades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 1000) / 10 : 0,
    netPnl: Math.round(netPnl * 100) / 100,
    avgDurationMin: durations.length > 0
      ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
      : 0,
    medianDurationMin: Math.round(median(durations) * 10) / 10,
    byExitReason: Array.from(byReason.entries())
      .map(([exitReason, b]) => ({
        exitReason,
        count: b.count,
        netPnl: Math.round(b.pnl * 100) / 100,
        avgDurationMin: b.durations.length > 0
          ? Math.round((b.durations.reduce((a, c) => a + c, 0) / b.durations.length) * 10) / 10
          : 0,
      }))
      .sort((a, b) => b.count - a.count),
  };
}
