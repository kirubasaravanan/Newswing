import { NextResponse } from 'next/server';
import { getHistoricalData, getContractCurrentPrice } from '@/lib/trading/data-provider';
import { db } from '@/lib/db';

// GET /api/portfolio/benchmark?days=90
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '90');

    // Fetch Nifty 50 historical data
    const { data: niftyData } = await getHistoricalData('NIFTY50', days + 30);
    const recent = niftyData.slice(-days);

    // Calculate Nifty returns
    const niftyReturns = recent.map((c, i) => {
      if (i === 0) return 0;
      return ((c.close - recent[i - 1].close) / recent[i - 1].close) * 100;
    });
    const niftyCumulative = niftyReturns.reduce((acc: number[], r) => {
      acc.push((acc[acc.length - 1] || 0) + r);
      return acc;
    }, [0]);

    // Capital base to express portfolio P&L as % — comparable units to Nifty's
    // % return (previously the portfolio side was left in raw rupees, which
    // is not comparable to a percentage and produced a meaningless "alpha").
    const wallet = await db.capitalWallet.findFirst();
    const capitalBase = wallet?.initialCapital && wallet.initialCapital > 0 ? wallet.initialCapital : 300000;

    // Calculate portfolio equity curve from closed trades
    const closedTrades = await db.paperTrade.findMany({
      where: { status: 'CLOSED', pnl: { not: null }, exitDate: { not: null } },
      orderBy: { exitDate: 'asc' },
    });

    const portfolioMap = new Map<string, number>();
    for (const t of closedTrades) {
      if (t.exitDate && t.pnl != null) {
        const d = new Date(t.exitDate).toISOString().split('T')[0];
        portfolioMap.set(d, (portfolioMap.get(d) || 0) + t.pnl);
      }
    }

    const portfolioCumulativePct = [0];
    let runningPnl = 0;
    for (const candle of recent) {
      runningPnl += portfolioMap.get(candle.date) || 0;
      portfolioCumulativePct.push((runningPnl / capitalBase) * 100);
    }

    // Fold in TODAY's real open-position unrealized P&L on the latest point —
    // previously open positions were silently excluded from the whole curve,
    // which could make the portfolio look flat/underperforming purely because
    // its current risk wasn't represented at all.
    const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN' } });
    let unrealizedPnl = 0;
    const openSyms = [...new Set(openTrades.map(t => t.symbol))];
    for (const sym of openSyms) {
      const price = await getContractCurrentPrice(sym, 0);
      if (price <= 0) continue;
      for (const t of openTrades.filter(t => t.symbol === sym)) {
        const diff = t.direction === 'SHORT' ? (t.entryPrice - price) : (price - t.entryPrice);
        unrealizedPnl += diff * t.qty;
      }
    }
    if (portfolioCumulativePct.length > 0) {
      portfolioCumulativePct[portfolioCumulativePct.length - 1] += (unrealizedPnl / capitalBase) * 100;
    }

    // Align dates
    const chartData = recent.map((c, i) => ({
      date: c.date,
      nifty: Math.round((niftyCumulative[i] || 0) * 100) / 100,
      portfolio: Math.round((portfolioCumulativePct[i + 1] || 0) * 100) / 100,
      niftyClose: c.close,
    }));

    // Beta: regress the portfolio's own daily % changes against Nifty's daily
    // % returns — both real per-period returns in the same units. Previously
    // this regressed Nifty's daily returns against cumulative portfolio RUPEE
    // levels — neither the same unit nor the same statistical object (a
    // non-stationary cumulative series vs. period returns).
    const portfolioDailyPct = portfolioCumulativePct.slice(1).map((v, i) => v - (portfolioCumulativePct[i] || 0));
    let beta: number | null = null;
    const n = Math.min(niftyReturns.length - 1, portfolioDailyPct.length - 1);
    if (n > 10) {
      const xSlice = niftyReturns.slice(1, n + 1);
      const ySlice = portfolioDailyPct.slice(1, n + 1);
      let covXY = 0, varX = 0;
      const mx = xSlice.reduce((a, b) => a + b, 0) / xSlice.length;
      const my = ySlice.reduce((a, b) => a + b, 0) / ySlice.length;
      for (let i = 0; i < xSlice.length; i++) {
        covXY += (xSlice[i] - mx) * (ySlice[i] - my);
        varX += (xSlice[i] - mx) ** 2;
      }
      beta = varX > 0 ? Math.round((covXY / varX) * 100) / 100 : null;
    }

    const niftyTotalReturn = niftyCumulative[niftyCumulative.length - 1] || 0;
    const portfolioTotalReturn = portfolioCumulativePct[portfolioCumulativePct.length - 1] || 0;

    return NextResponse.json({
      success: true,
      benchmark: {
        niftyTotalReturn: Math.round(niftyTotalReturn * 100) / 100,
        portfolioTotalReturn: Math.round(portfolioTotalReturn * 100) / 100,
        // Alpha: both sides are now real % returns over the same window —
        // no more rupee-vs-percent unit mismatch.
        alpha: Math.round((portfolioTotalReturn - niftyTotalReturn) * 100) / 100,
        beta,
        chartData,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}