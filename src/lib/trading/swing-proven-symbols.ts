/**
 * Real backtest-proven swing symbols — the intersection gate for the
 * capacity-based pool in auto-trade/route.ts. Being highly RS-ranked
 * (momentum/relative-strength) is a real but separate signal from "this
 * specific stock's price action actually suits the swing rule-set" — the
 * options backtest found exactly this split (high-beta PSU names ranked
 * fine but lost badly), and the full-universe swing backtest below found
 * the same split.
 *
 * Derived from a real 5-year (1825-day), 399-stock full-NSE-universe swing
 * backtest (scripts/real-full-nse-swing-backtest.mjs, run 2026-07-25):
 * filtered to profitFactor > 1.4 AND totalTrades >= 15 (excludes both weak
 * performers and small-sample noise — one single-trade stock hit a
 * meaningless PF=999 sentinel and was excluded by the trade-count floor).
 * 74 of 286 backtestable symbols qualified.
 *
 * This is a static snapshot, not a live recompute — re-run the backtest
 * script periodically (e.g. quarterly, or after any change to the swing
 * entry rules in screening-engine.ts) and refresh this list by hand, the
 * same way the options top-20-by-PF basket was derived.
 */
export const SWING_PROVEN_SYMBOLS = new Set([
  'MAZDOCK', 'ZEELEARN', 'EDUCOMP', 'ADANIENT', 'PCJEWELLER', 'TATAELXSI',
  'BOSCHLTD', 'DIXON', 'HINDCOPPER', 'AARTIDRUGS', 'RENUKA', 'MOTILALOFS',
  'THYROCARE', 'LODHA', 'IRFC', 'HONAUT', 'VEDL', 'HAPPSTMNDS', 'SUZLON',
  'ADANIPOWER', 'HDFCAMC', 'BEL', 'SHILPAMED', 'HAL', 'TITAN', 'TRIDENT',
  'EICHERMOT', 'FLUOROCHEM', 'TRENT', 'RSWM', 'PNB', 'TATAINVEST', 'RVNL',
  'UNIONBANK', 'ONMOBILE', 'CUMMINSIND', 'SOLARINDS', 'HCLTECH', 'SBIN',
  'KAJARIACER', 'KALYANKJIL', 'INFY', 'ADANIGREEN', 'SCHNEIDER',
  'NATIONALUM', 'BHEL', 'JYOTHYLAB', 'BEML', 'HEROMOTOCO', 'GREENPOWER',
  'TASTYBITE', 'HINDALCO', 'ITC', 'CANBK', 'DEEPAKNTR', 'IRCON',
  'VINATIORGA', 'ARVIND', 'IIFL', 'SJVN', 'BHARTIARTL', 'NITINSPIN',
  'GABRIEL', 'NCC', 'DRREDDY', 'IDFCFIRSTB', 'RELIANCE', 'CDSL', 'RBLBANK',
  'ICICIBANK', 'SOBHA', 'INDIANB', 'DLF', 'VAIBHAVGBL',
]);

/**
 * Per-symbol real backtest metrics for the 74 names above — same source
 * (real-full-nse-swing-backtest-results.json), just the actual numbers
 * instead of a bare name list, so the dashboard can rank/display by real
 * backtest quality instead of just listing symbols. Static snapshot, same
 * refresh cadence as SWING_PROVEN_SYMBOLS above.
 */
export interface SwingProvenMetrics {
  sector: string;
  profitFactor: number;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
}

export const SWING_PROVEN_METRICS: Record<string, SwingProvenMetrics> = {
  MAZDOCK: { sector: 'Defence', profitFactor: 7.27, totalTrades: 29, winRate: 41.4, sharpeRatio: 2.16, maxDrawdown: 4.1 },
  ZEELEARN: { sector: 'Education', profitFactor: 6.56, totalTrades: 20, winRate: 60, sharpeRatio: 2.76, maxDrawdown: 5.7 },
  EDUCOMP: { sector: 'Education', profitFactor: 5.25, totalTrades: 16, winRate: 37.5, sharpeRatio: 1.19, maxDrawdown: 6.1 },
  ADANIENT: { sector: 'Conglomerate', profitFactor: 4.8, totalTrades: 45, winRate: 44.4, sharpeRatio: 2.27, maxDrawdown: 4.2 },
  PCJEWELLER: { sector: 'Jewellery', profitFactor: 4.3, totalTrades: 33, winRate: 36.4, sharpeRatio: 1.84, maxDrawdown: 11 },
  TATAELXSI: { sector: 'IT', profitFactor: 4.27, totalTrades: 32, winRate: 43.8, sharpeRatio: 2.56, maxDrawdown: 6 },
  BOSCHLTD: { sector: 'Auto Ancillary', profitFactor: 3.52, totalTrades: 30, winRate: 43.3, sharpeRatio: 2.6, maxDrawdown: 3 },
  DIXON: { sector: 'Electronics', profitFactor: 3.3, totalTrades: 50, winRate: 46, sharpeRatio: 2.46, maxDrawdown: 5.1 },
  HINDCOPPER: { sector: 'Metals', profitFactor: 3.25, totalTrades: 43, winRate: 41.9, sharpeRatio: 1.98, maxDrawdown: 9.4 },
  AARTIDRUGS: { sector: 'Pharma', profitFactor: 3.24, totalTrades: 36, winRate: 38.9, sharpeRatio: 1.17, maxDrawdown: 12.9 },
  RENUKA: { sector: 'Sugar', profitFactor: 3.15, totalTrades: 35, winRate: 31.4, sharpeRatio: 1.47, maxDrawdown: 7.8 },
  MOTILALOFS: { sector: 'Finance', profitFactor: 2.98, totalTrades: 43, winRate: 41.9, sharpeRatio: 1.41, maxDrawdown: 6.9 },
  THYROCARE: { sector: 'Healthcare', profitFactor: 2.91, totalTrades: 29, winRate: 41.4, sharpeRatio: 2.41, maxDrawdown: 30.9 },
  LODHA: { sector: 'Realty', profitFactor: 2.88, totalTrades: 28, winRate: 42.9, sharpeRatio: 2.08, maxDrawdown: 5.3 },
  IRFC: { sector: 'Finance', profitFactor: 2.79, totalTrades: 22, winRate: 31.8, sharpeRatio: 1.04, maxDrawdown: 6.8 },
  HONAUT: { sector: 'Auto Ancillary', profitFactor: 2.79, totalTrades: 23, winRate: 39.1, sharpeRatio: 1.8, maxDrawdown: 4 },
  VEDL: { sector: 'Metals', profitFactor: 2.75, totalTrades: 54, winRate: 44.4, sharpeRatio: 1.47, maxDrawdown: 7.3 },
  HAPPSTMNDS: { sector: 'Auto Ancillary', profitFactor: 2.73, totalTrades: 19, winRate: 36.8, sharpeRatio: 1.4, maxDrawdown: 8.3 },
  SUZLON: { sector: 'Wind Energy', profitFactor: 2.71, totalTrades: 33, winRate: 39.4, sharpeRatio: 1.75, maxDrawdown: 4.7 },
  ADANIPOWER: { sector: 'Power', profitFactor: 2.67, totalTrades: 42, winRate: 35.7, sharpeRatio: 1.96, maxDrawdown: 9.3 },
  HDFCAMC: { sector: 'AMC', profitFactor: 2.66, totalTrades: 43, winRate: 58.1, sharpeRatio: 3.38, maxDrawdown: 4.9 },
  BEL: { sector: 'Defence', profitFactor: 2.52, totalTrades: 49, winRate: 44.9, sharpeRatio: 2.49, maxDrawdown: 4.3 },
  SHILPAMED: { sector: 'Pharma', profitFactor: 2.52, totalTrades: 30, winRate: 40, sharpeRatio: 1.9, maxDrawdown: 5.2 },
  HAL: { sector: 'Defence', profitFactor: 2.49, totalTrades: 44, winRate: 50, sharpeRatio: 2.26, maxDrawdown: 4.4 },
  TITAN: { sector: 'Consumer', profitFactor: 2.49, totalTrades: 46, winRate: 50, sharpeRatio: 2.4, maxDrawdown: 3.7 },
  TRIDENT: { sector: 'Textiles', profitFactor: 2.48, totalTrades: 37, winRate: 40.5, sharpeRatio: 2.14, maxDrawdown: 9.4 },
  EICHERMOT: { sector: 'Auto', profitFactor: 2.43, totalTrades: 40, winRate: 35, sharpeRatio: 2.05, maxDrawdown: 2.8 },
  FLUOROCHEM: { sector: 'Chemicals', profitFactor: 2.42, totalTrades: 42, winRate: 40.5, sharpeRatio: 2.51, maxDrawdown: 5.2 },
  TRENT: { sector: 'Retail', profitFactor: 2.41, totalTrades: 50, winRate: 42, sharpeRatio: 2.52, maxDrawdown: 9.5 },
  RSWM: { sector: 'Textiles', profitFactor: 2.41, totalTrades: 29, winRate: 44.8, sharpeRatio: 2.07, maxDrawdown: 7.2 },
  PNB: { sector: 'Banking', profitFactor: 2.35, totalTrades: 44, winRate: 47.7, sharpeRatio: 2.39, maxDrawdown: 7.6 },
  TATAINVEST: { sector: 'Finance', profitFactor: 2.34, totalTrades: 38, winRate: 42.1, sharpeRatio: 1.87, maxDrawdown: 5.6 },
  RVNL: { sector: 'Infrastructure', profitFactor: 2.23, totalTrades: 45, winRate: 28.9, sharpeRatio: 1.86, maxDrawdown: 12.6 },
  UNIONBANK: { sector: 'Banking', profitFactor: 2.12, totalTrades: 41, winRate: 31.7, sharpeRatio: 1.47, maxDrawdown: 6.6 },
  ONMOBILE: { sector: 'Telecom', profitFactor: 2.08, totalTrades: 34, winRate: 20.6, sharpeRatio: 1.35, maxDrawdown: 9.8 },
  CUMMINSIND: { sector: 'Industrial', profitFactor: 2.03, totalTrades: 47, winRate: 40.4, sharpeRatio: 2.14, maxDrawdown: 4.5 },
  SOLARINDS: { sector: 'Defence', profitFactor: 2.01, totalTrades: 41, winRate: 34.1, sharpeRatio: 1.94, maxDrawdown: 5.4 },
  HCLTECH: { sector: 'IT', profitFactor: 2.01, totalTrades: 44, winRate: 43.2, sharpeRatio: 1.87, maxDrawdown: 3.4 },
  SBIN: { sector: 'Banking', profitFactor: 2, totalTrades: 44, winRate: 38.6, sharpeRatio: 1.8, maxDrawdown: 5.4 },
  KAJARIACER: { sector: 'Ceramics', profitFactor: 1.97, totalTrades: 34, winRate: 32.4, sharpeRatio: 1.77, maxDrawdown: 3.6 },
  KALYANKJIL: { sector: 'Jewellery', profitFactor: 1.94, totalTrades: 34, winRate: 35.3, sharpeRatio: 1.65, maxDrawdown: 6.6 },
  INFY: { sector: 'IT', profitFactor: 1.94, totalTrades: 48, winRate: 47.9, sharpeRatio: 1.82, maxDrawdown: 5 },
  ADANIGREEN: { sector: 'Power', profitFactor: 1.79, totalTrades: 43, winRate: 34.9, sharpeRatio: 1.62, maxDrawdown: 9.8 },
  SCHNEIDER: { sector: 'Industrial', profitFactor: 1.77, totalTrades: 33, winRate: 36.4, sharpeRatio: 1.64, maxDrawdown: 12 },
  NATIONALUM: { sector: 'Metals', profitFactor: 1.75, totalTrades: 54, winRate: 42.6, sharpeRatio: 2.39, maxDrawdown: 8.9 },
  BHEL: { sector: 'Power', profitFactor: 1.74, totalTrades: 43, winRate: 37.2, sharpeRatio: 1.64, maxDrawdown: 7.8 },
  JYOTHYLAB: { sector: 'FMCG', profitFactor: 1.69, totalTrades: 35, winRate: 37.1, sharpeRatio: 1.46, maxDrawdown: 6.1 },
  BEML: { sector: 'Defence', profitFactor: 1.66, totalTrades: 51, winRate: 33.3, sharpeRatio: 1.64, maxDrawdown: 11.5 },
  HEROMOTOCO: { sector: 'Auto', profitFactor: 1.65, totalTrades: 38, winRate: 34.2, sharpeRatio: 1.48, maxDrawdown: 5.2 },
  GREENPOWER: { sector: 'Power', profitFactor: 1.61, totalTrades: 32, winRate: 37.5, sharpeRatio: 1.58, maxDrawdown: 8.9 },
  TASTYBITE: { sector: 'FMCG', profitFactor: 1.59, totalTrades: 38, winRate: 36.8, sharpeRatio: 1.38, maxDrawdown: 6.9 },
  HINDALCO: { sector: 'Metals', profitFactor: 1.58, totalTrades: 53, winRate: 47.2, sharpeRatio: 2.22, maxDrawdown: 8 },
  ITC: { sector: 'FMCG', profitFactor: 1.58, totalTrades: 36, winRate: 33.3, sharpeRatio: 1.34, maxDrawdown: 4.5 },
  CANBK: { sector: 'Banking', profitFactor: 1.57, totalTrades: 45, winRate: 35.6, sharpeRatio: 1.88, maxDrawdown: 9.5 },
  DEEPAKNTR: { sector: 'Chemicals', profitFactor: 1.57, totalTrades: 43, winRate: 34.9, sharpeRatio: 1.52, maxDrawdown: 8.3 },
  IRCON: { sector: 'Infrastructure', profitFactor: 1.56, totalTrades: 46, winRate: 23.9, sharpeRatio: 1.5, maxDrawdown: 11.8 },
  VINATIORGA: { sector: 'Chemicals', profitFactor: 1.56, totalTrades: 36, winRate: 36.1, sharpeRatio: 1.95, maxDrawdown: 4.5 },
  ARVIND: { sector: 'Textiles', profitFactor: 1.55, totalTrades: 46, winRate: 39.1, sharpeRatio: 1.76, maxDrawdown: 9.3 },
  IIFL: { sector: 'NBFC', profitFactor: 1.53, totalTrades: 34, winRate: 26.5, sharpeRatio: 0.87, maxDrawdown: 12.1 },
  SJVN: { sector: 'Power', profitFactor: 1.53, totalTrades: 48, winRate: 41.7, sharpeRatio: 1.78, maxDrawdown: 8.2 },
  BHARTIARTL: { sector: 'Telecom', profitFactor: 1.53, totalTrades: 47, winRate: 42.6, sharpeRatio: 1.59, maxDrawdown: 5.2 },
  NITINSPIN: { sector: 'Textiles', profitFactor: 1.52, totalTrades: 40, winRate: 30, sharpeRatio: 0.99, maxDrawdown: 11.6 },
  GABRIEL: { sector: 'Auto Ancillary', profitFactor: 1.51, totalTrades: 52, winRate: 32.7, sharpeRatio: 1.44, maxDrawdown: 21.8 },
  NCC: { sector: 'Infrastructure', profitFactor: 1.51, totalTrades: 41, winRate: 36.6, sharpeRatio: 1.71, maxDrawdown: 8.3 },
  DRREDDY: { sector: 'Pharma', profitFactor: 1.51, totalTrades: 36, winRate: 44.4, sharpeRatio: 1.52, maxDrawdown: 4.3 },
  IDFCFIRSTB: { sector: 'Banking', profitFactor: 1.5, totalTrades: 41, winRate: 39, sharpeRatio: 1.54, maxDrawdown: 8.5 },
  RELIANCE: { sector: 'Energy', profitFactor: 1.49, totalTrades: 29, winRate: 37.9, sharpeRatio: 1.26, maxDrawdown: 3.7 },
  CDSL: { sector: 'Finance', profitFactor: 1.48, totalTrades: 53, winRate: 32.1, sharpeRatio: 1.59, maxDrawdown: 9.3 },
  RBLBANK: { sector: 'Banking', profitFactor: 1.45, totalTrades: 45, winRate: 44.4, sharpeRatio: 1.71, maxDrawdown: 9.4 },
  ICICIBANK: { sector: 'Banking', profitFactor: 1.44, totalTrades: 53, winRate: 34, sharpeRatio: 1.34, maxDrawdown: 5.2 },
  SOBHA: { sector: 'Realty', profitFactor: 1.43, totalTrades: 47, winRate: 36.2, sharpeRatio: 1.59, maxDrawdown: 12.2 },
  INDIANB: { sector: 'Banking', profitFactor: 1.41, totalTrades: 42, winRate: 31, sharpeRatio: 1.22, maxDrawdown: 6.8 },
  DLF: { sector: 'Realty', profitFactor: 1.41, totalTrades: 41, winRate: 46.3, sharpeRatio: 1.87, maxDrawdown: 6.4 },
  VAIBHAVGBL: { sector: 'Retail', profitFactor: 1.41, totalTrades: 32, winRate: 31.3, sharpeRatio: 1.49, maxDrawdown: 5.4 },
};
