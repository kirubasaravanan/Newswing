/**
 * Indian Market Transaction Costs Engine
 *
 * Calculates realistic costs for equity and options trades on NSE/BSE.
 * All rates are as per SEBI/NSE schedule (updated July 2025).
 *
 * Equity Delivery (Swing Trading):
 *   - Brokerage: ₹20/order flat (discount broker) or configurable
 *   - STT: 0.1% on buy+sell value (delivery)
 *   - Exchange charges: 0.00345% (NSE)
 *   - GST: 18% on (brokerage + exchange charges)
 *   - SEBI fees: ₹10 per crore
 *   - Stamp duty: 0.015% on buy side only
 *
 * Options (F&O):
 *   - Brokerage: ₹20/order flat
 *   - STT: 0.1% on sell-side premium (for option buyers) — hiked from 0.0625%
 *         effective 1 Oct 2024 (Budget 2024 F&O STT increase)
 *         0.125% on sell-side premium (for option sellers — intrinsic value on exercise)
 *   - Exchange charges: 0.05% (NSE F&O)
 *   - GST: 18% on (brokerage + exchange charges)
 *   - SEBI fees: ₹10 per crore
 *   - Stamp duty: 0.003% on buy side
 *
 * Slippage Model:
 *   Based on liquidity tier of the instrument:
 *   - Ultra liquid (NIFTY, BANKNIFTY, top 10 stocks): 0.02–0.05%
 *   - High liquid (Nifty 50 stocks): 0.05–0.10%
 *   - Medium liquid (Nifty 100 stocks): 0.10–0.20%
 *   - Low liquid (small/midcap): 0.20–0.40%
 */

// ── Configuration ────────────────────────────────────────────

export interface TransactionCostConfig {
  // Brokerage
  brokeragePerOrder: number;         // ₹ flat per order (default ₹20)
  maxBrokeragePct: number;           // Max brokerage as % of trade value (cap)

  // Regulatory charges
  sttDeliveryPct: number;            // STT on equity delivery (buy+sell)
  sttOptionsBuyerPct: number;        // STT on options sell-side (buyer closing)
  sttOptionsSellerPct: number;       // STT on options sell-side (seller closing)
  exchangeChargeEquityPct: number;   // NSE transaction charge - equity
  exchangeChargeOptionsPct: number;  // NSE transaction charge - F&O
  gstPct: number;                    // GST on (brokerage + exchange charges)
  sebiFeePerCrore: number;           // SEBI turnover fee
  stampDutyBuyEquityPct: number;     // Stamp duty on equity buy
  stampDutyBuyOptionsPct: number;    // Stamp duty on options buy

  // Slippage (equity — % of share price)
  slippageEnabled: boolean;
  slippageUltraPct: number;          // Slippage for ultra-liquid
  slippageHighPct: number;           // Slippage for high-liquid
  slippageMediumPct: number;         // Slippage for medium-liquid
  slippageLowPct: number;            // Slippage for low-liquid

  // Options slippage (% of PREMIUM, not underlying price). An option's own
  // order book is much thinner than its underlying stock's — reusing the
  // equity slippage tiers directly against premium (as this file did before)
  // understates real bid-ask spread cost by roughly an order of magnitude.
  // These are still approximations (real spread varies by strike/moneyness/
  // expiry proximity), but are calibrated to real NSE options spread ranges
  // rather than equity share-price ranges.
  optionsSlippageUltraPct: number;   // NIFTY/BANKNIFTY ATM-ish strikes
  optionsSlippageHighPct: number;    // Liquid large-cap stock options
  optionsSlippageMediumPct: number;  // Mid-liquidity stock options
  optionsSlippageLowPct: number;     // Illiquid strikes/names
}

export const DEFAULT_COST_CONFIG: TransactionCostConfig = {
  brokeragePerOrder: 20,
  maxBrokeragePct: 0.25,

  sttDeliveryPct: 0.1,
  sttOptionsBuyerPct: 0.1, // hiked from 0.0625% effective 1 Oct 2024
  sttOptionsSellerPct: 0.125,
  exchangeChargeEquityPct: 0.00345,
  exchangeChargeOptionsPct: 0.05,
  gstPct: 18,
  sebiFeePerCrore: 10,
  stampDutyBuyEquityPct: 0.015,
  stampDutyBuyOptionsPct: 0.003,

  slippageEnabled: true,
  slippageUltraPct: 0.03,
  slippageHighPct: 0.08,
  slippageMediumPct: 0.15,
  slippageLowPct: 0.30,

  // Real NSE stock/index options bid-ask spreads run roughly 1-3% of premium
  // on liquid ATM strikes and 5-15%+ on illiquid ones — these are premium-
  // relative, not share-price-relative, so they're deliberately much larger
  // than the equity slippage tiers above.
  optionsSlippageUltraPct: 1.0,
  optionsSlippageHighPct: 2.0,
  optionsSlippageMediumPct: 4.0,
  optionsSlippageLowPct: 8.0,
};

// ── Liquidity Tiers ──────────────────────────────────────────

export type LiquidityTier = 'ultra' | 'high' | 'medium' | 'low';

const ULTRA_LIQUID = new Set([
  'NIFTY', 'BANKNIFTY', 'RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK',
  'SBIN', 'BHARTIARTL', 'ITC',
]);

const HIGH_LIQUID = new Set([
  'AXISBANK', 'KOTAKBANK', 'BAJFINANCE', 'LT', 'HINDUNILVR', 'TATAMOTORS',
  'MARUTI', 'SUNPHARMA', 'WIPRO', 'HCLTECH', 'TATASTEEL', 'ADANIENT',
  'TITAN', 'POWERGRID', 'NTPC', 'COALINDIA', 'ONGC', 'IOC', 'DRREDDY',
  'ASIANPAINT', 'ULTRACEMCO', 'BAJAJFINSV', 'NESTLEIND', 'DIVISLAB',
  'CIPLA', 'EICHERMOT', 'HEROMOTOCO', 'BPCL', 'GRASIM', 'INDUSINDBK',
  'TATACONSUM', 'M_M', 'HAL', 'BEL', 'VEDL', 'DIXON',
]);

const MEDIUM_LIQUID = new Set([
  'VOLTAS', 'PIDILITIND', 'GODREJCP', 'DABUR', 'MARICO', 'COLPAL',
  'BERGEPAINT', 'HAVELLS', 'SIEMENS', 'ABB', 'BOSCHLTD', 'CUMMINSIND',
  'TORNTPHARM', 'AUROPHARMA', 'BIOCON', 'LUPIN', 'ALKEM', 'APOLLOHOSP',
  'FORTIS', 'MUTHOOTFIN', 'MANAPPURAM', 'CHOLAFIN', 'SHRIRAMFIN',
  'PEL', 'SBILIFE', 'HDFCLIFE', 'ICICIPRULI', 'NAUKRI',
]);

export function getLiquidityTier(symbol: string): LiquidityTier {
  if (ULTRA_LIQUID.has(symbol)) return 'ultra';
  if (HIGH_LIQUID.has(symbol)) return 'high';
  if (MEDIUM_LIQUID.has(symbol)) return 'medium';
  return 'low';
}

// ── Cost Breakdown ───────────────────────────────────────────

export interface CostBreakdown {
  brokerage: number;
  stt: number;
  exchangeCharges: number;
  gst: number;
  sebiFees: number;
  stampDuty: number;
  slippage: number;
  totalCosts: number;
}

export interface SlippageResult {
  adjustedEntryPrice: number;    // Entry price after slippage (higher for buy)
  adjustedExitPrice: number;     // Exit price after slippage (lower for sell)
  entrySlippage: number;         // ₹ slippage on entry
  exitSlippage: number;          // ₹ slippage on exit
  totalSlippage: number;         // Total ₹ slippage
}

// ── Core Calculations ────────────────────────────────────────

/**
 * Calculate slippage-adjusted prices for a round-trip trade.
 * Buy: price moves UP (you pay more)
 * Sell: price moves DOWN (you receive less)
 */
export function calculateSlippage(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  symbol: string,
  config: TransactionCostConfig = DEFAULT_COST_CONFIG,
): SlippageResult {
  if (!config.slippageEnabled) {
    return {
      adjustedEntryPrice: entryPrice,
      adjustedExitPrice: exitPrice,
      entrySlippage: 0,
      exitSlippage: 0,
      totalSlippage: 0,
    };
  }

  const tier = getLiquidityTier(symbol);
  let slippagePct: number;
  switch (tier) {
    case 'ultra':  slippagePct = config.slippageUltraPct; break;
    case 'high':   slippagePct = config.slippageHighPct; break;
    case 'medium': slippagePct = config.slippageMediumPct; break;
    case 'low':    slippagePct = config.slippageLowPct; break;
  }

  const entrySlippagePerShare = entryPrice * (slippagePct / 100);
  const exitSlippagePerShare = exitPrice * (slippagePct / 100);

  const adjustedEntryPrice = Math.round((entryPrice + entrySlippagePerShare) * 100) / 100;
  const adjustedExitPrice = Math.round((exitPrice - exitSlippagePerShare) * 100) / 100;

  return {
    adjustedEntryPrice,
    adjustedExitPrice,
    entrySlippage: Math.round(entrySlippagePerShare * qty * 100) / 100,
    exitSlippage: Math.round(exitSlippagePerShare * qty * 100) / 100,
    totalSlippage: Math.round((entrySlippagePerShare + exitSlippagePerShare) * qty * 100) / 100,
  };
}

/**
 * Calculate slippage-adjusted premiums for an options round-trip trade.
 * Same shape as calculateSlippage() but uses the options-specific (premium-
 * relative) percentage tiers instead of the equity (share-price-relative)
 * ones — see optionsSlippage*Pct on TransactionCostConfig for why these
 * need to be a separate, much larger table.
 */
export function calculateOptionsSlippage(
  entryPremium: number,
  exitPremium: number,
  totalShares: number,
  underlyingSymbol: string,
  config: TransactionCostConfig = DEFAULT_COST_CONFIG,
): SlippageResult {
  if (!config.slippageEnabled) {
    return {
      adjustedEntryPrice: entryPremium,
      adjustedExitPrice: exitPremium,
      entrySlippage: 0,
      exitSlippage: 0,
      totalSlippage: 0,
    };
  }

  const tier = getLiquidityTier(underlyingSymbol);
  let slippagePct: number;
  switch (tier) {
    case 'ultra':  slippagePct = config.optionsSlippageUltraPct; break;
    case 'high':   slippagePct = config.optionsSlippageHighPct; break;
    case 'medium': slippagePct = config.optionsSlippageMediumPct; break;
    case 'low':    slippagePct = config.optionsSlippageLowPct; break;
  }

  const entrySlippagePerUnit = entryPremium * (slippagePct / 100);
  const exitSlippagePerUnit = exitPremium * (slippagePct / 100);

  const adjustedEntryPrice = Math.round((entryPremium + entrySlippagePerUnit) * 100) / 100;
  const adjustedExitPrice = Math.round((exitPremium - exitSlippagePerUnit) * 100) / 100;

  return {
    adjustedEntryPrice,
    adjustedExitPrice,
    entrySlippage: Math.round(entrySlippagePerUnit * totalShares * 100) / 100,
    exitSlippage: Math.round(exitSlippagePerUnit * totalShares * 100) / 100,
    totalSlippage: Math.round((entrySlippagePerUnit + exitSlippagePerUnit) * totalShares * 100) / 100,
  };
}

/**
 * Calculate all transaction costs for an EQUITY DELIVERY round-trip trade.
 * Returns detailed breakdown of every charge.
 */
export function calculateEquityCosts(
  entryPrice: number,
  exitPrice: number,
  qty: number,
  symbol: string,
  config: TransactionCostConfig = DEFAULT_COST_CONFIG,
): CostBreakdown {
  const buyValue = entryPrice * qty;
  const sellValue = exitPrice * qty;
  const totalTurnover = buyValue + sellValue;

  // 1. Brokerage: ₹20 per order (buy + sell = 2 orders)
  const brokerageBuy = Math.min(config.brokeragePerOrder, buyValue * (config.maxBrokeragePct / 100));
  const brokerageSell = Math.min(config.brokeragePerOrder, sellValue * (config.maxBrokeragePct / 100));
  const brokerage = Math.round((brokerageBuy + brokerageSell) * 100) / 100;

  // 2. STT: 0.1% on BOTH buy and sell for delivery
  const stt = Math.round(totalTurnover * (config.sttDeliveryPct / 100) * 100) / 100;

  // 3. Exchange transaction charges: 0.00345% on total turnover
  const exchangeCharges = Math.round(totalTurnover * (config.exchangeChargeEquityPct / 100) * 100) / 100;

  // 4. GST: 18% on (brokerage + exchange charges)
  const gst = Math.round((brokerage + exchangeCharges) * (config.gstPct / 100) * 100) / 100;

  // 5. SEBI fees: ₹10 per crore of turnover
  const sebiFees = Math.round((totalTurnover / 10000000) * config.sebiFeePerCrore * 100) / 100;

  // 6. Stamp duty: 0.015% on buy side only
  const stampDuty = Math.round(buyValue * (config.stampDutyBuyEquityPct / 100) * 100) / 100;

  // 7. Slippage
  const slippageResult = calculateSlippage(entryPrice, exitPrice, qty, symbol, config);
  const slippage = slippageResult.totalSlippage;

  const totalCosts = Math.round((brokerage + stt + exchangeCharges + gst + sebiFees + stampDuty + slippage) * 100) / 100;

  return { brokerage, stt, exchangeCharges, gst, sebiFees, stampDuty, slippage, totalCosts };
}

/**
 * Calculate all transaction costs for an OPTIONS round-trip trade.
 * Options costs differ from equity in STT rates and exchange charges.
 */
export function calculateOptionsCosts(
  entryPremium: number,
  exitPremium: number,
  lotSize: number,
  qty: number,
  action: 'BUY' | 'SELL',
  symbol: string,
  config: TransactionCostConfig = DEFAULT_COST_CONFIG,
): CostBreakdown {
  const totalShares = lotSize * qty;
  const buyValue = entryPremium * totalShares;
  const sellValue = exitPremium * totalShares;
  const totalTurnover = buyValue + sellValue;

  // 1. Brokerage: ₹20 per order (buy + sell = 2 orders)
  const brokerageBuy = Math.min(config.brokeragePerOrder, buyValue * (config.maxBrokeragePct / 100));
  const brokerageSell = Math.min(config.brokeragePerOrder, sellValue * (config.maxBrokeragePct / 100));
  const brokerage = Math.round((brokerageBuy + brokerageSell) * 100) / 100;

  // 2. STT: Applied on SELL side only for options
  //    Buyer closing = 0.0625% on sell premium
  //    Seller closing = 0.125% on sell premium (higher because of exercise risk)
  const sttRate = action === 'BUY' ? config.sttOptionsBuyerPct : config.sttOptionsSellerPct;
  const stt = Math.round(sellValue * (sttRate / 100) * 100) / 100;

  // 3. Exchange charges: 0.05% on total turnover (higher than equity)
  const exchangeCharges = Math.round(totalTurnover * (config.exchangeChargeOptionsPct / 100) * 100) / 100;

  // 4. GST: 18% on (brokerage + exchange charges)
  const gst = Math.round((brokerage + exchangeCharges) * (config.gstPct / 100) * 100) / 100;

  // 5. SEBI fees: ₹10 per crore
  const sebiFees = Math.round((totalTurnover / 10000000) * config.sebiFeePerCrore * 100) / 100;

  // 6. Stamp duty: 0.003% on buy side (lower than equity delivery)
  const stampDuty = Math.round(buyValue * (config.stampDutyBuyOptionsPct / 100) * 100) / 100;

  // 7. Slippage for options — premium-relative tiers, NOT the equity
  // share-price-relative ones (see calculateOptionsSlippage's docstring).
  const slippageResult = calculateOptionsSlippage(entryPremium, exitPremium, totalShares, symbol, config);
  const slippage = slippageResult.totalSlippage;

  const totalCosts = Math.round((brokerage + stt + exchangeCharges + gst + sebiFees + stampDuty + slippage) * 100) / 100;

  return { brokerage, stt, exchangeCharges, gst, sebiFees, stampDuty, slippage, totalCosts };
}

/**
 * Calculate net P&L after all transaction costs.
 * Use this everywhere a P&L is calculated to ensure costs are deducted.
 */
export function calculateNetPnl(
  grossPnl: number,
  costs: CostBreakdown,
): { netPnl: number; totalCosts: number; costPct: number } {
  const netPnl = Math.round((grossPnl - costs.totalCosts) * 100) / 100;
  const costPct = grossPnl !== 0
    ? Math.round((costs.totalCosts / Math.abs(grossPnl)) * 10000) / 100
    : 0;
  return { netPnl, totalCosts: costs.totalCosts, costPct };
}

/**
 * Convenience: Get slippage-adjusted entry price only (for auto-trade entries).
 * Returns the price you'd actually pay after slippage on the BUY side.
 */
export function getSlippageAdjustedEntry(
  price: number,
  symbol: string,
  config: TransactionCostConfig = DEFAULT_COST_CONFIG,
): number {
  if (!config.slippageEnabled) return price;
  const tier = getLiquidityTier(symbol);
  let pct: number;
  switch (tier) {
    case 'ultra':  pct = config.slippageUltraPct; break;
    case 'high':   pct = config.slippageHighPct; break;
    case 'medium': pct = config.slippageMediumPct; break;
    case 'low':    pct = config.slippageLowPct; break;
  }
  return Math.round((price * (1 + pct / 100)) * 100) / 100;
}

/**
 * Convenience: Get slippage-adjusted exit price only (for auto-trade exits).
 * Returns the price you'd actually receive after slippage on the SELL side.
 */
export function getSlippageAdjustedExit(
  price: number,
  symbol: string,
  config: TransactionCostConfig = DEFAULT_COST_CONFIG,
): number {
  if (!config.slippageEnabled) return price;
  const tier = getLiquidityTier(symbol);
  let pct: number;
  switch (tier) {
    case 'ultra':  pct = config.slippageUltraPct; break;
    case 'high':   pct = config.slippageHighPct; break;
    case 'medium': pct = config.slippageMediumPct; break;
    case 'low':    pct = config.slippageLowPct; break;
  }
  return Math.round((price * (1 - pct / 100)) * 100) / 100;
}
