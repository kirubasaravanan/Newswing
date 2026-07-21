import { NextRequest, NextResponse } from 'next/server';
import { runBacktest, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const symbol: string = body.symbol || 'TATAELXSI';
    const engine: 'OPTIONS' | 'SWING' = body.engine || body.config?.engineMode || (
      symbol.toUpperCase().includes('NIFTY') || symbol.toUpperCase().includes('BANK') || symbol.toUpperCase().includes('FIN') ? 'OPTIONS' : 'SWING'
    );
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, engineMode: engine, ...body.config };
    const days = body.days || 1825; // 5 full years (1825 days) up to 2026

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol is required' }, { status: 400 });
    }

    // Fetch real 5-year historical OHLCV candles
    const stockRes = await getHistoricalData(symbol, days);
    const candles = stockRes.data || [];
    const dataSource = stockRes.source || 'dhan';

    const result = runBacktest(symbol, candles, config);

    const stats = result?.stats || {
      totalTrades: 0, winTrades: 0, lossTrades: 0, winRate: 0,
      profitFactor: 0, maxDrawdown: 0, finalCapital: config.liveCapital,
      avgWin: 0, avgLoss: 0, bestTrade: 0, worstTrade: 0, sharpeRatio: 0
    };

    const trades = result?.trades || [];
    const equityCurve = result?.equityCurve || [];

    const startDate = candles.length > 0 ? new Date(candles[0].date) : new Date('2021-01-01');
    const endDate = candles.length > 0 ? new Date(candles[candles.length - 1].date) : new Date();

    const run = await db.backtestRun.create({
      data: {
        name: `${symbol} [${engine}] - ${new Date().toLocaleDateString()} [${dataSource}]`,
        symbol,
        startDate,
        endDate,
        initialCapital: config.liveCapital,
        finalCapital: stats.finalCapital,
        totalTrades: stats.totalTrades,
        winTrades: stats.winTrades,
        lossTrades: stats.lossTrades,
        winRate: stats.winRate,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
        avgWin: stats.avgWin,
        avgLoss: stats.avgLoss,
        bestTrade: stats.bestTrade,
        worstTrade: stats.worstTrade,
        sharpeRatio: stats.sharpeRatio,
        config: JSON.stringify(config),
      },
    });

    return NextResponse.json({
      success: true,
      runId: run.id,
      symbol,
      engine,
      stats,
      trades,
      equityCurve,
      dataSource
    });
  } catch (error) {
    console.error('Backtest API error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}