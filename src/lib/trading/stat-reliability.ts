/**
 * Layer 3 — Statistical reliability primitives.
 *
 * Two problems a raw win-rate number hides:
 * 1. Small samples look more precise than they are (a "65% win rate" from
 *    8 trades and from 800 trades are not comparable claims).
 * 2. Trades opened the same day share the same market regime/news backdrop
 *    — they are not independent draws, so raw trade count overstates how
 *    much evidence you actually have.
 *
 * Wilson score interval addresses (1); effective-N (by-day clustering)
 * addresses (2). Both are pure math — no external data, no dependencies —
 * so any win-rate consumer in this app (regime-intelligence.ts, the
 * recorder+validator, future factor-attribution stats) can reuse them
 * instead of quoting a naive percentage.
 */

export interface WilsonInterval {
  center: number; // point estimate win rate (%)
  lower: number;  // 95% CI lower bound (%)
  upper: number;  // 95% CI upper bound (%)
}

/**
 * Wilson score interval for a binomial proportion. Unlike a normal
 * approximation, it can't produce bounds outside [0,100] and stays honest
 * at small N (a 2/3 win rate reports as roughly [13%, 88%], not "67%").
 */
export function wilsonScoreInterval(wins: number, n: number, z: number = 1.96): WilsonInterval {
  if (n <= 0) return { center: 0, lower: 0, upper: 0 };
  const p = wins / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centerAdj = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const lower = (centerAdj - margin) / denom;
  const upper = (centerAdj + margin) / denom;
  return {
    center: Math.round(p * 1000) / 10,
    lower: Math.round(Math.max(0, lower) * 1000) / 10,
    upper: Math.round(Math.min(1, upper) * 1000) / 10,
  };
}

/**
 * Effective sample size for trades clustered by calendar day. Conservative
 * choice: each active trading day counts as ONE cluster regardless of how
 * many trades fired that day, since they shared the same regime/VIX/news
 * backdrop. True independence sits somewhere between raw N and this floor —
 * this errs toward not overstating confidence.
 */
export function effectiveSampleSize(entryDates: Date[]): number {
  const days = new Set(entryDates.map((d) => new Date(d).toISOString().slice(0, 10)));
  return days.size;
}

export type ReliabilityTier = 'LOW' | 'MODERATE' | 'HIGH';

export function reliabilityTier(effectiveN: number): ReliabilityTier {
  if (effectiveN < 15) return 'LOW';
  if (effectiveN < 40) return 'MODERATE';
  return 'HIGH';
}

export interface ReliabilityAssessment {
  rawTrades: number;
  effectiveN: number;
  winRate: WilsonInterval;          // interval off raw N — optimistic, ignores clustering
  effectiveWinRate: WilsonInterval; // interval off effective N — honest, wider bounds
  tier: ReliabilityTier;
}

/** Combined assessment: pass every closed trade's win/loss + entryDate for one bucket (a regime, a factor, a symbol...). */
export function assessReliability(wins: number, entryDates: Date[]): ReliabilityAssessment {
  const rawN = entryDates.length;
  const effN = effectiveSampleSize(entryDates);
  // Effective win count scaled proportionally so the point estimate is
  // unchanged — only the interval width reflects the smaller independent sample.
  const effWins = rawN > 0 ? Math.round((wins / rawN) * effN) : 0;
  return {
    rawTrades: rawN,
    effectiveN: effN,
    winRate: wilsonScoreInterval(wins, rawN),
    effectiveWinRate: wilsonScoreInterval(effWins, effN),
    tier: reliabilityTier(effN),
  };
}
