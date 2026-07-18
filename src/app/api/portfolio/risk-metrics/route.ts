import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/portfolio/risk-metrics
export async function GET() {
  try {
    const closedTrades = await db.paperTrade.findMany({
      where: { status: 'CLOSED', pnl: { not: null } },
      orderBy: { exitDate: 'asc' },
    });

    if (closedTrades.length < 2) {
      return NextResponse.json({
        success: true,
        metrics: { sharpe: 0, sortino: 0, maxDD: 0, calmar: 0, var95: 0, cagr: 0, avgHoldingDays: 0, bestTrade: 0, worstTrade: 0 },
        tradeCount: closedTrades.length,
      });
    }

    const pnls = closedTrades.map(t => t.pnl || 0);
    const avgReturn = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const stdDev = Math.sqrt(pnls.reduce((s, p) => s + (p - avgReturn) ** 2, 0) / pnls.length);

    // Sharpe (annualized, assuming ~250 trading days, risk-free = 7% per year per trade ~₹140 on ₹2L)
    const riskFreePerTrade = 200000 * 0.07 / 250;
    const sharpe = stdDev > 0 ? ((avgReturn - riskFreePerTrade) / stdDev) * Math.sqrt(250) : 0;

    // Sortino (downside deviation only)
    const negativeReturns = pnls.filter(p => p < 0);
    const downsideDev = negativeReturns.length > 0
      ? Math.sqrt(negativeReturns.reduce((s, p) => s + p ** 2, 0) / negativeReturns.length)
      : 0.01;
    const sortino = ((avgReturn - riskFreePerTrade) / downsideDev) * Math.sqrt(250);

    // Max Drawdown from equity curve
    let peak = 0, maxDD = 0, running = 0;
    for (const p of pnls) {
      running += p;
      peak = Math.max(peak, running);
      maxDD = Math.max(maxDD, (peak - running) / (peak || 1) * 100);
    }

    // Calmar = CAGR / MaxDD
    const totalReturn = pnls.reduce((a, b) => a + b, 0);
    const firstDate = new Date(closedTrades[0].entryDate).getTime();
    const lastDate = new Date(closedTrades[closedTrades.length - 1].exitDate || Date.now()).getTime();
    const years = Math.max((lastDate - firstDate) / (365.25 * 86400000), 0.01);
    const cagr = (Math.pow((200000 + totalReturn) / 200000, 1 / years) - 1) * 100;
    const calmar = maxDD > 0 ? cagr / maxDD : 0;

    // VaR 95% (simple percentile)
    const sorted = [...pnls].sort((a, b) => a - b);
    const varIdx = Math.floor(sorted.length * 0.05);
    const var95 = sorted[varIdx] || 0;

    // Average holding days
    const holdingDays = closedTrades.map(t => {
      if (!t.exitDate) return 0;
      return (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000;
    });
    const avgHoldingDays = holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length;

    const bestTrade = Math.max(...pnls);
    const worstTrade = Math.min(...pnls);

    return NextResponse.json({
      success: true,
      metrics: {
        sharpe: Math.round(sharpe * 100) / 100,
        sortino: Math.round(sortino * 100) / 100,
        maxDD: Math.round(maxDD * 10) / 10,
        calmar: Math.round(calmar * 100) / 100,
        var95: Math.round(var95),
        cagr: Math.round(cagr * 100) / 100,
        avgHoldingDays: Math.round(avgHoldingDays),
        bestTrade: Math.round(bestTrade),
        worstTrade: Math.round(worstTrade),
      },
      tradeCount: closedTrades.length,
      totalPnl: Math.round(totalReturn),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}