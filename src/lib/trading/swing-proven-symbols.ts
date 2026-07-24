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
