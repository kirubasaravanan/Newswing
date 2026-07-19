import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { blackScholes, timeToExpiryYears, getOptionLotSize } from '@/lib/options/black-scholes';
import { fetchSpotPrice } from '@/lib/options/option-chain';

export async function GET() {
  try {
    const trades = await db.optionTrade.findMany({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
    });

    const positions: any[] = [];
    let totalMargin = 0;
    let totalUnrealizedPnl = 0;

    for (const trade of trades) {
      const lotSize = trade.lotSize;
      const totalShares = lotSize * trade.qty;
      const direction = trade.action === 'BUY' ? 1 : -1;
      const entryCost = trade.entryPremium * totalShares * direction;
      const margin = trade.marginUsed || entryCost;
      totalMargin += Math.abs(margin);

      // Fetch live spot
      let currentPremium = trade.entryPremium;
      let unrealizedPnl = 0;

      try {
        const spot = await fetchSpotPrice(trade.symbol);
        const T = timeToExpiryYears(trade.expiryDate);
        const iv = trade.entryIV || 0.15;
        const bs = blackScholes(spot, trade.strikePrice, T, 0.07, iv, trade.optionType as 'CE' | 'PE');
        currentPremium = bs.premium;
        unrealizedPnl = (currentPremium - trade.entryPremium) * totalShares * direction;

        // Update current premium in DB
        await db.optionTrade.update({
          where: { id: trade.id },
          data: { currentPremium: Math.round(currentPremium * 100) / 100 },
        });
      } catch {
        // If spot fetch fails, use entry premium
      }

      totalUnrealizedPnl += unrealizedPnl;

      positions.push({
        id: trade.id,
        symbol: trade.symbol,
        optionType: trade.optionType,
        action: trade.action,
        strikePrice: trade.strikePrice,
        entryPremium: trade.entryPremium,
        currentPremium: Math.round(currentPremium * 100) / 100,
        lotSize: trade.lotSize,
        qty: trade.qty,
        expiryDate: trade.expiryDate,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        entryDelta: trade.entryDelta,
        entryGamma: trade.entryGamma,
        entryTheta: trade.entryTheta,
        entryVega: trade.entryVega,
        entryIV: trade.entryIV,
        marginUsed: trade.marginUsed,
        unrealizedPnl: Math.round(unrealizedPnl * 100) / 100,
        unrealizedPnlPct: margin !== 0 ? Math.round((unrealizedPnl / Math.abs(margin)) * 10000) / 100 : 0,
        notes: trade.notes,
      });
    }

    return NextResponse.json({
      success: true,
      positions,
      summary: {
        totalMargin: Math.round(totalMargin * 100) / 100,
        totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
        positionCount: positions.length,
      },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}