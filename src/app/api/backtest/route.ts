import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const symbol: string = body.symbol;
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const days = body.days || 300;

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol is required' }, { status: 400 });
    }

    // Fetch real data
    const [stockRes, niftyRes] = await Promise.all([
      getHistoricalData(symbol, days + 50),
      getHistoricalData('NIFTY50', days + 50),
    ]);
    const candles = stockRes.data;
    const niftyCandles = niftyRes.data;
    const dataSource = stockRes.source;

    const result = runBacktest(symbol, candles, niftyCandles, config);

    const run = await db.backtestRun.create({
      data: {
        name: `${symbol} Backtest - ${new Date().toLocaleDateString()} [${dataSource}]`,
        symbol,
        startDate: candles[candles.length - days]?.date ? new Date(candles[candles.length - days].date) : new Date(),
        endDate: new Date(candles[candles.length - 1].date),
        initialCapital: config.liveCapital,
        finalCapital: result.stats.finalCapital,
        totalTrades: result.stats.totalTrades,
        winTrades: result.stats.winTrades,
        lossTrades: result.stats.lossTrades,
        winRate: result.stats.winRate,
        profitFactor: result.stats.profitFactor,
        maxDrawdown: result.stats.maxDrawdown,
        avgWin: result.stats.avgWin,
        avgLoss: result.stats.avgLoss,
        bestTrade: result.stats.bestTrade,
        worstTrade: result.stats.worstTrade,
        sharpeRatio: result.stats.sharpeRatio,
        config: JSON.stringify(config),
      },
    });

    for (const t of result.trades) {
      await db.backtestTrade.create({
        data: {
          run: { connect: { id: run.id } },
          symbol: t.symbol,
          entryDate: new Date(t.entryDate),
          exitDate: new Date(t.exitDate),
          entryPrice: t.entryPrice,
          exitPrice: t.exitPrice,
          qty: t.qty,
          pnl: t.pnl,
          pnlPercent: t.pnlPercent || 0,
          score: t.score,
          setupType: t.setupType,
          exitReason: t.exitReason,
        },
      });
    }

    return NextResponse.json({ success: true, runId: run.id, dataSource, ...result });
  } catch (error) {
    console.error('Backtest error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const runs = await db.backtestRun.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    return NextResponse.json({ success: true, runs });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}