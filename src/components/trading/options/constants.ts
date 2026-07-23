'use client';

export const SYMBOLS = [
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'RELIANCE', 'TCS', 'INFY',
  'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BAJFINANCE', 'ITC', 'HINDUNILVR', 'LT', 'BHARTIARTL',
  'MARUTI', 'SUNPHARMA', 'WIPRO',
];

export const STRATEGY_TEMPLATES = [
  {
    id: 'straddle',
    name: 'Long Straddle',
    description: 'Buy ATM CE + ATM PE. Profits from big moves in either direction.',
    condition: 'High IV, expecting large move',
    legs: [
      { optionType: 'CE', action: 'BUY', strikeOffset: 0 },
      { optionType: 'PE', action: 'BUY', strikeOffset: 0 },
    ],
  },
  {
    id: 'strangle',
    name: 'Long Strangle',
    description: 'Buy OTM CE + OTM PE. Cheaper than straddle, needs bigger move.',
    condition: 'High IV, expecting very large move',
    legs: [
      { optionType: 'CE', action: 'BUY', strikeOffset: 5 },
      { optionType: 'PE', action: 'BUY', strikeOffset: -5 },
    ],
  },
  {
    id: 'iron-condor',
    name: 'Iron Condor',
    description: 'Sell OTM strangle + buy further OTM wings. Profits from range-bound markets.',
    condition: 'Low IV, expecting range-bound',
    legs: [
      { optionType: 'PE', action: 'BUY', strikeOffset: -15 },
      { optionType: 'PE', action: 'SELL', strikeOffset: -10 },
      { optionType: 'CE', action: 'SELL', strikeOffset: 10 },
      { optionType: 'CE', action: 'BUY', strikeOffset: 15 },
    ],
  },
  {
    id: 'covered-call',
    name: 'Covered Call',
    description: 'Hold stock + sell OTM CE. Generates income from premium.',
    condition: 'Bullish but capped upside',
    legs: [
      { optionType: 'CE', action: 'SELL', strikeOffset: 10 },
    ],
  },
  {
    id: 'calendar',
    name: 'Calendar Spread',
    description: 'Sell near-term + buy far-term same strike. Profits from time decay differential.',
    condition: 'Neutral, expecting low volatility',
    legs: [
      { optionType: 'CE', action: 'SELL', strikeOffset: 0 },
      { optionType: 'CE', action: 'BUY', strikeOffset: 0 },
    ],
  },
];

export const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6'];