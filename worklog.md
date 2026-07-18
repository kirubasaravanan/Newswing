---
Task ID: 1
Agent: Main Agent
Task: Kill all mock data fallbacks, transform into Portfolio Management System

Work Log:
- Removed mock fallbacks from data-provider.ts getHistoricalData() and getCurrentPrice() — now throws errors instead of silently returning fake data
- Replaced sticky global yahooAvailable flag with per-symbol failure tracking (symbolFailures Map + MAX_SYMBOL_FAILURES=2)
- Changed DataSource type from 'yahoo'|'mock'|'auto' to 'yahoo'|'error'
- Created /src/lib/trading/default-stocks.ts — clean stock metadata list separated from mock-data.ts
- Fixed /api/watchlist/route.ts to seed from default-stocks.ts instead of mock-data.ts
- Rewrote /api/market-data/route.ts to fetch live Yahoo quotes (with 5-min cache, 20-symbol cap)
- Created /api/portfolio/summary/route.ts — new endpoint for dashboard (positions, sector allocation, P&L)
- Created /src/components/trading/dashboard-tab.tsx — portfolio dashboard with KPI cards, positions list, watchlist live prices, sector allocation pie chart, activity log
- Created /src/components/trading/holdings-tab.tsx — full holdings management (add/sell positions, live P&L, closed trades, TradingView charts)
- Updated sidebar.tsx — new nav (Dashboard, Holdings, Scanner, Journal, Analytics, Backtest, Settings), PM branding, Yahoo status indicator
- Updated store (trade-store.ts) — new AppTab type, default tab 'dashboard'
- Updated page.tsx — new tab routing, removed old header bar
- Updated layout.tsx metadata — "Portfolio Manager — Private System"
- Fixed auto-trade-tab.tsx badge text from 'Mock' to 'Error'

Stage Summary:
- ALL mock data fallbacks eliminated — 100% real Yahoo Finance data
- UI transformed from "V-Swing Trading Desk" to "Portfolio Manager" (Private System)
- New Dashboard tab: portfolio value, P&L, win rate, sector allocation pie, watchlist live prices
- New Holdings tab: position table with live P&L, add/sell dialogs, closed trades section
- Build passes, APIs verified (15+ real stock prices confirmed from Yahoo)