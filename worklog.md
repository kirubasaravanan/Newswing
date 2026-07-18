---
Task ID: 1
Agent: Main
Task: Fix yahoo-finance2 v4 crash and migrate to direct Yahoo Finance API

Work Log:
- Diagnosed yahoo-finance2 v4 npm package causing silent native crashes (SIGSEGV) in Next.js server context
- Tested yahoo-finance2 v4 constructor — works in plain Node.js but crashes inside Next.js server
- Replaced entire yahoo-finance2 dependency with direct fetch() to Yahoo Finance v8 chart API
- Discovered Yahoo v7 quote API returns 401 Unauthorized — rewrote quote function to extract current price from chart API metadata (meta.regularMarketPrice, meta.chartPreviousClose, meta.regularMarketDayHigh/Low/Volume)
- Added Yahoo symbol alias map for NSE→Yahoo mismatches (BAJAJAUTO→BAJAJ-AUTO.NS, TATAMOTORS→TMCV.NS, MOTHERSON→MSUMI.NS, etc.)
- Fixed standalone build — added serverExternalPackages for technicalindicators + copy script for standalone node_modules
- Fixed broken universe scanner symbols (removed duplicate L&T, replaced VUJIFINANCE with CHOLAFIN)
- Validated all 11 GET API routes pass
- Tested POST screener scan (31 stocks, 12.5s, real Yahoo data)
- Tested L1 universe scan (20 stocks, 28s, 25 passed L1)
- Tested auto-trade dashboard (wallet ₹200K, rules configured, check_exits works)

Stage Summary:
- yahoo-finance2 completely removed — zero native dependencies for market data
- All API routes verified working with real Yahoo Finance data
- 32+ NSE symbols validated and cached
- Symbol alias map handles 15+ known NSE→Yahoo mismatches
- Files changed: data-provider.ts (rewritten), next.config.ts, package.json, universe-scanner.ts, copy-standalone-deps.mjs (new)
