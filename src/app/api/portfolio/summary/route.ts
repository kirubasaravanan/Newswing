import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getCurrentPrice } from '@/lib/trading/data-provider';

export async function GET() {
  try {
    const [openTrades, closedTrades, wallet] = await Promise.all([
      db.paperTrade.findMany({ where: { status: 'OPEN' }, orderBy: { entryDate: 'desc' } }),
      db.paperTrade.findMany({ where: { status: 'CLOSED', pnl: { not: null } } }),
      db.capitalWallet.findFirst(),
    ]);

    // Fetch live prices for open positions (stocks & option contracts)
    const { getContractCurrentPrice } = await import('@/lib/trading/data-provider');
    const priceMap: Record<string, number> = {};
    // Real previous-close per symbol — used for "Today's P&L" on the holdings
    // table. getCurrentPrice() already resolves this (Dhan ohlc.close / Yahoo
    // chartPreviousClose); it was imported here but never actually used, and
    // the frontend instead approximated intraday P&L as a flat 45% of total
    // unrealized P&L — an arbitrary number with no relation to the real
    // day's price move.
    const prevCloseMap: Record<string, number> = {};
    await Promise.all(openTrades.map(async (t) => {
      const price = await getContractCurrentPrice(t.symbol, t.entryPrice);
      priceMap[t.symbol] = price;
      try {
        const { quote } = await getCurrentPrice(t.symbol);
        if (quote?.previousClose) prevCloseMap[t.symbol] = quote.previousClose;
      } catch {
        // previous close unavailable (e.g. composite option symbol, or quote
        // fetch failed) — today's P&L will be omitted for this position
      }
    }));

    const positions = openTrades.map(trade => {
      const currentPrice = priceMap[trade.symbol] ?? trade.entryPrice;
      const direction = trade.direction || 'LONG';
      const priceDiff = direction === 'LONG' ? currentPrice - trade.entryPrice : trade.entryPrice - currentPrice;
      const pnl = priceDiff * trade.qty;
      const invested = trade.entryPrice * trade.qty;
      const currentValue = currentPrice * trade.qty;
      return {
        id: trade.id, symbol: trade.symbol, stockName: trade.stockName,
        direction, entryPrice: trade.entryPrice, qty: trade.qty,
        stopLoss: trade.stopLoss, targetPrice: trade.targetPrice,
        entryDate: trade.entryDate, autoTraded: trade.autoTraded,
        currentPrice, pnl, invested, currentValue,
        previousClose: prevCloseMap[trade.symbol] ?? 0,
        pnlPercent: trade.entryPrice > 0 ? (priceDiff / trade.entryPrice) * 100 : 0,
      };
    });

    const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
    const totalCurrentValue = positions.reduce((s, p) => s + p.currentValue, 0);
    const unrealizedPnl = positions.reduce((s, p) => s + p.pnl, 0);
    const realizedPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalPnl = unrealizedPnl + realizedPnl;

    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;

    // Sector allocation from watchlist metadata
    const allSymbols = positions.map(p => p.symbol);
    const stockRecords = await db.watchlistStock.findMany({
      where: { symbol: { in: allSymbols } },
    });
    const sectorLookup = new Map(stockRecords.map(s => [s.symbol, s.sector || 'Other']));

    const sectorMap = new Map<string, number>();
    for (const pos of positions) {
      const sector = sectorLookup.get(pos.symbol) || 'Other';
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + pos.invested);
    }
    const sectorAllocation = Array.from(sectorMap.entries()).map(([sector, value]) => ({
      sector, value, pct: totalInvested > 0 ? Math.round((value / totalInvested) * 100) : 0,
    })).sort((a, b) => b.value - a.value);

    return NextResponse.json({
      success: true,
      summary: {
        totalPositions: openTrades.length,
        totalInvested, totalCurrentValue, unrealizedPnl, realizedPnl, totalPnl,
        returnPct: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
        winRate: Math.round(winRate * 10) / 10,
        totalTrades: closedTrades.length,
        wallet,
      },
      positions,
      sectorAllocation,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}