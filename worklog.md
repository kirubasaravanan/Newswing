---
Task ID: 1
Agent: Main Agent
Task: Build complete V-Swing Trading Desk end-to-end application

Work Log:
- Designed and implemented Prisma database schema with 6 models: WatchlistStock, ScreeningResult, PaperTrade, TradeJournalEntry, BacktestRun, BacktestTrade, AppSettings
- Installed technical-indicators library for TA computations
- Ported Pine Script V-Swing v65.5 strategy to TypeScript screening engine (SMA, EMA, RSI, ATR, ADX, 6-factor confluence scoring, position sizing)
- Built mock data generator for 30 NSE stocks with realistic OHLCV data
- Created API routes: /api/screener, /api/trades, /api/journal, /api/backtest, /api/market-data
- Built full backtest engine with equity curve, pyramiding, partial TP, trailing stop, dead capital exit
- Built Zustand state management store
- Built 5 frontend tabs: Screener, Journal, Backtest, Analytics, Sizing Calculator
- Created dark-themed trading terminal UI with custom CSS
- Verified all tabs work via Agent Browser testing
- Fixed DMI→ADX import, Prisma relation bugs, qty=0 edge case in backtest

Stage Summary:
- Complete working V-Swing Trading Desk with screening, journal, backtesting, analytics, and position sizing
- 9 signals found on 30-stock NSE scan, backtest produces equity curves and trade logs
- All 5 tabs verified working in Agent Browser
- Lint passes with 0 errors