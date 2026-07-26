# Pending Items

Snapshot as of 2026-07-26, after the end-to-end Newswing + Forex audit pass (5 parallel audit agents covering Forex's Python core/supporting modules, the Forex Next.js frontend, both Pine scripts, and a fresh Newswing re-audit). Nothing here blocks — these are the known follow-ups to pick up next.

## 1. [RESOLVED — verify only] Options engine now gated by proven backtest PF

This was built and has since been extended twice more: `src/lib/trading/options-proven-symbols.ts` gates on a real PF-ranked 20-symbol basket, further narrowed to `OPTIONS_TOP10_SYMBOLS` (the actual live-trading gate, wired into `autoOptionsScanAndTrade()`'s `highConfidence` filter) plus `OPTIONS_TOP5_PRIORITY` (Discord-only priority tag, `OPT_TOP10_CONCURRENCY_CAP=3`). Confirmed present and wired by two independent audit passes now — no longer an open item.

## 2. [HIGH, recurring — not a one-time fix] DhanHQ access tokens expire on a ~24h cycle

Observed directly from a live token's own JWT payload: issued 2026-07-25 17:53:15 UTC, expires 2026-07-26 17:53:15 UTC — a 24-hour lifetime, not a one-time "refresh before Monday" event. Every one of the 3 token fields in `.env` needs regenerating roughly once a day for uninterrupted live data.

**Action**: treat this as a standing daily task (or automate the DhanHQ refresh-token flow if their API supports it) rather than a single date to remember.

## 3. [MEDIUM] VWAP intraday pipeline never empirically verified live

`vwap.ts` / `dhan-client.ts`'s `getDhanIntradayMinuteCandles()` is code-complete (built during the "implement all" Layer 2 pass) but was never tested against a real DhanHQ `/v2/charts/intraday` response — the token got rate-limited during that dev/test window before it could be verified.

**Action**: once a fresh token is confirmed live, run a manual single-symbol/single-day check to confirm the endpoint returns real minute candles and VWAP computes correctly.

## 4. [RESOLVED] Swing status dashboard now shows the full proven-74 pool

Built `src/lib/trading/swing-universe-status.ts` + `/api/auto-trade/swing-universe` + `<SwingWatchlistCard />`, replacing 3 duplicated hardcoded fake "Top 7" widgets (and a fake ROI badge, and a fake no-op "Rebalance Watchlist Now" button) across `dashboard-tab.tsx`, `auto-trade/index.tsx`, and `screener-tab.tsx`. Shows real rank + backtest metrics (PF, win rate, Sharpe, max DD) for all 74 symbols, batched 15-at-a-time (fixed a sequential-await bug that made it hang). The old narrow `getSwingStocksStatus()` (renamed `getSwingTop7Status()`) is kept only for the Discord hourly-heartbeat message, not the dashboard. A real options-side equivalent (`<OptionsWatchlistCard />`) was also built, which didn't exist before.

## 5. [DEFERRED BY CHOICE, not forgotten] ODSS moderate-tier ideas

Only the top-tier 3 items (guardrails engine, statistical-reliability module, recorder+validator) were approved and built this pass. Still on the table if wanted later:
- Strike-level OI "control score" (more rigorous version of the existing OI-buildup factor)
- Multi-timeframe OI confluence *with exit signals* (currently only used for entries)
- Squeeze-detector state machine
- EOD-positioning / morning-playbook carryover
- Smart-money FII/DII participant OI (a genuinely different real data source)

## 6. [MAINTENANCE] Proven-symbol snapshots need periodic refresh

Both the swing proven-74 list (`swing-proven-symbols.ts`) and the options top-20-by-PF basket (now promoted to `options-proven-symbols.ts` per item 1, no longer just a script-local array) are **one-time backtest snapshots**, not live-recomputed.

**Action**: re-run `scripts/real-stock-options-backtest.mjs` and `scripts/real-full-nse-swing-backtest.mjs` periodically (suggest quarterly, or immediately after any change to `screening-engine.ts`'s entry rules) and refresh the proven-symbol lists by hand.

## 7. [RESOLVED, but see new item 9] Stale/renamed/duplicate tickers in the NSE universe list

All symbols from the original list (LTIM confirmed already correct; SRF, NALCO→NATIONALUM, ZOMATO, ADANITRANS→ADANIENSOL, CAREERP→CARERATING, DATAMATI→DATAMATICS, SAMVARDHNA→MOTHERSON, VARDHMAN, PEL, IBULHSGFIN→SAMMAANCAP, PNBHFL→PNBHOUSING, ISEC→IEX, EMAMI→EMAMILTD, BLUESTAR→BLUESTARCO, AARTIDRUG→AARTIDRUGS, PBFINTECH, RANA sugars→RANASUG, SRF LIMITED→SRF) verified against real current NSE tickers (web search, since several had renamed years ago — e.g. IBULHSGFIN→SAMMAANCAP renamed 2024-07-26) and fixed, including removing several outright-fabricated company names attached to real tickers (PEL was labeled "Phantom Electronics"/"Phoenix Electric" — the real company is Piramal Enterprises; ISEC was labeled "Indian Energy Exchange" — that's actually ICICI Securities' ticker, IEX is the real Indian Energy Exchange symbol).

## 8. [Expected — not a bug] Recorder+validator and rank-bucket tracker start empty

`getFactorAttribution()` (`/api/signals/attribution`) and `getWinRateByRankBucket()` (`/api/signals/rank-attribution`) have no data to work with yet — there's no way to backfill factor/rank history for trades that closed before these existed. They need real forward-trading days/weeks to accumulate before becoming statistically meaningful (effective-N ≥ 15 for even LOW-tier confidence).

## 9. [MEDIUM, new] Broader NSE universe SMALLCAP-bucket duplication, beyond item 7's fix

While fixing item 7, found the `SMALLCAP` array (`nse-universe.ts`) has substantially more duplication than the originally-flagged 18 tickers: dozens of symbols also appear in `FNO_EXTRA`/`NIFTY100` (e.g. CROMPTON, HAVELLS, TATAPOWER ×2, TORNTPOWER, KNRCON, SOLARINDS, LUPIN, ADANIGREEN, ADANIPOWER, KPRMILL, ORIENTELEC, CUMMINSIND, ZENSARTECH, GODREJAGRO, MARICO, COLPAL, JYOTHYLAB, EIDPARRY ×2), and several large-cap names are mislabeled under the `SMALLCAP` category by market cap (Tata Steel, JSW Steel, Titan, Siemens, ABB, Dabur, Britannia, Colgate — none of these are smallcaps). Not fixed this pass — it's a much bigger cleanup (400+ line file) than the specific tickers in item 7, and re-categorizing by real market cap is a separate judgment call from fixing wrong/stale symbols.

**Action**: dedicated pass to dedupe the SMALLCAP array against the other category buckets and re-verify market-cap categorization.

## 10. [CRITICAL, RESOLVED 2026-07-26] Wallet capital double-counting bug

`recalcWallet()` (`src/app/api/auto-trade/route.ts`) computed `total = w.totalCapital + w.realizedPnl`, but `totalCapital` is already `initialCapital + realizedPnl` everywhere else in the codebase (confirmed via `trades/route.ts`'s `newTotalCapital` and `risk-metrics/route.ts`'s back-calc) — this double-counted realizedPnl, and since the result was persisted back into `totalCapital`, every subsequent call compounded the error further (unbounded inflation, also corrupting the drawdown circuit-breaker's peak-capital tracking via `updatePeakCapital(nav)`). Same double-count also found and fixed in `getPortfolioDrawdown()`'s peak candidate. Fixed by using `w.initialCapital + w.realizedPnl` instead.

**Action if wallet numbers look off historically**: this bug may have already inflated `totalCapital`/`peakCapital` in the live DB before the fix landed — worth checking the current wallet record's `totalCapital` against `initialCapital + realizedPnl` by hand once, and correcting it manually if they've drifted apart.

## 11. [RESOLVED 2026-07-26] Several dashboard widgets were showing fabricated data instead of real computed values

Found and fixed during the fresh re-audit:
- `options/positions/route.ts` computed live option P&L from a **Black-Scholes theoretical premium** (assumed IV=0.15, fixed 7% risk-free rate) instead of the real DhanHQ option-chain LTP that `getContractCurrentPrice()` (already used elsewhere, e.g. `recalcWallet()`) provides — now uses the real quote.
- `backtest-tab.tsx`'s "Historical Monthly Strategy Returns Heatmap" was 12 hardcoded fake Jan-Dec percentages + a fake "88.5%" consistency badge, regardless of what a backtest actually returned — the real per-month P&L (`monthlyPnl`, already computed by `screening-engine.ts` from real trade exit dates) was sitting unused in `result` the whole time. Also removed 3 fake `||` fallback literals (58.3%/1.72x/₹690784/TOP_7_RANKED_SYMBOLS) in the batch-backtest view that would silently replace a genuinely bad (falsy/zero) real result with a fake good-looking number.
- `holdings-tab.tsx`'s "Today's P&L" column was `pos.pnl * 0.45` — an arbitrary flat 45%-of-total-unrealized-P&L guess with no relation to the actual day's price move. Now computed from a real previous-close field (added to `/api/portfolio/summary`, sourced from `getCurrentPrice()`'s already-existing but previously-unused `quote.previousClose`).
- `analytics-overview.tsx`'s "Statutory Fees & Net Take-Home" calculator used a flat ₹45/trade + ₹15/trade guess — now sums each closed trade's real `brokerageCost`/`sttCost`/`otherCharges`/`totalCosts` fields (already computed and persisted at trade-close time, just never read by this widget).
