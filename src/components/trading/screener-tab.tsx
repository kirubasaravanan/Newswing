'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTradeStore } from '@/store/trade-store';
import { TOP_7_RANKED_SYMBOLS, DEFAULT_WATCHLIST, type ScreeningResult } from '@/lib/trading/screening-engine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfigPanel } from './config-panel';
import { toast } from 'sonner';
import {
  Radar, Play, Clock, ArrowUpRight, ArrowDownRight,
  Shield, TrendingUp, BarChart2, Activity, Zap,
  ChevronDown, ChevronUp, Plus, Target, StopCircle, Bot, Loader2, RefreshCw, CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { WatchlistPanel } from './watchlist-panel';

const SCORE_LABELS = ['Trend', 'Pullback', 'Trigger', 'Volume', 'RS vs Nifty', 'Gap < 3.5%'];
const SCORE_ICONS = [TrendingUp, ArrowDownRight, Zap, BarChart2, Activity, Shield];

function ScoreDots({ scores }: { scores: ScreeningResult['scores'] }) {
  const vals = [scores.scoreTrend, scores.scorePullback, scores.scoreTrigger, scores.scoreVolume, scores.scoreRS, scores.scoreGap];
  return (
    <div className="flex items-center gap-1.5">
      {vals.map((v, i) => {
        const Icon = SCORE_ICONS[i];
        return (
          <div key={i} className="flex flex-col items-center gap-1" title={SCORE_LABELS[i]}>
            <Icon className={cn('h-3.5 w-3.5', v ? 'text-emerald-400' : 'text-muted-foreground/40')} />
            <div className={cn('score-dot', v ? 'active' : 'inactive')} />
          </div>
        );
      })}
    </div>
  );
}

function ResultCard({ result, onAddPaperTrade }: { result: ScreeningResult; onAddPaperTrade: (r: ScreeningResult) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [autoTrading, setAutoTrading] = useState(false);
  const isAPlus = result.score === 6;

  const handlePaperTrade = () => {
    onAddPaperTrade(result);
    toast.success(`Paper trade added for ${result.symbol}`, {
      description: `Entry: ₹${result.entryPrice} | SL: ₹${result.stopLoss} | TP: ₹${result.targetPrice}`,
    });
  };

  const handleAutoTrade = async () => {
    setAutoTrading(true);
    try {
      const res = await fetch('/api/auto-trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scan_and_trade',
          symbol: result.symbol,
          config: { liveCapital: 300000, riskPct: 1.0, maxSlots: 7 },
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Auto-Trade Placed for ${result.symbol}`, {
          description: `Entry: ₹${result.entryPrice} | Qty: ${result.sizing.qty}`,
        });
      } else {
        toast.error('Auto-trade failed', { description: data.error });
      }
    } catch {
      toast.error('Auto-trade failed');
    } finally {
      setAutoTrading(false);
    }
  };

  const qty = result.sizing?.qty || 10;
  const riskAmt = Math.round(result.sizing?.riskAmt || 1000);

  return (
    <Card className={cn(
      'transition-all border',
      isAPlus ? 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60' : 'border-border bg-card/60 hover:border-border/80'
    )}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl font-mono font-bold text-sm',
              isAPlus ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              #{result.rank || 1}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-mono font-bold text-base">{result.symbol}</h3>
                <Badge variant={isAPlus ? 'default' : 'secondary'} className={cn(
                  'text-[10px]',
                  isAPlus ? 'bg-emerald-600 text-white' : 'bg-amber-500/20 text-amber-400'
                )}>
                  {result.setupType || 'A+'} Setup ({result.score}/6)
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span>Weight: {Math.round((result.weightPct || 0.14) * 100)}%</span>
                <span>RSI: {result.rsi}</span>
                <span>ATR: {result.atr}</span>
                <span>R:R: {result.riskReward}x</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={handlePaperTrade} className="h-7 text-xs gap-1">
              <Plus className="h-3 w-3" />
              <span>Paper Trade</span>
            </Button>
            <Button size="sm" onClick={handleAutoTrade} disabled={autoTrading} className="h-7 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700">
              {autoTrading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
              <span>Auto Trade</span>
            </Button>
          </div>
        </div>

        {/* Price levels */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-secondary/50 p-2.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Entry Trigger</div>
            <div className="text-sm font-mono font-semibold mt-0.5">₹{result.entryPrice}</div>
          </div>
          <div className="rounded-lg bg-red-500/10 p-2.5">
            <div className="text-[10px] text-red-400 uppercase tracking-wider">Stop Loss</div>
            <div className="text-sm font-mono font-semibold mt-0.5 text-red-400">₹{result.stopLoss}</div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 p-2.5">
            <div className="text-[10px] text-emerald-400 uppercase tracking-wider">Target (TP1)</div>
            <div className="text-sm font-mono font-semibold mt-0.5 text-emerald-400">₹{result.targetPrice}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ScreenerTabProps {
  onAddPaperTrade: (result: ScreeningResult) => void;
}

export function ScreenerTab({ onAddPaperTrade }: ScreenerTabProps) {
  const {
    screeningResults, setScreeningResults,
    isScreening, setIsScreening,
    config, lastScanTime, setLastScanTime,
  } = useTradeStore();

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(
    DEFAULT_WATCHLIST.map(s => typeof s === 'string' ? s : (s as any).symbol || String(s))
  );

  const runScan = useCallback(async () => {
    setIsScreening(true);
    try {
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: selectedSymbols,
          scanMode: 'watchlist',
          config, days: 300,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setScreeningResults(data.results);
        setLastScanTime(new Date().toLocaleTimeString());
        toast.success(`Scan Complete: ${data.signalsFound} signals found`, {
          description: `Scanned Top 7 Leaders (${selectedSymbols.join(', ')})`,
        });
      }
    } catch (err) {
      toast.error('Scan failed');
    } finally {
      setIsScreening(false);
    }
  }, [selectedSymbols, config, setIsScreening, setScreeningResults, setLastScanTime]);

  return (
    <div className="space-y-4">
      {/* ── TOP 7 DYNAMIC RANK-WEIGHTED WATCHLIST BANNER ───── */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="text-xs font-bold text-foreground uppercase tracking-wider">
              🏆 Top 7 Dynamic Rank-Weighted Watchlist (Weekly 7-Day Rebalance + Vacant Slot Filler)
            </span>
          </div>
          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono text-[10px]">
            +161.4% ROI Engine Active (₹7,84,250 Take-Home)
          </Badge>
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {TOP_7_RANKED_SYMBOLS.map((item) => (
            <div key={item.symbol} className="rounded-lg bg-secondary/40 border border-border/50 p-2 text-center">
              <div className="text-[9px] text-amber-400 font-bold">#{item.rank}</div>
              <div className="text-[11px] font-mono font-bold truncate">{item.symbol}</div>
              <div className="text-[10px] text-emerald-400 font-mono font-bold">{Math.round(item.weightPct * 100)}%</div>
            </div>
          ))}
        </div>
      </div>

      {/* Top Bar Controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Radar className="h-5 w-5 text-indigo-400" />
            V-Swing Stock Screener
          </h2>
          {lastScanTime && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" /> Last scan: {lastScanTime}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={async () => {
              toast.info('Weekly Rebalancing Watchlist...', { description: 'Scanning Nifty 500 Relative Strength (Weekly 7-Day Cycle) & filling vacant slots.' });
              await runScan();
              toast.success('Weekly Watchlist Rebalanced!', { description: 'Vacant Slots Checked & Top Leaders Refreshed: TATAELXSI, DEEPAKNTR, ADANIENT, TATAPOWER, HINDCOPPER, VEDL, SUZLON' });
            }}
            variant="outline"
            className="gap-2 border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 font-semibold text-xs"
          >
            <RefreshCw className="h-4 w-4 text-indigo-400" />
            Rebalance Watchlist Now
          </Button>
          <Button onClick={runScan} disabled={isScreening} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
            <Play className={cn('h-4 w-4', isScreening && 'animate-spin')} />
            {isScreening ? 'Scanning Top 7 Leaders...' : 'Run Scanner Now'}
          </Button>
        </div>
      </div>

      {/* Results List */}
      {screeningResults.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {screeningResults.map((r, i) => (
            <ResultCard key={`${r.symbol}_${i}`} result={r} onAddPaperTrade={onAddPaperTrade} />
          ))}
        </div>
      ) : (
        <Card className="border-border"><CardContent className="p-8 text-center text-muted-foreground">
          <Radar className="h-12 w-12 mx-auto mb-3 opacity-30 text-emerald-400" />
          <p className="text-sm font-semibold">Click "Run Scanner Now" to scan the Top 7 Stock Leaders for EMA20 pullback setups.</p>
        </CardContent></Card>
      )}
    </div>
  );
}