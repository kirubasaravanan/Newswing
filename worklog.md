---
Task ID: 2
Agent: Main Agent
Task: Add PMS improvements — full universe scan, risk metrics, benchmark, alerts, capital gains, rebalance, multi-portfolio

Work Log:
- Updated screener API to support `scanMode: 'universe'` — scans ~230 F&O+midcap stocks instead of 30 watchlist
- Added scanner UI toggle: "Watchlist (30)" vs "Full Universe (~230)" buttons
- Created `/api/portfolio/risk-metrics` — Sharpe, Sortino, Max DD, Calmar, VaR 95%, CAGR, avg holding days
- Created `/api/portfolio/benchmark` — portfolio vs Nifty 50 comparison chart with alpha/beta calculation
- Created `/api/portfolio/alerts` — CRUD + check alerts against live Yahoo prices (ABOVE/BELOW conditions)
- Created `/api/portfolio/capital-gains` — STCG (20%) / LTCG (12.5% with ₹1.25L exemption) tax report by FY
- Created `/api/portfolio/rebalance` — sector allocation analysis with buy/sell suggestions
- Created `/api/portfolios` — multi-portfolio support (create/list/delete portfolios)
- Added Prisma models: Portfolio, PriceAlert
- Enhanced Analytics tab with 6 sub-tabs: Overview, Risk Metrics, Benchmark, Alerts, Capital Gains, Rebalance
- Added Active Alerts panel to Dashboard
- Build passes with all 6 new API routes

Stage Summary:
- Scanner now supports full NSE universe (~230 stocks) via toggle
- 6 new PMS-grade features added
- Analytics tab transformed from 1 view to 6-tab professional analytics dashboard
- All data remains 100% real Yahoo Finance — zero mock