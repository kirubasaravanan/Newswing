# Pending Items

Snapshot as of 2026-07-25, after the real-data audit, options/swing backtest overhaul, and Layer 2/3 intelligence framework pass (commit `b1f158f` on `level4`). Nothing here blocks that push — these are the known follow-ups to pick up next.

## 1. [HIGH] Live options engine isn't gated by proven backtest PF — swing now is, options doesn't yet

Swing's live entry logic (`autoScanAndTrade` in `src/app/api/auto-trade/route.ts`) is gated by `src/lib/trading/swing-proven-symbols.ts` — only stocks that both rank highly on RS **and** proved profitable (PF>1.4, ≥15 trades) in the real 5-year backtest are eligible to trade.

The options side has no equivalent gate. `scanOptionsUniverse()` (`src/lib/trading/options-scanner.ts`) still scans the **full** F&O universe (`getFNOUniverse()`), and `autoOptionsScanAndTrade()` (`src/app/api/auto-trade/route.ts`) will paper-trade any signal that clears the confidence/score threshold — including symbols the 171-stock options backtest showed going to near-zero capital (ADANIPOWER, SUZLON, IRFC, YESBANK, RVNL, NHPC, TRIDENT, MRF, PAGEIND, and others — see `scripts/real-stock-options-backtest-results.json`).

**Action**: build `src/lib/trading/options-proven-symbols.ts` mirroring `swing-proven-symbols.ts` — derive the PF>1.4 shortlist from `real-stock-options-backtest-results.json` (~16-20 symbols, already identified in conversation), and gate `scanOptionsUniverse()`/`autoOptionsScanAndTrade()` by it the same way swing is gated. This is the highest-priority item since it directly affects real capital risk once forward-testing starts.

## 2. [HIGH, time-sensitive] DhanHQ token needs refresh before Monday

Token expires 2026-07-25 ~11:05 AM IST (see commit `9379fc3`). Not urgent today (Saturday, market closed), but generate and set a fresh token in `.env` before market open Monday 2026-07-27 — the planned forward-test start date.

## 3. [MEDIUM] VWAP intraday pipeline never empirically verified live

`vwap.ts` / `dhan-client.ts`'s `getDhanIntradayMinuteCandles()` is code-complete (built during the "implement all" Layer 2 pass) but was never tested against a real DhanHQ `/v2/charts/intraday` response — the token got rate-limited during that dev/test window before it could be verified.

**Action**: once a fresh token is confirmed live, run a manual single-symbol/single-day check to confirm the endpoint returns real minute candles and VWAP computes correctly.

## 4. [LOW, cosmetic] Swing status dashboard still shows only the strict Top-7

`getSwingStocksStatus()` (`src/app/api/auto-trade/route.ts`) wasn't updated when live trading eligibility moved to the wider top-20 capacity-based pool — it's display-only (doesn't affect actual trading), but the dashboard view is now out of sync with what's actually eligible.

**Action**: extend it to show the full ~20-name pool with rank + proven-list status per stock.

## 5. [DEFERRED BY CHOICE, not forgotten] ODSS moderate-tier ideas

Only the top-tier 3 items (guardrails engine, statistical-reliability module, recorder+validator) were approved and built this pass. Still on the table if wanted later:
- Strike-level OI "control score" (more rigorous version of the existing OI-buildup factor)
- Multi-timeframe OI confluence *with exit signals* (currently only used for entries)
- Squeeze-detector state machine
- EOD-positioning / morning-playbook carryover
- Smart-money FII/DII participant OI (a genuinely different real data source)

## 6. [MAINTENANCE] Proven-symbol snapshots need periodic refresh

Both the swing proven-74 list (`swing-proven-symbols.ts`) and the options top-20-by-PF basket (currently only living as a hardcoded array inside `scripts/top20-pf-filtered-backtest.mjs` / `scripts/portfolio-concurrency-backtest.mjs`, not yet promoted to a proper module per item 1) are **one-time backtest snapshots**, not live-recomputed.

**Action**: re-run `scripts/real-stock-options-backtest.mjs` and `scripts/real-full-nse-swing-backtest.mjs` periodically (suggest quarterly, or immediately after any change to `screening-engine.ts`'s entry rules) and refresh the proven-symbol lists by hand.

## 7. [LOW] ~18 stale/renamed tickers in the NSE universe list

The full-universe swing backtest hit HTTP 500 on 18 symbols (LTIM, SRF, NALCO, ZOMATO, ADANITRANS, CAREERP, DATAMATI, SAMVARDHNA, VARDHMAN, PEL, IBULHSGFIN, PNBHFL, ISEC, EMAMI, BLUESTAR, AARTIDRUG, PBFINTECH, and a few more — see the tail of `scripts/real-full-nse-swing-backtest.mjs`'s run output). Likely renamed/delisted tickers in `nse-universe.ts` (e.g. ADANITRANS was renamed ADANIENSOL years ago).

**Action**: audit and correct/remove these from `src/lib/trading/nse-universe.ts`.

## 8. [Expected — not a bug] Recorder+validator and rank-bucket tracker start empty

`getFactorAttribution()` (`/api/signals/attribution`) and `getWinRateByRankBucket()` (`/api/signals/rank-attribution`) have no data to work with yet — there's no way to backfill factor/rank history for trades that closed before these existed. They need real forward-trading days/weeks to accumulate before becoming statistically meaningful (effective-N ≥ 15 for even LOW-tier confidence).
