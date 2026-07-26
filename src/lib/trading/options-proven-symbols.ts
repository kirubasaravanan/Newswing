/**
 * Real backtest-proven options symbols — mirrors swing-proven-symbols.ts.
 * Index symbols (NIFTY/BANKNIFTY/FINNIFTY/MIDCPNIFTY) are NOT gated by this
 * list — the underlying backtest that produced it only covered single-stock
 * F&O names (scripts/real-stock-options-backtest.mjs, 171-symbol universe),
 * there is no equivalent historical-options backtest for the indices, so
 * gating them the same way would be pretending to have evidence we don't
 * have. Index signals pass through this gate untouched; only stock-options
 * signals are filtered.
 *
 * Derived from the real 171-symbol, 5-year options backtest
 * (scripts/real-stock-options-backtest-results.json) filtered to the top 20
 * by profitFactor, then re-validated by actually running each through the
 * live /api/backtest route in OPTIONS mode (scripts/top20-pf-filtered-backtest.mjs
 * -> top20-pf-filtered-backtest-results.json): PF range 1.38-1.64, trade
 * counts mostly 850-1030 (well above any small-sample concern) except
 * TATAMOTORS, which showed only 100 trades in that specific re-run (a data-
 * availability quirk, not a signal-quality issue) — kept in the list since
 * PF 1.49 on 100 real trades still clears swing's own >=15-trade floor by a
 * wide margin, but flagged here for visibility.
 *
 * Static snapshot, not a live recompute. Re-run
 * scripts/real-stock-options-backtest.mjs periodically (quarterly, or after
 * any change to options-scanner.ts's scoring rules) and refresh this list.
 */
export const OPTIONS_PROVEN_SYMBOLS = new Set([
  'PIDILITIND', 'ITC', 'SOLARINDS', 'CROMPTON', 'BERGEPAINT', 'IRCTC',
  'SUNPHARMA', 'VEDL', 'AXISBANK', 'UPL', 'TATAMOTORS', 'ADANIPORTS',
  'CIPLA', 'ASIANPAINT', 'BATAINDIA', 'ICICIBANK', 'HAVELLS', 'GODREJAGRO',
  'BEML', 'TRENT',
]);

/**
 * The order above is profitFactor-descending (matches
 * scripts/portfolio-concurrency-backtest.mjs's basket exactly for the first
 * 10). That script tested 6 basket-size/concurrency-cap combinations on
 * this same top-10 over a real 5-year, ₹3L-start backtest:
 *
 *   TOP-3,  cap=3  → PF 1.62, ROI 5,122%,  maxDD 27.6%
 *   TOP-5,  cap=3  → PF 1.58, ROI 7,343%,  maxDD 21.8%  (lowest DD of all 6)
 *   TOP-5,  cap=5  → PF 1.58, ROI 8,196%,  maxDD 26.9%
 *   TOP-10, cap=3  → PF 1.52, ROI 8,326%,  maxDD 32.0%
 *   TOP-10, cap=5  → PF 1.55, ROI 13,320%, maxDD 46.5%
 *   TOP-10, cap=10 → PF 1.54, ROI 15,443%, maxDD 46.5%
 *
 * Live decision (2026-07-25): trade the full TOP-10 (wider signal coverage),
 * capped at 3 concurrent stock-options positions at once (OPT_TOP10_CONCURRENCY_CAP
 * below — the lower-drawdown end of the TOP-10 rows, not the 46.5%-DD ones).
 * TOP-5 (cap=3) is NOT used for live sizing/gating — it's kept only as a
 * Discord priority tag (OPTIONS_TOP5_PRIORITY) on top of the TOP-10 trading
 * set, purely to make it visible at a glance which incoming signals are the
 * highest-conviction names, without limiting real trade flow to just 5.
 */
export const OPTIONS_TOP10_SYMBOLS = new Set(Array.from(OPTIONS_PROVEN_SYMBOLS).slice(0, 10));
export const OPTIONS_TOP5_PRIORITY = new Set(Array.from(OPTIONS_PROVEN_SYMBOLS).slice(0, 5));
export const OPT_TOP10_CONCURRENCY_CAP = 3;

/**
 * Per-symbol real backtest metrics for the 20 names above — from the same
 * re-validated re-run (top20-pf-filtered-backtest-results.json) that set the
 * list's order, so the dashboard can show real numbers instead of just names.
 */
export interface OptionsProvenMetrics {
  profitFactor: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
}

export const OPTIONS_PROVEN_METRICS: Record<string, OptionsProvenMetrics> = {
  PIDILITIND: { profitFactor: 1.64, totalTrades: 931, winRate: 41.5, sharpeRatio: 3.25 },
  ITC: { profitFactor: 1.64, totalTrades: 893, winRate: 39.1, sharpeRatio: 3.11 },
  SOLARINDS: { profitFactor: 1.57, totalTrades: 906, winRate: 39.2, sharpeRatio: 2.45 },
  CROMPTON: { profitFactor: 1.53, totalTrades: 940, winRate: 40.1, sharpeRatio: 3.62 },
  BERGEPAINT: { profitFactor: 1.53, totalTrades: 927, winRate: 38.3, sharpeRatio: 3.46 },
  IRCTC: { profitFactor: 1.52, totalTrades: 851, winRate: 38.3, sharpeRatio: 2.86 },
  SUNPHARMA: { profitFactor: 1.51, totalTrades: 955, winRate: 40.3, sharpeRatio: 3.26 },
  VEDL: { profitFactor: 1.5, totalTrades: 974, winRate: 42.3, sharpeRatio: 3.55 },
  AXISBANK: { profitFactor: 1.5, totalTrades: 1000, winRate: 41.2, sharpeRatio: 3.28 },
  UPL: { profitFactor: 1.49, totalTrades: 927, winRate: 38.7, sharpeRatio: 2.78 },
  TATAMOTORS: { profitFactor: 1.49, totalTrades: 100, winRate: 38, sharpeRatio: 1.27 },
  ADANIPORTS: { profitFactor: 1.44, totalTrades: 1010, winRate: 37.3, sharpeRatio: 3.04 },
  CIPLA: { profitFactor: 1.43, totalTrades: 888, winRate: 37.6, sharpeRatio: 2.86 },
  ASIANPAINT: { profitFactor: 1.43, totalTrades: 916, winRate: 39.5, sharpeRatio: 2.77 },
  BATAINDIA: { profitFactor: 1.42, totalTrades: 961, winRate: 36.3, sharpeRatio: 2.84 },
  ICICIBANK: { profitFactor: 1.41, totalTrades: 900, winRate: 38.9, sharpeRatio: 2.7 },
  HAVELLS: { profitFactor: 1.4, totalTrades: 944, winRate: 39.6, sharpeRatio: 2.84 },
  GODREJAGRO: { profitFactor: 1.4, totalTrades: 857, winRate: 38.5, sharpeRatio: 1.6 },
  BEML: { profitFactor: 1.39, totalTrades: 1026, winRate: 36.7, sharpeRatio: 2.5 },
  TRENT: { profitFactor: 1.38, totalTrades: 1031, winRate: 36.5, sharpeRatio: 2.88 },
};
