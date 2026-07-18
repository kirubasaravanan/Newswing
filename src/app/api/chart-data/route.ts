import { NextRequest, NextResponse } from 'next/server';
import { SMA, EMA } from 'technicalindicators';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const days = parseInt(searchParams.get('days') || '60');

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol required' });
    }

    const { generateMockData } = await import('@/lib/trading/mock-data');
    const candles = generateMockData(symbol, 300);
    const recent = candles.slice(-days);

    const ema20 = EMA.calculate({ period: 20, values: recent.map(c => c.close) });
    const paddedEMA = new Array(recent.length - ema20.length).fill(null).concat(ema20);

    const chartData = recent.map((c, i) => ({
      date: c.date,
      close: c.close,
      ema20: paddedEMA[i],
    }));

    return NextResponse.json({ success: true, symbol, data: chartData });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}