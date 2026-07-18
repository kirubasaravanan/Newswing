import { NextResponse } from 'next/server';
import { getHistoricalData } from '@/lib/trading/data-provider';
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
    const niftyStart = recent[0]?.close || 1;
    const niftyReturns = recent.map((c, i) => {
      if (i === 0) return 0;
      return ((c.close - recent[i - 1].close) / recent[i - 1].close) * 100;
    });
    const niftyCumulative = niftyReturns.reduce((acc: number[], r) => {
      acc.push((acc[acc.length - 1] || 0) + r);
      return acc;
    }, [0]);

    // Calculate portfolio equity curve from closed trades
    const closedTrades = await db.paperTrade.findMany({
      where: { status: 'CLOSED', pnl: { not: null }, exitDate: { not: null } },
      orderBy: { exitDate: 'asc' },
    });

    // Build daily portfolio returns
    const startDate = new Date(recent[0]?.date || Date.now());
    const portfolioMap = new Map<string, number>();

    for (const t of closedTrades) {
      if (t.exitDate && t.pnl != null) {
        const d = new Date(t.exitDate).toISOString().split('T')[0];
        portfolioMap.set(d, (portfolioMap.get(d) || 0) + t.pnl);
      }
    }

    const portfolioCumulative = [0];
    let runningPnl = 0;
    for (const candle of recent) {
      runningPnl += portfolioMap.get(candle.date) || 0;
      portfolioCumulative.push(runningPnl);
    }

    // Align dates
    const chartData = recent.map((c, i) => ({
      date: c.date,
      nifty: Math.round((niftyCumulative[i] || 0) * 100) / 100,
      portfolio: Math.round(portfolioCumulative[i + 1] || 0),
      niftyClose: c.close,
    }));

    // Beta calculation
    let covXY = 0, varX = 0, meanX = 0, meanY = 0;
    const n = Math.min(niftyReturns.length - 1, portfolioCumulative.length - 2);
    if (n > 10) {
      const xSlice = niftyReturns.slice(1, n + 1);
      const ySlice = portfolioCumulative.slice(2, n + 2).map(v => v - (portfolioCumulative[1] || 0));
      const mx = xSlice.reduce((a, b) => a + b, 0) / xSlice.length;
      const my = ySlice.reduce((a, b) => a + b, 0) / ySlice.length;
      for (let i = 0; i < xSlice.length; i++) {
        covXY += (xSlice[i] - mx) * (ySlice[i] - my);
        varX += (xSlice[i] - mx) ** 2;
      }
      const beta = varX > 0 ? Math.round((covXY / varX) * 100) / 100 : 1;
      varX = 0;
    }

    const beta = varX > 0 ? Math.round((covXY / varX) * 100) / 100 : null;
    const niftyTotalReturn = niftyCumulative[niftyCumulative.length - 1] || 0;
    const portfolioTotalReturn = portfolioCumulative[portfolioCumulative.length - 1] || 0;

    return NextResponse.json({
      success: true,
      benchmark: {
        niftyTotalReturn: Math.round(niftyTotalReturn * 100) / 100,
        portfolioTotalReturn: Math.round(portfolioTotalReturn),
        alpha: Math.round((portfolioTotalReturn - niftyTotalReturn * 100) * 100) / 100, // rough
        beta,
        chartData,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}