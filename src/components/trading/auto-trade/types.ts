'use client';

export interface WalletData {
  id: string; totalCapital: number; initialCapital: number; deployed: number; available: number;
  realizedPnl: number; unrealizedPnl: number;
  peakCapital?: number; totalCostsPaid?: number;
}

export interface PositionRules {
  maxPerStock: number; maxBuysPerMonth: number; maxHoldingDays: number;
  maxTotalPositions: number; riskPerTradePct: number;
  trailingStopR: number; trailToR: number; partialBookR: number; partialBookPct: number;
  cooldownDays: number; maxSectorPct: number; timeExitMins: number;
  // v2
  maxDrawdownPct: number; dailyLossLimit: number; niftyRegimeFilter: boolean;
  atrTrailMultiplier: number; adaptiveSizing: boolean; streakPenaltyPct: number;
}

export interface SchedulerState {
  enabled: boolean; scanIntervalMin: number; exitIntervalMin: number;
  lastScanAt: string | null; lastExitAt: string | null;
  todayEntries: number; todayExits: number; todayPnl: number; scanCount: number;
  // v2
  circuitBreaker: boolean; circuitBreakerReason: string;
  niftyRegime: string; consecutiveLosses: number; lastAdaptiveFactor: number;
}

export interface AutoTradeLog {
  id: string; action: string; symbol: string; executed: boolean;
  reason: string; createdAt: string; signal?: string;
}

export interface OpenPosition {
  id: string; symbol: string; stockName: string | null;
  entryPrice: number; qty: number; stopLoss: number; targetPrice: number;
  entryDate: string; autoTraded: boolean; tags?: string;
}

export interface DrawdownData {
  drawdownPct: number; peakCapital: number; currentCapital: number;
}