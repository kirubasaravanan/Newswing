import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { fetchSpotPrice, fetchOptionChain } from '@/lib/options/option-chain';
import { blackScholes, getDividendYield, timeToExpiryYears, getOptionLotSize } from '@/lib/options/black-scholes';
import type { PortfolioGreeks } from '@/types';

/**
 * GET /api/options/portfolio-greeks
 * Returns aggregated portfolio-level Greeks across all open option positions.
 */
export async function GET() {
  try {
    // Fetch all open option trades
    const openTrades = await db.optionTrade.findMany({
      where: { status: 'OPEN' },
    });

    if (openTrades.length === 0) {
      return NextResponse.json({
        netDelta: 0,
        netGamma: 0,
        netTheta: 0,
        netVega: 0,
        deltaPerLot: 0,
        thetaPerDay: 0,
        marginUtilization: 0,
        openPositions: 0,
        largestThetaPosition: null,
        largestVegaPosition: null,
      } satisfies PortfolioGreeks);
    }

    let netDelta = 0;
    let netGamma = 0;
    let netTheta = 0;
    let netVega = 0;
    let totalMargin = 0;
    let totalLots = 0;
    let largestThetaAbs = 0;
    let largestThetaPos: string | null = null;
    let largestVegaAbs = 0;
    let largestVegaPos: string | null = null;

    const r = 0.07;

    for (const trade of openTrades) {
      const lotSize = getOptionLotSize(trade.symbol);
      const totalShares = lotSize * trade.qty;
      const isBuy = trade.action === 'BUY';
      const sign = isBuy ? 1 : -1;

      // Try to get current spot price
      let spot = 0;
      try {
        spot = await fetchSpotPrice(trade.symbol);
      } catch {
        spot = trade.strike; // Fallback to strike
      }

      const T = timeToExpiryYears(trade.expiryDate);
      if (T <= 0) continue; // Skip expired — Greeks meaningless
      const q = getDividendYield(trade.symbol);
      // entryIV is stored as decimal (e.g. 0.15 = 15%), NOT percentage
      let iv = trade.entryIV ?? 0.15;
      if (iv <= 0 || iv > 5) iv = 0.15; // Sanity clamp

      // Recalculate current Greeks
      const bs = blackScholes(spot, trade.strikePrice, T, r, iv, trade.optionType as 'CE' | 'PE', q);
      if (!isFinite(bs.delta) || !isFinite(bs.gamma)) continue; // Skip invalid Greeks

      const positionDelta = sign * bs.delta * totalShares;
      const positionGamma = sign * bs.gamma * totalShares;
      const positionTheta = sign * bs.theta * totalShares;
      const positionVega = sign * bs.vega * totalShares;

      netDelta += positionDelta;
      netGamma += positionGamma;
      netTheta += positionTheta;
      netVega += positionVega;

      // Margin: BUY = premium × shares, SELL = margin estimate
      if (isBuy) {
        totalMargin += trade.entryPremium * totalShares;
      } else {
        totalMargin += trade.entryPremium * totalShares * 3; // SPAN + exposure
      }

      // Track largest theta/vega positions
      if (Math.abs(positionTheta) > largestThetaAbs) {
        largestThetaAbs = Math.abs(positionTheta);
        largestThetaPos = `${trade.action} ${trade.qty}x ${trade.symbol} ${trade.strike}${trade.optionType}`;
      }
      if (Math.abs(positionVega) > largestVegaAbs) {
        largestVegaAbs = Math.abs(positionVega);
        largestVegaPos = `${trade.action} ${trade.qty}x ${trade.symbol} ${trade.strike}${trade.optionType}`;
      }
    }

    // Get wallet for margin utilization
    const wallet = await db.capitalWallet.findFirst();
    const deployed = wallet?.deployed ?? 0;

    return NextResponse.json({
      netDelta: Math.round(netDelta * 100) / 100,
      netGamma: Math.round(netGamma * 100000) / 100000,
      netTheta: Math.round(netTheta * 100) / 100,
      netVega: Math.round(netVega * 100) / 100,
      deltaPerLot: openTrades.length > 0 ? Math.round((netDelta / totalLots) * 100) / 100 : 0,
      thetaPerDay: Math.round(netTheta * 100) / 100,
      marginUtilization: deployed > 0 ? Math.round((totalMargin / deployed) * 100) : 0,
      openPositions: openTrades.length,
      largestThetaPosition: largestThetaPos,
      largestVegaPosition: largestVegaPos,
    } satisfies PortfolioGreeks);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to calculate portfolio Greeks';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}