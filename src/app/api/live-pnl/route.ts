import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { generateMockData } from '@/lib/trading/mock-data';

// GET live P&L for all open paper trades
export async function GET() {
  try {
    const openTrades = await db.paperTrade.findMany({
      where: { status: 'OPEN' },
      orderBy: { entryDate: 'desc' },
    });

    if (openTrades.length === 0) {
      return NextResponse.json({ success: true, positions: [], totalPnL: 0 });
    }

    // Get unique symbols
    const symbols = [...new Set(openTrades.map(t => t.symbol))];

    // Generate fresh mock data for each symbol to get "current" price
    const priceMap: Record<string, number> = {};
    for (const sym of symbols) {
      try {
        const data = generateMockData(sym, 10, new Date());
        if (data.length > 0) {
          priceMap[sym] = data[data.length - 1].close;
        }
      } catch {
        // fallback to entry price
      }
    }

    const positions = openTrades.map(trade => {
      const currentPrice = priceMap[trade.symbol] || trade.entryPrice;
      const direction = trade.direction || 'LONG';
      const priceDiff = direction === 'LONG'
        ? currentPrice - trade.entryPrice
        : trade.entryPrice - currentPrice;
      const pnl = priceDiff * trade.qty;
      const pnlPercent = (priceDiff / trade.entryPrice) * 100;

      const riskPerShare = Math.abs(trade.entryPrice - trade.stopLoss);
      const maxLoss = riskPerShare * trade.qty;
      const rewardPerShare = Math.abs(trade.targetPrice - trade.entryPrice);
      const maxProfit = rewardPerShare * trade.qty;
      const rMultiple = riskPerShare > 0 ? priceDiff / riskPerShare : 0;

      return {
        id: trade.id,
        symbol: trade.symbol,
        direction,
        entryPrice: trade.entryPrice,
        currentPrice,
        qty: trade.qty,
        stopLoss: trade.stopLoss,
        targetPrice: trade.targetPrice,
        pnl,
        pnlPercent,
        rMultiple,
        maxLoss,
        maxProfit,
        entryDate: trade.entryDate,
        holdingDays: Math.round((Date.now() - new Date(trade.entryDate).getTime()) / (1000 * 60 * 60 * 24)),
      };
    });

    const totalPnL = positions.reduce((s: number, p: { pnl: number }) => s + p.pnl, 0);

    return NextResponse.json({ success: true, positions, totalPnL });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}