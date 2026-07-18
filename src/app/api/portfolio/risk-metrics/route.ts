import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/portfolio/risk-metrics
export async function GET() {
  try {
    const closedTrades = await db.paperTrade.findMany({
      where: { status: 'CLOSED', pnl: { not: null }, pnlPercent: { not: null } },
      orderBy: { exitDate: 'asc' },
    });

    // Get actual capital from wallet (not hardcoded)
    let initialCapital = 200000;
    try {
      const wallet = await db.capitalWallet.findFirst();
      if (wallet) {
        // Use initialCapital setting if stored, otherwise back-calculate
        const ic = await db.appSettings.findUnique({ where: { key: 'initialCapital' } });
        if (ic) {
          initialCapital = parseFloat(ic.value) || 200000;
        } else {
          // Back-calculate: current totalCapital minus all realized P&L
          initialCapital = wallet.totalCapital - wallet.realizedPnl;
          if (initialCapital <= 0) initialCapital = 200000;
        }
      }
    } catch { /* use default */ }

    if (closedTrades.length < 5) {
      return NextResponse.json({
        success: true,
        metrics: { sharpe: 0, sortino: 0, maxDD: 0, calmar: 0, var95: 0, cagr: 0, avgHoldingDays: 0, bestTrade: 0, worstTrade: 0, expectancy: 0, avgRMultiple: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, winRate: 0 },
        tradeCount: closedTrades.length,
        initialCapital,
      });
    }

    // ── Use % returns, not absolute ₹ ─────────────────────────
    const returns = closedTrades.map(t => t.pnlPercent || 0);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const n = returns.length;

    // Sample std dev (n-1)
    const stdDev = n > 1
      ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (n - 1))
      : 0;

    // Sharpe (annualized, risk-free ~7% per year → per-trade = 7%/250)
    const riskFreePerTrade = 0.07 / 250 * 100; // in %
    const sharpe = stdDev > 0
      ? ((avgReturn - riskFreePerTrade) / stdDev) * Math.sqrt(250)
      : 0;

    // Sortino — CORRECT formula: divide by N, not just negative count
    const downsideReturns = returns.map(r => Math.min(0, r - riskFreePerTrade));
    const downsideDev = Math.sqrt(downsideReturns.reduce((s, r) => s + r ** 2, 0) / n);
    const sortino = downsideDev > 0
      ? ((avgReturn - riskFreePerTrade) / downsideDev) * Math.sqrt(250)
      : 0;

    // ── R-Multiple calculation ───────────────────────────────
    const rMultiples = closedTrades.map(t => {
      const risk = Math.abs(t.entryPrice - t.stopLoss);
      if (risk <= 0) return 0;
      const pnlPerShare = t.direction === 'SHORT'
        ? (t.entryPrice - (t.exitPrice || t.entryPrice))
        : ((t.exitPrice || t.entryPrice) - t.entryPrice);
      return pnlPerShare / risk;
    });

    const avgRMultiple = rMultiples.reduce((a, b) => a + b, 0) / rMultiples.length;

    // ── Expectancy: avgWin% × winRate - avgLoss% × lossRate ──
    const wins = returns.filter(r => r > 0);
    const losses = returns.filter(r => r <= 0);
    const winRate = wins.length / n;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
    const expectancy = (avgWin * winRate) - (avgLoss * (1 - winRate));

    // ── Profit Factor ───────────────────────────────────────
    const grossProfit = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;

    // ── Max Drawdown from equity curve (% return basis) ──────
    let peak = 0, maxDD = 0, running = 0;
    for (const r of returns) {
      running += r;
      peak = Math.max(peak, running);
      maxDD = Math.max(maxDD, peak > 0 ? ((peak - running) / peak) * 100 : 0);
    }

    // ── CAGR using actual initial capital ───────────────────
    const totalReturnPct = returns.reduce((a, b) => a + b, 0);
    const firstDate = new Date(closedTrades[0].entryDate).getTime();
    const lastDate = new Date(closedTrades[closedTrades.length - 1].exitDate || Date.now()).getTime();
    const years = Math.max((lastDate - firstDate) / (365.25 * 86400000), 0.01);
    const finalValue = initialCapital * (1 + totalReturnPct / 100);
    const cagr = (Math.pow(finalValue / initialCapital, 1 / years) - 1) * 100;
    const calmar = maxDD > 0 ? cagr / maxDD : 0;

    // ── VaR 95% on % returns ────────────────────────────────
    const sorted = [...returns].sort((a, b) => a - b);
    const varIdx = Math.floor(sorted.length * 0.05);
    const var95 = sorted[varIdx] || 0;

    // ── Average holding days ────────────────────────────────
    const holdingDays = closedTrades.map(t => {
      if (!t.exitDate) return 0;
      return (new Date(t.exitDate).getTime() - new Date(t.entryDate).getTime()) / 86400000;
    });
    const avgHoldingDays = holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length;

    const bestTrade = Math.max(...returns);
    const worstTrade = Math.min(...returns);

    return NextResponse.json({
      success: true,
      metrics: {
        sharpe: Math.round(sharpe * 100) / 100,
        sortino: Math.round(sortino * 100) / 100,
        maxDD: Math.round(maxDD * 10) / 10,
        calmar: Math.round(calmar * 100) / 100,
        var95: Math.round(var95 * 100) / 100,
        cagr: Math.round(cagr * 100) / 100,
        avgHoldingDays: Math.round(avgHoldingDays * 10) / 10,
        bestTrade: Math.round(bestTrade * 100) / 100,
        worstTrade: Math.round(worstTrade * 100) / 100,
        expectancy: Math.round(expectancy * 100) / 100,
        avgRMultiple: Math.round(avgRMultiple * 100) / 100,
        profitFactor: Math.round(profitFactor * 100) / 100,
        avgWin: Math.round(avgWin * 100) / 100,
        avgLoss: Math.round(avgLoss * 100) / 100,
        winRate: Math.round(winRate * 1000) / 10,
      },
      tradeCount: n,
      totalPnl: Math.round(closedTrades.reduce((s, t) => s + (t.pnl || 0), 0)),
      rMultiples: rMultiples.map(r => Math.round(r * 100) / 100),
      initialCapital,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}