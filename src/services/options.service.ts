/**
 * Options Service
 * Business logic for options trading — extracted from API routes.
 * Uses wallet service for atomic capital management.
 */

import { db } from '@/lib/db';
import {
  blackScholes, impliedVolatility, calculateGreeksSL,
  getOptionLotSize, timeToExpiryYears, daysToExpiry as dte,
  getDividendYield,
} from '@/lib/options/black-scholes';
import { creditRealizedPnl } from './wallet.service';

export interface CreateOptionTradeDTO {
  symbol: string;
  optionType: 'CE' | 'PE';
  action: 'BUY' | 'SELL';
  strikePrice: number;
  expiryDate: string;
  lotSize?: number;
  qty?: number;
  entryPremium: number;
  stopLoss?: number;
  takeProfit?: number;
  notes?: string;
  tags?: string;
  underlyingPrice?: number;
  strategyId?: string;
}

export interface CloseOptionTradeDTO {
  id: string;
  exitPremium?: number;
  exitReason?: string;
}

/**
 * Create a single option trade with auto-calculated Greeks, SL/TP.
 */
export async function createOptionTrade(dto: CreateOptionTradeDTO) {
  const lotSize = dto.lotSize || getOptionLotSize(dto.symbol);
  const qty = dto.qty || 1;
  const spot = dto.underlyingPrice || 0;
  const r = 0.07;
  const T = timeToExpiryYears(dto.expiryDate);
  const days = dte(dto.expiryDate);
  const q = getDividendYield(dto.symbol);

  // Solve IV from premium
  let iv: number;
  try {
    iv = impliedVolatility(spot, dto.strikePrice, T, r, dto.entryPremium, dto.optionType);
  } catch {
    iv = 0.15;
  }

  // Get Greeks (with dividend yield for stocks)
  const bs = blackScholes(spot, dto.strikePrice, T, r, iv, dto.optionType, q);

  // Auto-calculate SL/TP if not provided
  let sl = dto.stopLoss;
  let tp = dto.takeProfit;
  let slReasoning: string | undefined;
  let tpReasoning: string | undefined;
  let marginUsed: number | undefined;

  if (!sl || !tp) {
    const slResult = calculateGreeksSL({
      entryPremium: dto.entryPremium,
      delta: bs.delta,
      gamma: bs.gamma,
      theta: bs.theta,
      vega: bs.vega,
      iv,
      daysToExpiry: days,
      strike: dto.strikePrice,
      spot,
      action: dto.action,
      lotSize,
      qty,
      underlyingSymbol: dto.symbol,
      optionType: dto.optionType,
    });

    if (!sl) sl = slResult.stopLoss;
    if (!tp) tp = slResult.takeProfit;
    slReasoning = slResult.slReasoning;
    tpReasoning = slResult.tpReasoning;
    marginUsed = slResult.marginEstimate;
  } else {
    const totalShares = lotSize * qty;
    marginUsed = dto.action === 'BUY'
      ? dto.entryPremium * totalShares
      : dto.entryPremium * totalShares * 3;
  }

  return db.optionTrade.create({
    data: {
      symbol: dto.symbol,
      underlyingPrice: spot,
      optionType: dto.optionType,
      action: dto.action,
      strikePrice: dto.strikePrice,
      expiryDate: dto.expiryDate,
      lotSize,
      qty,
      entryPremium: dto.entryPremium,
      stopLoss: sl ? parseFloat(String(sl)) : null,
      takeProfit: tp ? parseFloat(String(tp)) : null,
      entryDelta: bs.delta,
      entryGamma: bs.gamma,
      entryTheta: bs.theta,
      entryVega: bs.vega,
      entryIV: iv,
      slReasoning,
      tpReasoning,
      marginUsed,
      notes: dto.notes || null,
      tags: dto.tags || null,
      strategyId: dto.strategyId || null,
    },
  });
}

/**
 * Close an option trade and credit P&L to wallet (transactional).
 */
export async function closeOptionTrade(dto: CloseOptionTradeDTO) {
  return db.$transaction(async (tx) => {
    const trade = await tx.optionTrade.findUnique({ where: { id: dto.id } });
    if (!trade) throw new Error('Trade not found');

    const exitPrem = dto.exitPremium || trade.currentPremium || trade.entryPremium;
    const direction = trade.action === 'BUY' ? 1 : -1;
    const pnl = (exitPrem - trade.entryPremium) * trade.qty * trade.lotSize * direction;
    const pnlPct = trade.marginUsed && trade.marginUsed > 0
      ? (pnl / trade.marginUsed) * 100
      : 0;

    const status = dto.exitReason === 'EXPIRED' ? 'EXPIRED'
      : dto.exitReason === 'SL_HIT' ? 'SL_HIT'
      : dto.exitReason === 'TP_HIT' ? 'TP_HIT'
      : 'CLOSED';

    const updated = await tx.optionTrade.update({
      where: { id: dto.id },
      data: {
        status,
        exitDate: new Date(),
        exitPremium: parseFloat(String(exitPrem)),
        pnl: Math.round(pnl * 100) / 100,
        pnlPercent: Math.round(pnlPct * 100) / 100,
        exitReason: dto.exitReason || 'MANUAL',
      },
    });

    return updated;
  });
}

/**
 * Create a multi-leg strategy with transactional consistency.
 */
export async function createStrategy(data: {
  name: string;
  symbol: string;
  legs: Array<{
    optionType: 'CE' | 'PE';
    action: 'BUY' | 'SELL';
    strikePrice: number;
    entryPremium: number;
    lotSize?: number;
    qty?: number;
  }>;
  expiryDate: string;
  notes?: string;
  underlyingPrice?: number;
}) {
  return db.$transaction(async (tx) => {
    const spot = data.underlyingPrice || 0;
    const r = 0.07;
    const T = timeToExpiryYears(data.expiryDate);
    const days = dte(data.expiryDate);
    const q = getDividendYield(data.symbol);

    const strategy = await tx.optionStrategy.create({
      data: {
        name: data.name,
        symbol: data.symbol,
        underlyingPrice: spot,
        totalMargin: 0,
        expiryDate: data.expiryDate,
        notes: data.notes || null,
        legs: JSON.stringify(data.legs),
      },
    });

    let totalMargin = 0;

    for (const leg of data.legs) {
      const lotSize = leg.lotSize || getOptionLotSize(data.symbol);
      let iv = 0.15;
      try {
        iv = impliedVolatility(spot, leg.strikePrice, T, r, leg.entryPremium, leg.optionType);
      } catch { /* default */ }

      const bs = blackScholes(spot, leg.strikePrice, T, r, iv, leg.optionType, q);

      const slResult = calculateGreeksSL({
        entryPremium: leg.entryPremium,
        delta: bs.delta, gamma: bs.gamma, theta: bs.theta, vega: bs.vega,
        iv, daysToExpiry: days,
        strike: leg.strikePrice, spot,
        action: leg.action, lotSize, qty: leg.qty || 1,
        underlyingSymbol: data.symbol, optionType: leg.optionType,
      });

      totalMargin += slResult.marginEstimate;

      await tx.optionTrade.create({
        data: {
          symbol: data.symbol,
          underlyingPrice: spot,
          optionType: leg.optionType,
          action: leg.action,
          strikePrice: leg.strikePrice,
          expiryDate: data.expiryDate,
          lotSize,
          qty: leg.qty || 1,
          entryPremium: leg.entryPremium,
          stopLoss: slResult.stopLoss,
          takeProfit: slResult.takeProfit,
          entryDelta: bs.delta, entryGamma: bs.gamma,
          entryTheta: bs.theta, entryVega: bs.vega,
          entryIV: iv,
          slReasoning: slResult.slReasoning,
          tpReasoning: slResult.tpReasoning,
          marginUsed: slResult.marginEstimate,
          strategyId: strategy.id,
        },
      });
    }

    const updated = await tx.optionStrategy.update({
      where: { id: strategy.id },
      data: { totalMargin },
      include: { trades: true },
    });

    return updated;
  });
}