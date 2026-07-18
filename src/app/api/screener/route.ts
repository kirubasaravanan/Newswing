import { NextRequest, NextResponse } from 'next/server';
import { runScreening, DEFAULT_WATCHLIST, DEFAULT_CONFIG, type ScreeningConfig, type OHLCV } from '@/lib/trading/screening-engine';
import { generateMockData, generateNiftyData, getAllProfiles } from '@/lib/trading/mock-data';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const symbols: string[] = body.symbols || DEFAULT_WATCHLIST.map(s => s.symbol);
    const days = body.days || 300;

    // Generate mock data (in production, fetch from real API)
    const niftyCandles = generateNiftyData(days);
    const results: ReturnType<typeof runScreening>[] = [];

    for (const symbol of symbols) {
      const candles = generateMockData(symbol, days);
      const result = runScreening(symbol, candles, niftyCandles, config);
      if (result) results.push(result);
    }

    // Sort by score descending, then by R:R
    results.sort((a, b) => b.score - a.score || b.riskReward - a.riskReward);

    // Save to database
    const { db } = await import('@/lib/db');
    
    // Upsert watchlist stocks
    for (const s of getAllProfiles()) {
      if (symbols.includes(s.symbol)) {
        await db.watchlistStock.upsert({
          where: { symbol: s.symbol },
          create: { symbol: s.symbol, name: s.name, sector: s.sector },
          update: { name: s.name, sector: s.sector },
        });
      }
    }

    // Save screening results
    for (const r of results) {
      const stock = await db.watchlistStock.findUnique({ where: { symbol: r.symbol } });
      await db.screeningResult.create({
        data: {
          stockId: stock?.id || '',
          symbol: r.symbol,
          score: r.score,
          setupType: r.setupType || 'B',
          entryPrice: r.entryPrice,
          stopLoss: r.stopLoss,
          targetPrice: r.targetPrice,
          riskReward: r.riskReward,
          atr: r.atr,
          rsi: r.rsi,
          trendAbove: r.checks.trendAbove,
          pullbackOk: r.checks.pullbackOk,
          triggerOk: r.checks.triggerOk,
          volumeOk: r.checks.volumeOk,
          rsOk: r.checks.rsOk,
          gapOk: r.checks.gapOk,
          regimeSafe: r.checks.regimeSafe,
          liquid: r.checks.liquid,
          trending: r.checks.trending,
          validVol: r.checks.validVol,
          qtyA: r.sizing.qtyA,
          qtyB: r.sizing.qtyB,
        },
      });
    }

    return NextResponse.json({
      success: true,
      results,
      scannedAt: new Date().toISOString(),
      totalScanned: symbols.length,
      signalsFound: results.length,
    });
  } catch (error) {
    console.error('Screening error:', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { db } = await import('@/lib/db');
    const results = await db.screeningResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { stock: true },
    });
    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}