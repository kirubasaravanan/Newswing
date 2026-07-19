/**
 * Shared TypeScript Types for PMS
 * Eliminates 'any' usage across the codebase.
 */

// ── Trade Types ──────────────────────────────────────────────

export type TradeDirection = 'LONG' | 'SHORT';
export type TradeStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface Trade {
  id: string;
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  stopLoss: number;
  targetPrice: number;
  status: TradeStatus;
  pnl: number | null;
  pnlPct: number | null;
  entryDate: string;
  exitDate: string | null;
  holdBars: number | null;
  portfolioId: string | null;
  tags: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTradeInput {
  symbol: string;
  direction: TradeDirection;
  entryPrice: number;
  qty: number;
  stopLoss: number;
  targetPrice: number;
  portfolioId?: string;
  tags?: string;
  notes?: string;
}

export interface CloseTradeInput {
  exitPrice: number;
  notes?: string;
}

// ── Option Types ─────────────────────────────────────────────

export type OptionType = 'CE' | 'PE';
export type OptionAction = 'BUY' | 'SELL';

export interface OptionTrade {
  id: string;
  symbol: string;
  optionType: OptionType;
  action: OptionAction;
  strike: number;
  expiryDate: string;
  lotSize: number;
  qty: number;
  entryPremium: number;
  exitPremium: number | null;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  stopLoss: number | null;
  takeProfit: number | null;
  status: 'OPEN' | 'CLOSED';
  pnl: number | null;
  strategyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOptionTradeInput {
  symbol: string;
  optionType: OptionType;
  action: OptionAction;
  strike: number;
  expiryDate: string;
  lotSize: number;
  qty: number;
  entryPremium: number;
  iv?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  stopLoss?: number;
  takeProfit?: number;
  strategyId?: string;
}

export interface OptionStrategy {
  id: string;
  name: string;
  symbol: string;
  legs: StrategyLeg[];
  totalMargin: number;
  totalPnl: number | null;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
}

export interface StrategyLeg {
  optionType: OptionType;
  action: OptionAction;
  strike: number;
  expiryDate: string;
  lotSize: number;
  qty: number;
  premium: number;
}

// ── Portfolio Types ──────────────────────────────────────────

export interface Portfolio {
  id: string;
  name: string;
  isDefault: boolean;
  totalCapital: number;
  createdAt: string;
}

export interface CapitalWallet {
  id: string;
  totalCapital: number;
  initialCapital: number;
  deployed: number;
  available: number;
  realizedPnl: number;
  unrealizedPnl: number;
}

// ── Screening Types ──────────────────────────────────────────

export interface ScreeningResult {
  id: string;
  symbol: string;
  name?: string;
  date: string;
  score: number;
  setupType: 'A+' | 'B' | null;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  riskReward: number;
  atr: number;
  rsi: number;
  scores: {
    scoreTrend: number;
    scorePullback: number;
    scoreTrigger: number;
    scoreVolume: number;
    scoreRS: number;
    scoreGap: number;
    totalScore: number;
  };
  checks: Record<string, boolean>;
  qtyA: number;
  qtyB: number;
  createdAt: string;
}

// ── Journal Types ────────────────────────────────────────────

export interface TradeJournalEntry {
  id: string;
  tradeId: string;
  mood: string;
  emotions: string;
  lessonsLearned: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

// ── Watchlist Types ──────────────────────────────────────────

export interface WatchlistFolder {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  stocks: WatchlistStock[];
}

export interface WatchlistStock {
  id: string;
  symbol: string;
  name: string;
  sector: string | null;
  folderId: string | null;
}

// ── Alert Types ──────────────────────────────────────────────

export type AlertCondition = 'ABOVE' | 'BELOW';

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: AlertCondition;
  targetPrice: number;
  triggered: boolean;
  triggeredAt: string | null;
  notes: string | null;
  createdAt: string;
}

// ── Backtest Types ───────────────────────────────────────────

export interface BacktestRun {
  id: string;
  name: string;
  symbol: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  stats: BacktestStats | null;
  config: Record<string, unknown>;
  trades: BacktestTrade[];
  createdAt: string;
}

export interface BacktestTrade {
  id: string;
  runId: string;
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  direction: TradeDirection;
  pnl: number | null;
  score: number | null;
  exitReason: string | null;
}

export interface BacktestStats {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  sharpe: number;
  profitFactor: number;
  avgRR: number;
}

// ── API Response Types ───────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── VIX & Options Analytics Types ────────────────────────────

export interface VIXDisplay {
  value: number;
  change: number;
  changePct: number;
  regime: string;
  guidance: {
    optionBuyerBias: string;
    optionSellerBias: string;
    strategyHints: string[];
    warningLevel: string;
    summary: string;
  };
  expectedDailyMove: number;
  expectedWeeklyRange: { upper: number; lower: number; range: number };
}

export interface PortfolioGreeks {
  netDelta: number;
  netGamma: number;
  netTheta: number;    // per day
  netVega: number;     // per 1% IV change
  deltaPerLot: number;
  thetaPerDay: number;
  marginUtilization: number;  // % of deployed capital
  openPositions: number;
  largestThetaPosition: string | null;
  largestVegaPosition: string | null;
}

// ── Store Types ──────────────────────────────────────────────

export type TabId = 'dashboard' | 'holdings' | 'options' | 'auto-trade' | 'scanner' | 'journal' | 'analytics' | 'backtest' | 'settings';

export interface ScreeningConfig {
  liveCapital: number;
  riskPct: number;
  maxSlots: number;
  maxOpenTrades: number;
  maxHoldBars: number;
  minScore: number;
  minRR: number;
  cooldownBars: number;
  useMacro: boolean;
  minTurnoverCr: number;
}

// ── Dividend & SIP Types ─────────────────────────────────────

export interface DividendRecord {
  id: string;
  symbol: string;
  exDate: string;
  dividendPerShare: number;
  totalShares: number;
  totalAmount: number;
  createdAt: string;
}

export interface SIPPlan {
  id: string;
  symbol: string;
  amount: number;
  frequency: 'WEEKLY' | 'MONTHLY';
  nextDate: string;
  totalInvested: number;
  totalUnits: number;
  avgPrice: number;
  portfolioId: string | null;
  active: boolean;
  createdAt: string;
}