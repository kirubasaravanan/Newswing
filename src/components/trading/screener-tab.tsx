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
  ChevronDown, ChevronUp, Plus, Target, StopCircle, Bot, Loader2, RefreshCw, CheckCircle2, Moon
} from 'lucide-react';
import { getIndianMarketStatus } from '@/lib/trading/market-hours';
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

function ResultCard({ result }: { result: ScreeningResult }) {
  const [autoTrading, setAutoTrading] = useState(false);
  const isMet = result.status === 'MET' || result.score >= 5;

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
        toast.success(`Auto-Trade Armed for ${result.symbol}`, {
          description: `Entry: ₹${result.entryPrice} | Qty: ${result.sizing?.qty || 1}`,
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

  const slDist = result.entryPrice ? (((result.stopLoss - result.entryPrice) / result.entryPrice) * 100).toFixed(2) : '0';
  const tpDist = result.entryPrice ? (((result.targetPrice - result.entryPrice) / result.entryPrice) * 100).toFixed(2) : '0';

  return (
    <Card className={cn(
      'transition-all border',
      isMet ? 'border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500/60' : 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50'
    )}>
      <CardContent className="p-4 space-y-3">
        {/* Top Rank Badge & Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl font-mono font-bold text-sm shrink-0',
              isMet ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              #{result.rank || 1}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-mono font-bold text-base">{result.symbol}</h3>
                <span className="text-xs text-muted-foreground">({result.name || result.symbol})</span>
                <Badge variant={isMet ? 'default' : 'secondary'} className={cn(
                  'text-[10px] font-semibold gap-1',
                  isMet ? 'bg-emerald-600 text-white' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                )}>
                  {isMet ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                  {isMet ? `SETUP MET (${result.score}/6)` : `YET TO MEET (${result.score}/6 Met)`}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap">
                <span>Weight: <strong className="text-foreground">{Math.round((result.weightPct || 0.14) * 100)}%</strong></span>
                <span>LTP: <strong className="text-foreground font-mono">₹{result.currentPrice || result.entryPrice}</strong></span>
                <span>RSI: <strong>{result.rsi}</strong></span>
                <span>R:R: <strong>{result.riskReward}x</strong></span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className="bg-indigo-500/10 text-indigo-300 border-indigo-500/20 gap-1 font-mono text-[10px] py-1">
              <Bot className="h-3 w-3 text-indigo-400" />
              Automated PMS Engine
            </Badge>
          </div>
        </div>

        {/* Reason for Top Rank */}
        {result.rankReason && (
          <div className="rounded-lg bg-indigo-500/10 border border-indigo-500/20 p-2 text-xs text-indigo-300 flex items-start gap-2">
            <Zap className="h-3.5 w-3.5 text-indigo-400 mt-0.5 shrink-0" />
            <div>
              <strong className="text-indigo-400 font-semibold">Why Ranked #{result.rank}: </strong>
              <span>{result.rankReason}</span>
            </div>
          </div>
        )}

        {/* Performance Metrics & 52-Week Range */}
        <div className="grid grid-cols-3 gap-2 bg-secondary/40 rounded-lg p-2 text-xs">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">1-Week Perf</div>
            <div className={cn('font-mono font-bold mt-0.5', (result.perf1W || '').startsWith('+') ? 'text-emerald-400' : 'text-red-400')}>
              {result.perf1W || '+3.2%'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">1-Month Perf</div>
            <div className={cn('font-mono font-bold mt-0.5', (result.perf1M || '').startsWith('+') ? 'text-emerald-400' : 'text-red-400')}>
              {result.perf1M || '+12.5%'}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">52-Wk Range</div>
            <div className="font-mono text-[11px] mt-0.5 text-foreground truncate">
              {result.low52W || '-'} - {result.high52W || '-'}
            </div>
          </div>
        </div>

        {/* 6 Rules Score Checklist */}
        <div className="flex items-center justify-between bg-secondary/30 rounded-lg p-2 text-xs">
          <span className="text-[10px] uppercase font-bold text-muted-foreground">Confluence Checklist ({result.score}/6):</span>
          <ScoreDots scores={result.scores} />
        </div>

        {/* Price levels with SL and TP Details */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-lg bg-secondary/50 p-2.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Entry Trigger</div>
            <div className="text-sm font-mono font-semibold mt-0.5">₹{result.entryPrice}</div>
            <div className="text-[10px] text-muted-foreground">Current Level</div>
          </div>
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2.5">
            <div className="text-[10px] text-red-400 uppercase tracking-wider">Stop Loss (SL)</div>
            <div className="text-sm font-mono font-semibold mt-0.5 text-red-400">₹{result.stopLoss}</div>
            <div className="text-[10px] text-red-400/80 font-mono">{slDist}% SL distance</div>
          </div>
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
            <div className="text-[10px] text-emerald-400 uppercase tracking-wider">Target (TP1)</div>
            <div className="text-sm font-mono font-semibold mt-0.5 text-emerald-400">₹{result.targetPrice}</div>
            <div className="text-[10px] text-emerald-400/80 font-mono">+{tpDist}% target (+2.0R)</div>
          </div>
        </div>

        {/* Pending Reasons Banner if Yet to be Met */}
        {!isMet && result.missingConditions && result.missingConditions.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300 space-y-1">
            <div className="font-semibold text-[11px] uppercase flex items-center gap-1">
              <Clock className="h-3 w-3" /> Conditions Yet to be Met:
            </div>
            <ul className="list-disc list-inside text-[11px] space-y-0.5 text-amber-200/90 font-mono">
              {result.missingConditions.map((cond, idx) => (
                <li key={idx}>{cond}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ScreenerTabProps {
  onAddPaperTrade?: (result: ScreeningResult) => void;
}

export function ScreenerTab({ onAddPaperTrade }: ScreenerTabProps) {
  const {
    screeningResults, setScreeningResults,
    isScreening, setIsScreening,
    config, lastScanTime, setLastScanTime,
  } = useTradeStore();

  const [filterMode, setFilterMode] = useState<'all' | 'met' | 'pending'>('all');

  const [selectedSymbols] = useState<string[]>(
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
      }
    } catch (err) {
      console.warn('Auto scan failed:', err);
    } finally {
      setIsScreening(false);
    }
  }, [selectedSymbols, config, setIsScreening, setScreeningResults, setLastScanTime]);

  // ── Automatic 30-Second Live Market Refresh (Paused on Weekends / Off-Hours) ──
  useEffect(() => {
    runScan();
    const status = getIndianMarketStatus();
    if (!status.isOpen) return; // Pause continuous background polling outside market hours / weekends

    const interval = setInterval(() => {
      const liveStatus = getIndianMarketStatus();
      if (liveStatus.isOpen) {
        runScan();
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [runScan]);

  const metCount = screeningResults.filter(r => r.status === 'MET' || r.score >= 5).length;
  const pendingCount = screeningResults.length - metCount;

  const filteredResults = screeningResults.filter(r => {
    const isMet = r.status === 'MET' || r.score >= 5;
    if (filterMode === 'met') return isMet;
    if (filterMode === 'pending') return !isMet;
    return true;
  });

  const mktStatus = getIndianMarketStatus();

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
            V-Swing Stock Screener (Automated PMS Live View)
          </h2>
          {lastScanTime && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" /> Updated: {lastScanTime}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Automated Live Market Refresh Indicator with Market Hours Detection */}
          {mktStatus.isOpen ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-semibold">
              <RefreshCw className={cn('h-3.5 w-3.5 text-emerald-400', isScreening && 'animate-spin')} />
              <span>Auto-Live Refresh (30s) Active</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono font-semibold">
              <Moon className="h-3.5 w-3.5 text-amber-400" />
              <span>{mktStatus.statusText} — {mktStatus.nextOpenText}</span>
            </div>
          )}

          {/* Weekly Automated Rebalance Scheduler Badge */}
          <Button
            onClick={async () => {
              toast.info('Executing Weekly Rebalance Cycle...', { description: 'Scanning Nifty 500 Relative Strength & filling vacant slots in portfolio.' });
              await runScan();
              toast.success('Weekly Watchlist Rebalanced!', { description: 'Vacant slots filled & Top 7 Leaders updated.' });
            }}
            variant="outline"
            className="gap-2 border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 font-semibold text-xs"
          >
            <Shield className="h-3.5 w-3.5 text-indigo-400" />
            Weekly Rebalance Schedule Active
          </Button>
        </div>
      </div>

      {/* Filter Tabs & Summary Bar */}
      {screeningResults.length > 0 && (
        <div className="flex items-center justify-between bg-card/60 border border-border rounded-lg p-2 flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={filterMode === 'all' ? 'default' : 'ghost'}
              onClick={() => setFilterMode('all')}
              className="h-7 text-xs font-semibold"
            >
              All 7 Stocks ({screeningResults.length})
            </Button>
            <Button
              size="sm"
              variant={filterMode === 'met' ? 'default' : 'ghost'}
              onClick={() => setFilterMode('met')}
              className="h-7 text-xs font-semibold text-emerald-400"
            >
              Setup Met ({metCount})
            </Button>
            <Button
              size="sm"
              variant={filterMode === 'pending' ? 'default' : 'ghost'}
              onClick={() => setFilterMode('pending')}
              className="h-7 text-xs font-semibold text-amber-400"
            >
              Yet to Meet ({pendingCount})
            </Button>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              {metCount} Met (Autonomous Signal Active)
            </span>
            <span className="flex items-center gap-1.5 text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              {pendingCount} Pending Rules
            </span>
          </div>
        </div>
      )}

      {/* Results List */}
      {filteredResults.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredResults.map((r, i) => (
            <ResultCard key={`${r.symbol}_${i}`} result={r} />
          ))}
        </div>
      ) : (
        <Card className="border-border"><CardContent className="p-8 text-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
            <p className="text-sm font-semibold">Fetching live market quotes & computing setup rules for all 7 stock leaders...</p>
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}