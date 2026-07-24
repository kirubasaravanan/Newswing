/**
 * Real win-rate-by-RS-rank-bucket tracker — answers "is the top-7 cutoff
 * actually right, or would a different rank range perform better?" from
 * real closed-trade outcomes, instead of assuming the RS ranking's own
 * ordering is a reliable profitability signal.
 *
 * Every auto-traded equity entry is now tagged `rank-N` (the stock's RS
 * rank position at entry time — see the tags field in autoScanAndTrade's
 * paper trade creation, auto-trade/route.ts). This buckets closed trades by
 * that rank into ranges roughly matching the pool structure (Top-7 vs the
 * wider vacant-slot pool) and computes real win rate + statistical
 * reliability (Wilson CI / effective-N) per bucket.
 *
 * Honest limitation: starts genuinely empty — rank tagging only began once
 * the capacity-based pool fill shipped, so there's no way to backfill rank
 * buckets for trades that closed before this existed.
 */
import { db } from '@/lib/db';
import { assessReliability, type ReliabilityTier } from './stat-reliability';

export interface RankBucketStats {
  bucket: string;
  totalTrades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  effectiveN: number;
  winRateCI: { lower: number; upper: number };
  reliabilityTier: ReliabilityTier;
}

const BUCKETS: Array<{ label: string; min: number; max: number }> = [
  { label: 'Rank 1-3', min: 1, max: 3 },
  { label: 'Rank 4-7', min: 4, max: 7 },
  { label: 'Rank 8-15', min: 8, max: 15 },
  { label: 'Rank 16-20', min: 16, max: 20 },
];

function bucketFor(rank: number): string {
  return BUCKETS.find((b) => rank >= b.min && rank <= b.max)?.label ?? `Rank ${rank}`;
}

export async function getWinRateByRankBucket(): Promise<RankBucketStats[]> {
  const closed = await db.paperTrade.findMany({
    where: { status: 'CLOSED', autoTraded: true, tags: { contains: 'rank-' } },
  });

  const byBucket = new Map<string, { count: number; wins: number; totalPnl: number; entryDates: Date[] }>();
  for (const t of closed) {
    const match = t.tags?.match(/rank-(\d+)/);
    if (!match) continue;
    const rank = parseInt(match[1], 10);
    const bucketLabel = bucketFor(rank);
    const bucket = byBucket.get(bucketLabel) || { count: 0, wins: 0, totalPnl: 0, entryDates: [] };
    bucket.count++;
    const pnl = t.netPnl ?? t.pnl ?? 0;
    if (pnl > 0) bucket.wins++;
    bucket.totalPnl += pnl;
    bucket.entryDates.push(t.entryDate);
    byBucket.set(bucketLabel, bucket);
  }

  return BUCKETS.map((b) => b.label)
    .filter((label) => byBucket.has(label))
    .map((label) => {
      const s = byBucket.get(label)!;
      const reliability = assessReliability(s.wins, s.entryDates);
      return {
        bucket: label,
        totalTrades: s.count,
        wins: s.wins,
        winRate: s.count > 0 ? Math.round((s.wins / s.count) * 1000) / 10 : 0,
        avgPnl: s.count > 0 ? Math.round((s.totalPnl / s.count) * 100) / 100 : 0,
        effectiveN: reliability.effectiveN,
        winRateCI: { lower: reliability.effectiveWinRate.lower, upper: reliability.effectiveWinRate.upper },
        reliabilityTier: reliability.tier,
      };
    });
}
