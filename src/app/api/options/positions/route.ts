import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getContractCurrentPrice } from '@/lib/trading/data-provider';

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

      // Fetch the real live option premium (DhanHQ option chain LTP) — matches
      // the same getContractCurrentPrice pattern already used by recalcWallet()
      // and equity-curve/route.ts. This previously used a Black-Scholes
      // theoretical premium estimate (assumed IV, fixed 7% risk-free rate)
      // instead of the actual market-quoted price, silently diverging from
      // real P&L and violating the app's own no-theoretical-data mandate.
      let currentPremium = trade.currentPremium ?? trade.entryPremium;
      let unrealizedPnl = 0;

      try {
        const compositeSymbol = `${trade.symbol}_${trade.optionType}_${trade.strikePrice}_${trade.expiryDate}`;
        const livePremium = await getContractCurrentPrice(compositeSymbol, trade.entryPremium);
        if (livePremium > 0) {
          currentPremium = livePremium;
          unrealizedPnl = (currentPremium - trade.entryPremium) * totalShares * direction;

          await db.optionTrade.update({
            where: { id: trade.id },
            data: { currentPremium: Math.round(currentPremium * 100) / 100 },
          });
        }
      } catch {
        // Real quote unavailable — keep last known premium, don't fabricate one
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