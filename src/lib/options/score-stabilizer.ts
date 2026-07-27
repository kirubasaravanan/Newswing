/**
 * Score stabilizer — EMA-smoothed confidence so single-scan score jitter
 * can't decide which signal wins a scarce concurrency slot.
 *
 * Scoped-down port of ODSS's conviction-engine.ts stabilization idea. ODSS's
 * actual mechanism (EMA-smoothed composite + N-scan candidacy confirmation +
 * minimum-dwell-before-demote + challenger-must-beat-incumbent-by-a-margin)
 * exists to stabilize a PERSISTENTLY DISPLAYED dashboard list re-rendered
 * every ~5s — that's a different problem than newswing has. newswing doesn't
 * maintain a displayed "current picks" list; it opens real (paper) positions
 * at scan time and then manages them via their own SL/TP/time-exit logic,
 * not by ranking. There's nothing to "demote" once a trade is open.
 *
 * What newswing DOES need, and didn't have: when multiple eligible signals
 * compete for a scarce slot (sector/index/TOP10-concurrency caps) in the
 * same scan, priority was based on raw single-scan confidence — a symbol
 * that's been consistently decent across several scans could lose a slot to
 * one that just had a noisy one-scan spike. EMA smoothing (same alpha ODSS
 * uses, 0.25) fixes that without needing the rest of ODSS's machinery, since
 * there's no persistent membership state to protect here — just a ranking
 * order at the moment slots are allocated.
 *
 * An explicit N-scan-confirmation gate (ODSS's PROMO_SCANS) was deliberately
 * NOT ported: ODSS scans every ~5s, so "4 scans" is ~20 seconds — trivial.
 * newswing's options scan runs every ~15 minutes, so a fixed scan-count
 * threshold would mean a very different, much more conservative real-time
 * delay depending on the configured interval. EMA smoothing alone already
 * requires several observations to build conviction and adapts naturally to
 * whatever the actual scan cadence is, without a hand-tuned count that could
 * silently behave very differently if the interval is ever changed.
 */
import { db } from '@/lib/db';

const EMA_ALPHA = 0.25; // same smoothing constant ODSS uses

function keyFor(symbol: string, direction: 'CE' | 'PE'): string {
  return `score_ema_${symbol.toUpperCase()}_${direction}`;
}

/**
 * Update and return the EMA-smoothed confidence for this symbol+direction.
 * First observation seeds the EMA at the raw score (no artificial 0-start
 * that would otherwise unfairly penalize a symbol's very first appearance).
 */
export async function getSmoothedScore(symbol: string, direction: 'CE' | 'PE', rawConfidence: number): Promise<number> {
  const key = keyFor(symbol, direction);
  const row = await db.appSettings.findUnique({ where: { key } });
  const prevEma = row ? parseFloat(row.value) : NaN;
  const nextEma = Number.isFinite(prevEma) ? EMA_ALPHA * rawConfidence + (1 - EMA_ALPHA) * prevEma : rawConfidence;
  await db.appSettings.upsert({
    where: { key },
    create: { key, value: String(nextEma) },
    update: { value: String(nextEma) },
  });
  return nextEma;
}
