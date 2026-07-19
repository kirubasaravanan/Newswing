import { NextRequest, NextResponse } from 'next/server';
import { blackScholes, impliedVolatility, calculateGreeksSL, getOptionLotSize, timeToExpiryYears, daysToExpiry as dte } from '@/lib/options/black-scholes';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'NIFTY';
    const strike = parseFloat(searchParams.get('strike') || '0');
    const expiry = searchParams.get('expiry') || '';
    const type = (searchParams.get('type') || 'CE') as 'CE' | 'PE';
    const spot = parseFloat(searchParams.get('spot') || '0');
    const premium = parseFloat(searchParams.get('premium') || '0');
    const action = (searchParams.get('action') || 'BUY') as 'BUY' | 'SELL';

    if (!strike || !expiry || !spot) {
      return NextResponse.json({ success: false, error: 'Missing strike, expiry, or spot' }, { status: 400 });
    }

    const r = 0.07;
    const T = timeToExpiryYears(expiry);
    const days = dte(expiry);

    // Calculate IV from market premium if provided
    let iv: number;
    let bs: ReturnType<typeof blackScholes>;

    if (premium > 0) {
      try {
        iv = impliedVolatility(spot, strike, T, r, premium, type);
      } catch {
        iv = 0.15;
      }
      bs = blackScholes(spot, strike, T, r, iv, type);
    } else {
      iv = symbol === 'NIFTY' || symbol === 'BANKNIFTY' ? 0.13 : 0.25;
      bs = blackScholes(spot, strike, T, r, iv, type);
    }

    // Greeks-based SL/TP
    const slResult = calculateGreeksSL({
      entryPremium: premium || bs.premium,
      delta: bs.delta,
      gamma: bs.gamma,
      theta: bs.theta,
      vega: bs.vega,
      iv,
      daysToExpiry: days,
      strike,
      spot,
      action,
      lotSize: getOptionLotSize(symbol),
      qty: 1,
      underlyingSymbol: symbol,
      optionType: type,
    });

    return NextResponse.json({
      success: true,
      greeks: {
        premium: bs.premium,
        delta: bs.delta,
        gamma: bs.gamma,
        theta: bs.theta,
        vega: bs.vega,
        iv: Math.round(iv * 10000) / 100,
      },
      sltp: slResult,
      daysToExpiry: days,
      lotSize: getOptionLotSize(symbol),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}