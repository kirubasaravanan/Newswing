import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { blackScholes, impliedVolatility, calculateGreeksSL, getOptionLotSize, timeToExpiryYears, daysToExpiry as dte } from '@/lib/options/black-scholes';

// GET all strategies
export async function GET() {
  try {
    const strategies = await db.optionStrategy.findMany({
      orderBy: { createdAt: 'desc' },
      include: { trades: true },
    });
    return NextResponse.json({ success: true, strategies });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST create strategy with legs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, symbol, legs, expiryDate, notes, underlyingPrice } = body;

    if (!legs || legs.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one leg required' }, { status: 400 });
    }

    const spot = underlyingPrice || 0;
    const r = 0.07;
    const T = timeToExpiryYears(expiryDate);
    const days = dte(expiryDate);

    // Create strategy
    const strategy = await db.optionStrategy.create({
      data: {
        name,
        symbol,
        underlyingPrice: spot,
        totalMargin: 0, // will update
        expiryDate,
        notes: notes || null,
        legs: JSON.stringify(legs),
      },
    });

    let totalMargin = 0;

    // Create trade for each leg
    for (const leg of legs) {
      const lotSize = leg.lotSize || getOptionLotSize(symbol);

      let iv = 0.15;
      try {
        iv = impliedVolatility(spot, leg.strikePrice, T, r, leg.entryPremium, leg.optionType);
      } catch { /* use default */ }

      const bs = blackScholes(spot, leg.strikePrice, T, r, iv, leg.optionType);

      const slResult = calculateGreeksSL({
        entryPremium: leg.entryPremium,
        delta: bs.delta,
        gamma: bs.gamma,
        theta: bs.theta,
        vega: bs.vega,
        iv,
        daysToExpiry: days,
        strike: leg.strikePrice,
        spot,
        action: leg.action,
        lotSize,
        qty: leg.qty || 1,
        underlyingSymbol: symbol,
        optionType: leg.optionType,
      });

      totalMargin += slResult.marginEstimate;

      await db.optionTrade.create({
        data: {
          symbol,
          underlyingPrice: spot,
          optionType: leg.optionType,
          action: leg.action,
          strikePrice: leg.strikePrice,
          expiryDate,
          lotSize,
          qty: leg.qty || 1,
          entryPremium: leg.entryPremium,
          stopLoss: slResult.stopLoss,
          takeProfit: slResult.takeProfit,
          entryDelta: bs.delta,
          entryGamma: bs.gamma,
          entryTheta: bs.theta,
          entryVega: bs.vega,
          entryIV: iv,
          slReasoning: slResult.slReasoning,
          tpReasoning: slResult.tpReasoning,
          marginUsed: slResult.marginEstimate,
          strategyId: strategy.id,
        },
      });
    }

    // Update strategy with total margin
    await db.optionStrategy.update({
      where: { id: strategy.id },
      data: { totalMargin },
    });

    const updated = await db.optionStrategy.findUnique({
      where: { id: strategy.id },
      include: { trades: true },
    });

    return NextResponse.json({ success: true, strategy: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// PUT close strategy
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    const strategy = await db.optionStrategy.findUnique({
      where: { id },
      include: { trades: true },
    });

    if (!strategy) {
      return NextResponse.json({ success: false, error: 'Strategy not found' }, { status: 404 });
    }

    // Calculate total P&L from all trades
    let totalPnl = 0;
    for (const trade of strategy.trades) {
      if (trade.pnl) totalPnl += trade.pnl;
    }

    const updated = await db.optionStrategy.update({
      where: { id },
      data: {
        status: 'CLOSED',
        exitDate: new Date(),
        totalPnl,
      },
    });

    return NextResponse.json({ success: true, strategy: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}