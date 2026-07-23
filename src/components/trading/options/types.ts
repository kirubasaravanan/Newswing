'use client';

export interface ChainLeg {
  ltp: number;
  iv: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  oi: number;
  volume: number;
  bid: number;
  ask: number;
  itm: boolean;
  theoretical?: boolean;
  changeInOI?: number;
  pChangeInOI?: number;
}

export interface ChainRow {
  strike: number;
  ce: ChainLeg;
  pe: ChainLeg;
  distance: number;
  moneyness: 'ITM' | 'ATM' | 'OTM';
}

export interface ChainData {
  symbol: string;
  underlyingPrice: number;
  change: number;
  changePct: number;
  expiryDate: string;
  expiryDates: string[];
  chain: ChainRow[];
  dataSource?: 'nse_live' | 'dhan_live' | 'theoretical';
  lotSize?: number;
  pcr?: { pcr: number; interpretation: string; signal: string };
  maxPain?: { maxPainStrike: number; reasoning: string };
}

export interface Position {
  id: string;
  symbol: string;
  optionType: string;
  action: string;
  strikePrice: number;
  entryPremium: number;
  currentPremium: number;
  lotSize: number;
  qty: number;
  expiryDate: string;
  stopLoss: number | null;
  takeProfit: number | null;
  entryDelta: number | null;
  entryGamma: number | null;
  entryTheta: number | null;
  entryVega: number | null;
  entryIV: number | null;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  notes: string | null;
}

export interface Strategy {
  id: string;
  name: string;
  symbol: string;
  underlyingPrice: number;
  status: string;
  totalMargin: number;
  totalPnl: number;
  legs: string;
  expiryDate: string;
  createdAt: string;
  trades: any[];
}