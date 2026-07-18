import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalData, getCurrentPrice, toYahooSymbol } from '@/lib/trading/data-provider';
import { EMA } from 'technicalindicators';

// GET /api/chart-data?symbol=RELIANCE&days=60
// Returns OHLCV + EMA20 for the mini sparkline chart
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const days = parseInt(searchParams.get('days') || '60');

    if (!symbol) {
      return NextResponse.json({ success: false, error: 'Symbol required' });
    }

    const { data: candles, source } = await getHistoricalData(symbol, 300);
    const recent = candles.slice(-days);

    // Calculate EMA20
    const ema20 = EMA.calculate({ period: 20, values: recent.map(c => c.close) });
    const paddedEMA = new Array(recent.length - ema20.length).fill(null).concat(ema20);

    const chartData = recent.map((c, i) => ({
      date: c.date, close: c.close, open: c.open, high: c.high, low: c.low,
      volume: c.volume, ema20: paddedEMA[i],
    }));

    // Also return current price + TradingView symbol
    const tvSymbol = `NSE:${symbol}`;
    const { price: currentPrice } = await getCurrentPrice(symbol);

    return NextResponse.json({
      success: true, symbol, dataSource: source, tvSymbol, currentPrice, data: chartData,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}