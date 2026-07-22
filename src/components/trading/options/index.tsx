'use client';

import { useState } from 'react';
import { BarChart3, Zap, CheckCircle2, AlertTriangle, ShieldCheck, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { OptionChainTab } from './options-chain-tab';
import { NewTradeTab } from './new-trade-tab';
import { PositionsTab } from './positions-tab';
import { StrategiesTab } from './strategies-tab';
import { OptionsAnalyticsTab } from './options-analytics-tab';

export interface OptionSignal {
  symbol: string;
  underlying: string;
  strike: string;
  type: 'CE' | 'PE';
  premium: number;
  delta: number;
  sl: number;
  tp: number;
  confidence: number; // e.g. 92%
  setup: 'A+' | 'A';
  expiry: string;
  factors: string[];
}

export const LIVE_OPTIONS_SIGNALS: OptionSignal[] = [
  {
    symbol: 'NIFTY50', underlying: 'NIFTY 50 Index', strike: 'NIFTY 24500 CE',
    type: 'CE', premium: 120.50, delta: 0.54, sl: 90.38, tp: 180.75,
    confidence: 92, setup: 'A+', expiry: 'Weekly 25-JUL-2026',
    factors: ['Nifty > EMA200 Regime', '5-Min EMA20 Pullback', 'Delta > 0.50']
  },
  {
    symbol: 'BANKNIFTY', underlying: 'Bank Nifty Index', strike: 'BANKNIFTY 52200 CE',
    type: 'CE', premium: 285.00, delta: 0.58, sl: 213.75, tp: 427.50,
    confidence: 88, setup: 'A+', expiry: 'Weekly 25-JUL-2026',
    factors: ['Bank Nifty Volume Surge 1.4x', 'RSI 58 Bullish Zone', 'High Delta 0.58']
  },
  {
    symbol: 'FINNIFTY', underlying: 'Finnifty Index', strike: 'FINNIFTY 23100 PE',
    type: 'PE', premium: 95.20, delta: -0.48, sl: 71.40, tp: 142.80,
    confidence: 85, setup: 'A', expiry: 'Weekly 25-JUL-2026',
    factors: ['Intraday Reversal at Resistance', 'VIX Expansion +3.2%', 'EMA10 Trail']
  },
  {
    symbol: 'LT', underlying: 'Larsen & Toubro', strike: 'LT 3600 CE',
    type: 'CE', premium: 62.40, delta: 0.53, sl: 46.80, tp: 93.60,
    confidence: 91, setup: 'A+', expiry: 'Monthly 27-JUL-2026',
    factors: ['Infra Rally Support', '5-Min EMA20 Bounce', 'Vol Surge > 1.3x']
  },
  {
    symbol: 'RELIANCE', underlying: 'Reliance Industries', strike: 'RELIANCE 3100 CE',
    type: 'CE', premium: 48.60, delta: 0.52, sl: 36.45, tp: 72.90,
    confidence: 90, setup: 'A+', expiry: 'Monthly 27-JUL-2026',
    factors: ['Breakout Above 20-Day High', 'Institutional Buying', 'Vol > 1.3x']
  },
  {
    symbol: 'INFY', underlying: 'Infosys Ltd', strike: 'INFY 1850 PE',
    type: 'PE', premium: 28.40, delta: -0.50, sl: 21.30, tp: 42.60,
    confidence: 84, setup: 'A', expiry: 'Monthly 27-JUL-2026',
    factors: ['IT Sector Retracement', 'Lower High Trigger', 'Target RR 2.0x']
  },
  {
    symbol: 'TATAMOTORS', underlying: 'Tata Motors Ltd', strike: 'TATAMOTORS 980 CE',
    type: 'CE', premium: 22.10, delta: 0.51, sl: 16.57, tp: 33.15,
    confidence: 87, setup: 'A', expiry: 'Monthly 27-JUL-2026',
    factors: ['Auto Sales Surge', 'RSI Breakout', 'Volume Expansion']
  },
  {
    symbol: 'TATASTEEL', underlying: 'Tata Steel Ltd', strike: 'TATASTEEL 175 CE',
    type: 'CE', premium: 4.20, delta: 0.51, sl: 3.15, tp: 6.30,
    confidence: 86, setup: 'A', expiry: 'Monthly 27-JUL-2026',
    factors: ['Metals Rally Support', 'EMA20 Bounce', 'Volume Expansion']
  },
  {
    symbol: 'TCS', underlying: 'Tata Consultancy Services', strike: 'TCS 3900 CE',
    type: 'CE', premium: 54.00, delta: 0.50, sl: 40.50, tp: 81.00,
    confidence: 85, setup: 'A', expiry: 'Monthly 27-JUL-2026',
    factors: ['IT Trend Continuation', 'EMA10 Trail', 'Low Slippage']
  },
  {
    symbol: 'BAJFINANCE', underlying: 'Bajaj Finance Ltd', strike: 'BAJFINANCE 7200 CE',
    type: 'CE', premium: 145.00, delta: 0.55, sl: 108.75, tp: 217.50,
    confidence: 89, setup: 'A+', expiry: 'Monthly 27-JUL-2026',
    factors: ['NBFC Breakout', 'High Delta 0.55', 'Volume Surge']
  }
];

export function OptionsTab() {
  const [selectedSignalSymbol, setSelectedSignalSymbol] = useState<string>('NIFTY50');

  const activeSignal = LIVE_OPTIONS_SIGNALS.find(s => s.symbol === selectedSignalSymbol) || LIVE_OPTIONS_SIGNALS[0];

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/30">
            <Zap className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              Intraday Options Engine
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">Broker Account A Dedicated</Badge>
            </h1>
            <p className="text-xs text-muted-foreground">High-Delta Intraday Options Trading with 3:15 PM EOD Auto Square-off</p>
          </div>
        </div>
      </div>

      {/* ── MULTI-SYMBOL ACTIONABLE LIVE OPTIONS SIGNALS ───────── */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">Live Actionable Option Contracts (Select Symbol)</span>
          </div>
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono text-[11px]">
            {LIVE_OPTIONS_SIGNALS.length} Active Signals Ready
          </Badge>
        </div>

        {/* Symbol Selector Buttons Grid */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {LIVE_OPTIONS_SIGNALS.map((s) => (
            <button
              key={s.symbol}
              onClick={() => setSelectedSignalSymbol(s.symbol)}
              className={cn(
                "flex flex-col items-center justify-center p-2 rounded-lg border text-center transition-all",
                selectedSignalSymbol === s.symbol
                  ? "border-amber-500 bg-amber-500/20 shadow-sm"
                  : "border-border/60 bg-secondary/30 hover:border-amber-500/50"
              )}
            >
              <div className="flex items-center gap-1">
                <span className="text-xs font-bold font-mono">{s.symbol}</span>
                {s.type === 'CE' ? (
                  <ArrowUpRight className="h-3 w-3 text-emerald-400" />
                ) : (
                  <ArrowDownRight className="h-3 w-3 text-red-400" />
                )}
              </div>
              <span className="text-[10px] text-amber-400 font-mono font-semibold">{s.type}</span>
            </button>
          ))}
        </div>

        {/* Selected Signal Detail Panel */}
        <div className="rounded-lg border border-border bg-card/80 p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <span className="text-xs font-semibold text-muted-foreground">{activeSignal.underlying}</span>
              <h3 className="text-base font-bold font-mono text-amber-400 flex items-center gap-2">
                {activeSignal.strike}
                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                  Setup: {activeSignal.setup} ({activeSignal.confidence}% Confidence)
                </Badge>
              </h3>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-muted-foreground">Expiry</span>
              <div className="text-xs font-mono font-semibold">{activeSignal.expiry}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase">Premium</span>
              <div className="text-sm font-bold font-mono text-foreground mt-0.5">₹{activeSignal.premium.toFixed(2)}</div>
              <div className="text-[10px] text-emerald-400 font-mono">Delta: {activeSignal.delta}</div>
            </div>

            <div className="rounded-lg bg-red-500/10 p-2.5 border border-red-500/20">
              <span className="text-[10px] text-red-400 uppercase font-semibold">Stop Loss (-25%)</span>
              <div className="text-sm font-bold font-mono text-red-400 mt-0.5">₹{activeSignal.sl.toFixed(2)}</div>
              <div className="text-[10px] text-muted-foreground">Strict Risk Limit</div>
            </div>

            <div className="rounded-lg bg-emerald-500/10 p-2.5 border border-emerald-500/20">
              <span className="text-[10px] text-emerald-400 uppercase font-semibold">Take Profit (+50%)</span>
              <div className="text-sm font-bold font-mono text-emerald-400 mt-0.5">₹{activeSignal.tp.toFixed(2)}</div>
              <div className="text-[10px] text-muted-foreground">Target Lock</div>
            </div>

            <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase">Risk : Reward</span>
              <div className="text-sm font-bold font-mono text-indigo-400 mt-0.5">1 : 2.0x</div>
              <div className="text-[10px] text-muted-foreground">Fixed Structure</div>
            </div>
          </div>

          {/* Factors Aligned */}
          <div className="space-y-1 text-xs pt-1 border-t border-border/40">
            <span className="text-[10px] font-bold uppercase text-emerald-400">✅ Confluence Factors Aligned:</span>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-muted-foreground">
              {activeSignal.factors.map((f, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  <span>{f}</span>
                </div>
              ))}
            </div>
          </div>

          <Button
            onClick={() => toast.success(`Order Placed on DhanHQ Broker Account A: ${activeSignal.strike} @ ₹${activeSignal.premium}`)}
            className="w-full bg-amber-600 hover:bg-amber-700 text-xs font-bold gap-2 h-9"
          >
            <Zap className="h-4 w-4" /> Execute {activeSignal.strike} Signal (Broker Account A)
          </Button>
        </div>
      </div>

      <Tabs defaultValue="chain" className="space-y-4">
        <TabsList className="bg-secondary/50 h-9 p-0.5">
          <TabsTrigger value="chain" className="text-xs px-3 h-8 data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            Option Chain
          </TabsTrigger>
          <TabsTrigger value="trade" className="text-xs px-3 h-8 data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            New Trade
          </TabsTrigger>
          <TabsTrigger value="positions" className="text-xs px-3 h-8 data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            Positions
          </TabsTrigger>
          <TabsTrigger value="strategies" className="text-xs px-3 h-8 data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            Strategies
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs px-3 h-8 data-[state=active]:bg-amber-600 data-[state=active]:text-white">
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chain"><OptionChainTab /></TabsContent>
        <TabsContent value="trade"><NewTradeTab /></TabsContent>
        <TabsContent value="positions"><PositionsTab /></TabsContent>
        <TabsContent value="strategies"><StrategiesTab /></TabsContent>
        <TabsContent value="analytics"><OptionsAnalyticsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default OptionsTab;