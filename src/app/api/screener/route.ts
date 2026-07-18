import { NextRequest, NextResponse } from 'next/server';
import { runScreening, DEFAULT_CONFIG, type ScreeningConfig } from '@/lib/trading/screening-engine';
import { getHistoricalData } from '@/lib/trading/data-provider';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const symbols: string[] = body.symbols || [];
    const days = body.days || 300;

    if (symbols.length === 0) {
      // If no symbols provided, use watchlist
      const wl = await db.watchlistStock.findMany({ orderBy: { symbol: 'asc' } });
      symbols.push(...wl.map(s => s.symbol));
    }
    if (symbols.length === 0) {
      return NextResponse.json({ success: true, results: [], totalScanned: 0, signalsFound: 0 });
    }

    // Fetch Nifty data
    const { data: niftyCandles, source } = await getHistoricalData('NIFTY50', days);
    const results: ReturnType<typeof runScreening>[] = [];

    for (const symbol of symbols) {
      try {
        const { data: candles } = await getHistoricalData(symbol, days);
        const result = runScreening(symbol, candles, niftyCandles, config);
        if (result) results.push(result);
      } catch (err) {
        console.error(`Screening failed for ${symbol}:`, err);
      }
    }

    results.sort((a, b) => b.score - a.score || b.riskReward - a.riskReward);

    // Save to DB
    for (const r of results) {
      let stock = await db.watchlistStock.findUnique({ where: { symbol: r.symbol } });
      if (!stock) {
        stock = await db.watchlistStock.create({ data: { symbol: r.symbol, name: r.symbol, sector: 'Unknown' } });
      }
      await db.screeningResult.create({
        data: {
          stockId: stock.id, symbol: r.symbol, score: r.score,
          setupType: r.setupType || 'B',
          entryPrice: r.entryPrice, stopLoss: r.stopLoss, targetPrice: r.targetPrice,
          riskReward: r.riskReward, atr: r.atr, rsi: r.rsi,
          trendAbove: r.checks.trendAbove, pullbackOk: r.checks.pullbackOk,
          triggerOk: r.checks.triggerOk, volumeOk: r.checks.volumeOk,
          rsOk: r.checks.rsOk, gapOk: r.checks.gapOk,
          regimeSafe: r.checks.regimeSafe, liquid: r.checks.liquid,
          trending: r.checks.trending, validVol: r.checks.validVol,
          qtyA: r.sizing.qtyA, qtyB: r.sizing.qtyB,
        },
      });
    }

    return NextResponse.json({
      success: true, results,
      scannedAt: new Date().toISOString(),
      totalScanned: symbols.length,
      signalsFound: results.length,
      dataSource: source,
    });
  } catch (error) {
    console.error('Screening error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const results = await db.screeningResult.findMany({
      orderBy: { createdAt: 'desc' }, take: 50, include: { stock: true },
    });
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}