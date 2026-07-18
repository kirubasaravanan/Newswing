'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTradeStore } from '@/store/trade-store';
import { DEFAULT_WATCHLIST, type ScreeningResult } from '@/lib/trading/screening-engine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ConfigPanel } from './config-panel';
import { toast } from 'sonner';
import {
  Radar, Play, Clock, ArrowUpRight, ArrowDownRight,
  Shield, TrendingUp, BarChart2, Activity, Zap,
  ChevronDown, ChevronUp, Plus, Target, StopCircle,
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

function MiniChart({ symbol, entryPrice, stopLoss, targetPrice }: { symbol: string; entryPrice: number; stopLoss: number; targetPrice: number }) {
  const [chartData, setChartData] = useState<{ date: string; close: number; ema20: number | null }[]>([]);

  useEffect(() => {
    fetch(`/api/chart-data?symbol=${symbol}&days=60`)
      .then(res => res.json())
      .then(data => {
        if (data.success) setChartData(data.data);
      })
      .catch(() => {});
  }, [symbol]);

  if (chartData.length === 0) return null;

  const isBullish = chartData[chartData.length - 1]?.close >= chartData[0]?.close;
  const color = isBullish ? '#10b981' : '#ef4444';

  return (
    <div className="h-20 mt-3 -mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.15} />
              <stop offset="95%" stopColor="transparent" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 11, padding: '4px 8px' }}
            labelStyle={{ display: 'none' }}
            formatter={(value: number) => [`₹${value.toFixed(0)}`, 'Close']}
          />
          <ReferenceLine y={stopLoss} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.5} />
          <ReferenceLine y={targetPrice} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.5} />
          <Area type="monotone" dataKey="close" stroke={color} fill={`url(#grad-${symbol})`} strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResultCard({ result, onAddTrade }: { result: ScreeningResult; onAddTrade: (r: ScreeningResult) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isAPlus = result.setupType === 'A+';
  const qty = isAPlus ? result.sizing.qtyA : result.sizing.qtyB;
  const riskAmt = isAPlus ? result.sizing.riskAmtA : result.sizing.riskAmtB;

  const handlePaperTrade = () => {
    onAddTrade(result);
    toast.success(`${result.symbol} added to Paper Trade Journal`, {
      description: `${result.setupType} Setup | Score ${result.score}/6 | Qty: ${qty}`,
    });
  };

  return (
    <Card className={cn(
      'border transition-all hover:border-primary/30',
      isAPlus ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'
    )}>
      <CardContent className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              'flex h-10 w-10 items-center justify-center rounded-lg text-sm font-bold shrink-0',
              isAPlus ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            )}>
              {result.score}/6
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{result.symbol}</span>
                <Badge variant={isAPlus ? 'default' : 'secondary'} className={cn(
                  'text-[10px] px-1.5 py-0',
                  isAPlus ? 'bg-emerald-500/20 text-emerald-400 border-0' : 'bg-amber-500/20 text-amber-400 border-0'
                )}>
                  {result.setupType} Setup
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                <span>RSI: {result.rsi}</span>
                <span>ATR: {result.atr}</span>
                <span>R:R: {result.riskReward}x</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePaperTrade}
              className="h-7 text-xs gap-1"
            >
              <Plus className="h-3 w-3" />
              <span className="hidden sm:inline">Paper Trade</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExpanded(!expanded)}
              className="h-7 w-7"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Mini Chart */}
        <MiniChart symbol={result.symbol} entryPrice={result.entryPrice} stopLoss={result.stopLoss} targetPrice={result.targetPrice} />

        {/* Price levels */}
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-secondary/50 p-2.5">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Entry</div>
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

        {/* Confluence Score Dots */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase">Confluence</span>
            <ScoreDots scores={result.scores} />
          </div>
          <div className="text-right">
            <div className="text-[10px] text-muted-foreground">Qty: <span className="text-foreground font-mono">{qty}</span></div>
            <div className="text-[10px] text-muted-foreground">Risk: <span className="text-foreground font-mono">₹{riskAmt.toLocaleString()}</span></div>
          </div>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="mt-4 border-t border-border pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between rounded bg-secondary/50 px-3 py-2">
                <span className="text-muted-foreground">SMA 200</span>
                <span className="font-mono">₹{result.indicators.sma200}</span>
              </div>
              <div className="flex items-center justify-between rounded bg-secondary/50 px-3 py-2">
                <span className="text-muted-foreground">EMA 20</span>
                <span className="font-mono">₹{result.indicators.ema20}</span>
              </div>
              <div className="flex items-center justify-between rounded bg-secondary/50 px-3 py-2">
                <span className="text-muted-foreground">ADX</span>
                <span className="font-mono">{result.indicators.adx}</span>
              </div>
              <div className="flex items-center justify-between rounded bg-secondary/50 px-3 py-2">
                <span className="text-muted-foreground">DI+/DI-</span>
                <span className="font-mono">{result.indicators.diPlus}/{result.indicators.diMinus}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {Object.entries(result.checks).map(([key, val]) => (
                <div key={key} className="flex items-center gap-1.5 rounded bg-secondary/50 px-3 py-1.5">
                  <div className={cn('h-1.5 w-1.5 rounded-full', val ? 'bg-emerald-400' : 'bg-red-400/60')} />
                  <span className="capitalize text-muted-foreground">{key.replace(/([A-Z])/g, ' $1')}</span>
                </div>
              ))}
            </div>
            {isAPlus && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-400">
                <strong>A+ Perfect Confluence:</strong> All 6 factors aligned. Full risk allocation ({result.sizing.qtyA} shares, ₹{result.sizing.riskAmtA.toLocaleString()} risk).
              </div>
            )}
          </div>
        )}
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

  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(DEFAULT_WATCHLIST.map(s => s.symbol));
  const [watchlistCount, setWatchlistCount] = useState(selectedSymbols.length);

  // Fetch watchlist symbols from DB
  useEffect(() => {
    fetch('/api/watchlist')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.stocks.length > 0) {
          const syms = data.stocks.map((s: any) => s.symbol);
          setSelectedSymbols(syms);
          setWatchlistCount(syms.length);
        }
      })
      .catch(() => {});
  }, []);

  const [scanMode, setScanMode] = useState<'watchlist' | 'universe'>('watchlist');

  const runScan = useCallback(async () => {
    setIsScreening(true);
    try {
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbols: scanMode === 'watchlist' ? selectedSymbols : [],
          scanMode,
          config, days: 300,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setScreeningResults(data.results);
        setLastScanTime(new Date().toLocaleTimeString());
        const aPlus = data.results.filter((r: any) => r.score === 6).length;
        const bSetups = data.results.filter((r: any) => r.score < 6).length;
        toast.success(`Scan Complete: ${data.signalsFound} signals found`, {
          description: `${aPlus} A+ setups, ${bSetups} B setups from ${data.totalScanned} stocks scanned`,
        });
      }
    } catch (err) {
      toast.error('Scan failed', { description: 'Check the console for error details.' });
      console.error('Scan failed:', err);
    } finally {
      setIsScreening(false);
    }
  }, [selectedSymbols, config, scanMode, setIsScreening, setScreeningResults, setLastScanTime]);

  const aPlusCount = screeningResults.filter(r => r.score === 6).length;
  const bCount = screeningResults.filter(r => r.score < 6).length;

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Radar className="h-5 w-5 text-indigo-400" />
            V-Swing Scanner
          </h2>
          <div className="flex items-center gap-1 rounded-lg bg-secondary/50 p-0.5">
            <button
              onClick={() => setScanMode('watchlist')}
              className={cn('px-2.5 py-1 text-xs rounded-md transition',
                scanMode === 'watchlist' ? 'bg-indigo-500/20 text-indigo-400' : 'text-muted-foreground hover:text-foreground')}
            >Watchlist ({watchlistCount})</button>
            <button
              onClick={() => setScanMode('universe')}
              className={cn('px-2.5 py-1 text-xs rounded-md transition',
                scanMode === 'universe' ? 'bg-indigo-500/20 text-indigo-400' : 'text-muted-foreground hover:text-foreground')}
            >Full Universe (~230)</button>
          </div>
          {lastScanTime && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {lastScanTime}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1 hidden sm:inline">
            {selectedSymbols.length} stocks
          </span>
          <WatchlistPanel stockCount={watchlistCount} />
          <ConfigPanel />
          <Button
            onClick={runScan}
            disabled={isScreening}
            className={cn(
              'gap-2',
              isScreening ? 'bg-amber-600 hover:bg-amber-700' : ''
            )}
          >
            <Play className={cn('h-4 w-4', isScreening && 'animate-spin')} />
            {isScreening ? 'Scanning...' : 'Run Scan'}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {screeningResults.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Signals</div>
              <div className="text-2xl font-bold mt-1">{screeningResults.length}</div>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/20">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">A+ Setups</div>
              <div className="text-2xl font-bold mt-1 text-emerald-400">{aPlusCount}</div>
            </CardContent>
          </Card>
          <Card className="border-amber-500/20">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-amber-400">B Setups</div>
              <div className="text-2xl font-bold mt-1 text-amber-400">{bCount}</div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg R:R</div>
              <div className="text-2xl font-bold mt-1">
                {screeningResults.length > 0
                  ? (screeningResults.reduce((s, r) => s + r.riskReward, 0) / screeningResults.length).toFixed(1)
                  : '0'
                }x
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {screeningResults.length === 0 && !isScreening && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/50 mb-4">
            <Radar className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Ready to Scan</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Configure your parameters with the gear icon, then click <strong>Run Scan</strong> to analyze {selectedSymbols.length} NSE stocks using the V-Swing v65.5 strategy engine.
          </p>
          <Button onClick={runScan} className="mt-6 gap-2">
            <Play className="h-4 w-4" />
            Start First Scan
          </Button>
        </div>
      )}

      {/* Loading */}
      {isScreening && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 mb-4">
              <Radar className="h-6 w-6 text-primary animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">Scanning {selectedSymbols.length} stocks across 6 confluence factors...</p>
            <p className="text-xs text-muted-foreground mt-1">Computing SMA 200, EMA 20, RSI, ATR, ADX, Relative Strength</p>
          </div>
        </div>
      )}

      {/* Results */}
      {screeningResults.length > 0 && (
        <ScrollArea className="max-h-[calc(100vh-340px)]">
          <div className="space-y-3 pr-4">
            {screeningResults.map((r) => (
              <ResultCard key={r.symbol} result={r} onAddTrade={onAddPaperTrade} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}