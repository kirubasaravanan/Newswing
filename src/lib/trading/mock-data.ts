/**
 * Mock OHLCV Data Generator for NSE stocks
 * Generates realistic-looking candlestick data for testing the screening engine.
 * In production, replace with real API data (e.g., NSE/BSE, Yahoo Finance, or broker API).
 */

import type { OHLCV } from './screening-engine';

// Seeded random for reproducible data
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

export interface StockProfile {
  symbol: string;
  name: string;
  sector: string;
  basePrice: number;
  volatility: number;    // daily % volatility
  trendBias: number;     // slight upward/downward drift
}

const PROFILES: Record<string, StockProfile> = {
  'RELIANCE':     { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Energy', basePrice: 2950, volatility: 0.015, trendBias: 0.0003 },
  'TCS':          { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', basePrice: 3950, volatility: 0.012, trendBias: 0.0002 },
  'HDFCBANK':     { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', basePrice: 1650, volatility: 0.013, trendBias: 0.0002 },
  'INFY':         { symbol: 'INFY', name: 'Infosys', sector: 'IT', basePrice: 1580, volatility: 0.014, trendBias: 0.0001 },
  'ICICIBANK':    { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', basePrice: 1250, volatility: 0.016, trendBias: 0.0003 },
  'HINDUNILVR':   { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', basePrice: 2550, volatility: 0.010, trendBias: 0.0001 },
  'SBIN':         { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', basePrice: 825, volatility: 0.018, trendBias: 0.0002 },
  'BHARTIARTL':   { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', basePrice: 1650, volatility: 0.015, trendBias: 0.0003 },
  'ITC':          { symbol: 'ITC', name: 'ITC Limited', sector: 'FMCG', basePrice: 465, volatility: 0.011, trendBias: 0.0002 },
  'KOTAKBANK':    { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking', basePrice: 1800, volatility: 0.014, trendBias: 0.0001 },
  'LT':           { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Infrastructure', basePrice: 3650, volatility: 0.016, trendBias: 0.0002 },
  'WIPRO':        { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', basePrice: 560, volatility: 0.016, trendBias: 0.0000 },
  'AXISBANK':     { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking', basePrice: 1180, volatility: 0.017, trendBias: 0.0002 },
  'TMPV':   { symbol: 'TMPV', name: 'Tata Motors Passenger Vehicles', sector: 'Auto', basePrice: 980, volatility: 0.022, trendBias: 0.0004 },
  'BAJFINANCE':   { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'Finance', basePrice: 7400, volatility: 0.020, trendBias: 0.0003 },
  'MARUTI':       { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Auto', basePrice: 12800, volatility: 0.016, trendBias: 0.0002 },
  'SUNPHARMA':    { symbol: 'SUNPHARMA', name: 'Sun Pharma', sector: 'Pharma', basePrice: 1780, volatility: 0.015, trendBias: 0.0002 },
  'TATASTEEL':    { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals', basePrice: 165, volatility: 0.022, trendBias: 0.0001 },
  'ADANIENT':     { symbol: 'ADANIENT', name: 'Adani Enterprises', sector: 'Conglomerate', basePrice: 3200, volatility: 0.025, trendBias: 0.0002 },
  'ASIANPAINT':   { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Consumer', basePrice: 2950, volatility: 0.013, trendBias: 0.0000 },
  'HCLTECH':      { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', basePrice: 1750, volatility: 0.015, trendBias: 0.0002 },
  'BAJAJFINSV':   { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Finance', basePrice: 1690, volatility: 0.018, trendBias: 0.0002 },
  'DMART':        { symbol: 'DMART', name: 'Avenue Supermarts', sector: 'Retail', basePrice: 5200, volatility: 0.017, trendBias: 0.0003 },
  'DIVISLAB':     { symbol: 'DIVISLAB', name: 'Divi Laboratories', sector: 'Pharma', basePrice: 5900, volatility: 0.020, trendBias: 0.0001 },
  'TITAN':        { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer', basePrice: 3650, volatility: 0.016, trendBias: 0.0003 },
  'POWERGRID':    { symbol: 'POWERGRID', name: 'Power Grid Corp', sector: 'Power', basePrice: 325, volatility: 0.014, trendBias: 0.0002 },
  'NTPC':         { symbol: 'NTPC', name: 'NTPC Limited', sector: 'Power', basePrice: 405, volatility: 0.018, trendBias: 0.0003 },
  'ULTRACEMCO':   { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement', basePrice: 11500, volatility: 0.015, trendBias: 0.0001 },
  'TECHM':        { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', basePrice: 1680, volatility: 0.017, trendBias: 0.0000 },
  'HINDALCO':     { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals', basePrice: 625, volatility: 0.022, trendBias: 0.0001 },
  'DRREDDY':      { symbol: 'DRREDDY', name: "Dr Reddy's Labs", sector: 'Pharma', basePrice: 6800, volatility: 0.016, trendBias: 0.0001 },
};

const NIFTY50_PROFILE: StockProfile = {
  symbol: 'NIFTY50',
  name: 'Nifty 50',
  sector: 'Index',
  basePrice: 24500,
  volatility: 0.009,
  trendBias: 0.0002,
};

/**
 * Generate realistic OHLCV data for a given stock profile
 */
export function generateMockData(
  symbol: string,
  days: number = 300,
  endDate?: Date
): OHLCV[] {
  const profile = PROFILES[symbol] || {
    symbol,
    name: symbol,
    sector: 'Unknown',
    basePrice: 1000,
    volatility: 0.015,
    trendBias: 0.0002,
  };

  const rand = seededRandom(hashString(symbol));
  const end = endDate || new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - days * 1.5); // Extra days for weekends

  const candles: OHLCV[] = [];
  let price = profile.basePrice * (0.85 + rand() * 0.3); // Random starting point around base
  let prevClose = price;

  // Generate data day by day (skip weekends)
  const currentDate = new Date(start);
  let tradingDays = 0;

  while (tradingDays < days) {
    const dow = currentDate.getDay();
    if (dow !== 0 && dow !== 6) { // Skip Sun/Sat
      tradingDays++;

      // Add some cyclical patterns — ensure bullish ending
      const progress = tradingDays / days;
      const bullishBias = progress > 0.7 ? 0.001 * (progress - 0.7) / 0.3 : 0; // ramp up bullish at end
      const cycle1 = Math.sin(tradingDays / 30) * 0.005;  // Monthly cycle
      const cycle2 = Math.sin(tradingDays / 90) * 0.008;  // Quarterly cycle

      // Random walk with drift
      const change = (rand() - 0.48) * profile.volatility + profile.trendBias + cycle1 + cycle2 + bullishBias;
      
      // Mean reversion — stronger pull toward base price
      const deviation = (price - profile.basePrice) / profile.basePrice;
      const reversion = -deviation * 0.008;
      
      price = price * (1 + change + reversion);
      price = Math.max(price * 0.5, price); // Floor

      // Generate OHLC with realistic intra-day range
      const intraVol = profile.volatility * (0.3 + rand() * 0.7);
      const high = price * (1 + rand() * intraVol);
      const low = price * (1 - rand() * intraVol);
      const open = low + rand() * (high - low);
      const close = low + rand() * (high - low);

      // Volume: base + random spikes
      const baseVol = profile.basePrice * 10000 * (0.5 + rand());
      const volumeSpike = rand() > 0.85 ? (1.5 + rand() * 2) : 1;
      const volume = Math.round(baseVol * volumeSpike);

      candles.push({
        date: formatDate(currentDate),
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume,
      });

      prevClose = close;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return candles;
}

/**
 * Generate Nifty 50 index data
 */
export function generateNiftyData(days: number = 300, endDate?: Date): OHLCV[] {
  return generateMockData('NIFTY50', days, endDate);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Get all stock profiles
 */
export function getAllProfiles(): StockProfile[] {
  return Object.values(PROFILES);
}

/**
 * Get profile for a specific symbol
 */
export function getProfile(symbol: string): StockProfile | undefined {
  return PROFILES[symbol];
}

/**
 * Generate data for all watchlist stocks
 */
export function generateAllStockData(days: number = 300): Map<string, OHLCV[]> {
  const data = new Map<string, OHLCV[]>();
  for (const symbol of Object.keys(PROFILES)) {
    data.set(symbol, generateMockData(symbol, days));
  }
  return data;
}