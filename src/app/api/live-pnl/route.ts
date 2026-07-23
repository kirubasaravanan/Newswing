import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

export async function GET() {
  try {
    const openTrades = await db.paperTrade.findMany({ where: { status: 'OPEN' }, orderBy: { entryDate: 'desc' } });
    if (openTrades.length === 0) {
      return NextResponse.json({ success: true, positions: [], totalPnL: 0 });
    }

    const { getContractCurrentPrice } = await import('@/lib/trading/data-provider');
    const priceMap: Record<string, number> = {};
    await Promise.all(openTrades.map(async (t) => {
      const price = await getContractCurrentPrice(t.symbol, t.entryPrice);
      priceMap[t.symbol] = price;
    }));

    const positions = openTrades.map(trade => {
      const currentPrice = priceMap[trade.symbol] ?? trade.entryPrice;
      if (!currentPrice) {
        // No live price available — return position without fake P&L
        return {
          id: trade.id, symbol: trade.symbol, direction: trade.direction || 'LONG', entryPrice: trade.entryPrice,
          currentPrice: 0, qty: trade.qty, stopLoss: trade.stopLoss, targetPrice: trade.targetPrice,
          pnl: 0, pnlPercent: 0, priceUnavailable: true,
          maxLoss: Math.abs(trade.entryPrice - trade.stopLoss) * trade.qty,
          maxProfit: Math.abs(trade.targetPrice - trade.entryPrice) * trade.qty,
          entryDate: trade.entryDate,
          holdingDays: Math.round((Date.now() - new Date(trade.entryDate).getTime()) / 86400000),
          autoTraded: trade.autoTraded,
        };
      }
      const direction = trade.direction || 'LONG';
      const priceDiff = direction === 'LONG' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
      const pnl = priceDiff * trade.qty;
      const pnlPercent = (priceDiff / trade.entryPrice) * 100;
      const riskPerShare = Math.abs(trade.entryPrice - trade.stopLoss);
      const rMultiple = riskPerShare > 0 ? priceDiff / riskPerShare : 0;

      return {
        id: trade.id, symbol: trade.symbol, direction, entryPrice: trade.entryPrice,
        currentPrice, qty: trade.qty, stopLoss: trade.stopLoss, targetPrice: trade.targetPrice,
        pnl, pnlPercent, rMultiple,
        maxLoss: riskPerShare * trade.qty,
        maxProfit: Math.abs(trade.targetPrice - trade.entryPrice) * trade.qty,
        entryDate: trade.entryDate,
        holdingDays: Math.round((Date.now() - new Date(trade.entryDate).getTime()) / 86400000),
        autoTraded: trade.autoTraded,
      };
    });

    const totalPnL = positions.reduce((s, p) => s + p.pnl, 0);
    return NextResponse.json({ success: true, positions, totalPnL });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}