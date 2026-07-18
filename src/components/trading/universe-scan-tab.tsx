'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Play, Filter, TrendingUp, AlertTriangle, Database, Wifi, WifiOff, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTradeStore } from '@/store/trade-store';

interface ScanSummary {
  totalScanned: number;
  l1Passed: number;
  l1Failed: number;
  l2Signals: number;
  dataSource: string;
  duration: string;
}

interface L1Result {
  symbol: string;
  name: string;
  sector: string;
  category: string;
  passed: boolean;
  closePrice: number;
  sma50: number;
  ema20: number;
  rsi14: number;
  adx: number;
  dailyVolume: number;
  volumeMA20: number;
  failReason?: string;
}

export function UniverseScanTab() {
  const { config } = useTradeStore();
  const [mode, setMode] = useState<'l1' | 'full' | 'watchlist'>('l1');
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [l1Results, setL1Results] = useState<L1Result[]>([]);
  const [l2Signals, setL2Signals] = useState<any[]>([]);
  const [l1Failed, setL1Failed] = useState<L1Result[]>([]);
  const [showFailed, setShowFailed] = useState(false);
  const [expandedSignal, setExpandedSignal] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setScanning(true);
    setProgress('Initializing universe scan...');
    setL1Results([]);
    setL2Signals([]);
    setL1Failed([]);
    setSummary(null);

    try {
      const res = await fetch('/api/universe-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, config, days: 300 }),
      });

      const data = await res.json();

      if (data.success) {
        setSummary(data.summary);
        setL1Results(data.l1Results || []);
        setL2Signals(data.l2Signals || []);
        setL1Failed(data.l1Failed || []);

        const srcLabel = data.summary.dataSource === 'yahoo' ? 'Yahoo Finance (Real)' : 'Mock Data';
        toast.success(`Universe Scan Complete`, {
          description: `${data.summary.totalScanned} stocks → ${data.summary.l1Passed} L1 passed → ${data.summary.l2Signals} V-Swing signals | ${data.summary.duration} | Source: ${srcLabel}`,
        });
      } else {
        toast.error('Scan failed', { description: data.error });
      }
    } catch (err) {
      toast.error('Scan failed', { description: 'Check console for details' });
      console.error(err);
    } finally {
      setScanning(false);
      setProgress('');
    }
  }, [mode, config]);

  // Aggregate failure reasons
  const failReasons = l1Failed.reduce((acc: Record<string, number>, r) => {
    const reason = r.failReason || 'Unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Universe Scanner
          </h2>
          <Badge variant="outline" className="text-[10px]">
            {mode === 'l1' ? 'L1 Quick' : mode === 'full' ? 'L1 + L2 Full' : 'Watchlist Only'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select value={mode} onValueChange={(v) => setMode(v as any)}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="l1">L1 Quick Filter</SelectItem>
              <SelectItem value="full">Full (L1 + L2)</SelectItem>
              <SelectItem value="watchlist">Watchlist Only</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={runScan} disabled={scanning} className="gap-2">
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {scanning ? 'Scanning...' : `Scan ${mode === 'watchlist' ? 'Watchlist' : 'Universe'}`}
          </Button>
        </div>
      </div>

      {/* How it works */}
      {!summary && !scanning && (
        <Card className="border-border">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Filter className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-3">
                <h3 className="font-semibold">Two-Stage Screening Pipeline</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-secondary/50 p-3">
                    <div className="font-medium text-emerald-400 mb-1">Stage 1: L1 Pre-Filter (Fast)</div>
                    <p className="text-xs text-muted-foreground">Scans entire NSE universe with 6 lightweight checks: Price &gt; ₹50, Volume &gt; 100K, Close &gt; SMA 50, RSI 40-75, Close &gt; EMA 20, ADX &gt; 18 or rising. Narrows 150+ stocks to ~30-80 candidates.</p>
                  </div>
                  <div className="rounded-lg bg-secondary/50 p-3">
                    <div className="font-medium text-amber-400 mb-1">Stage 2: L2 V-Swing Engine (Deep)</div>
                    <p className="text-xs text-muted-foreground">Runs the full V-Swing v65.5 6-factor confluence scoring on L1 survivors. Computes SMA 200, ADX/DMI, ATR, Relative Strength vs Nifty, volume confirmation, gap analysis. Returns only A+/B setups with valid entries.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Database className="h-3 w-3" />
                  Data source: Yahoo Finance (real) with mock fallback
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Progress */}
      {scanning && (
        <Card className="border-primary/20">
          <CardContent className="p-6 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 mb-3">
              <Globe className="h-7 w-7 text-primary animate-pulse" />
            </div>
            <p className="text-sm font-medium">{progress}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Fetching real market data from Yahoo Finance...
            </p>
            <div className="mt-3 h-1.5 w-48 mx-auto rounded-full bg-secondary overflow-hidden">
              <div className="h-full bg-primary rounded-full animate-[loading_2s_ease-in-out_infinite]" style={{ width: '60%' }} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Scanned</div>
              <div className="text-2xl font-bold mt-1">{summary.totalScanned}</div>
            </CardContent>
          </Card>
          <Card className="border-emerald-500/20">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">L1 Passed</div>
              <div className="text-2xl font-bold mt-1 text-emerald-400">{summary.l1Passed}</div>
              <div className="text-[10px] text-muted-foreground">{summary.l1Failed} failed</div>
            </CardContent>
          </Card>
          <Card className="border-amber-500/20">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-amber-400">V-Swing Signals</div>
              <div className="text-2xl font-bold mt-1 text-amber-400">{summary.l2Signals}</div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Data Source</div>
              <div className="flex items-center gap-1.5 mt-1">
                {summary.dataSource === 'yahoo' ? <Wifi className="h-4 w-4 text-emerald-400" /> : <WifiOff className="h-4 w-4 text-amber-400" />}
                <span className="text-sm font-semibold">{summary.dataSource === 'yahoo' ? 'Real' : 'Mock'}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border">
            <CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</div>
              <div className="text-2xl font-bold mt-1">{summary.duration}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* L2 V-Swing Signals */}
      {l2Signals.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            V-Swing Signals ({l2Signals.length})
          </h3>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-2 pr-4">
              {l2Signals.map((s: any) => (
                <Card key={s.symbol} className={cn(
                  'border transition-all',
                  s.score === 6 ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'
                )}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold',
                          s.score === 6 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                        )}>
                          {s.score}/6
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{s.symbol}</span>
                            <Badge variant="outline" className="text-[10px] h-5">
                              {s.setupType}
                            </Badge>
                          </div>
                          <div className="text-[10px] text-muted-foreground flex gap-3">
                            <span>Entry: ₹{s.entryPrice}</span>
                            <span className="text-red-400">SL: ₹{s.stopLoss}</span>
                            <span className="text-emerald-400">TP: ₹{s.targetPrice}</span>
                            <span>R:R {s.riskReward}x</span>
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost" size="sm"
                        onClick={() => setExpandedSignal(expandedSignal === s.symbol ? null : s.symbol)}
                        className="h-7 w-7 p-0"
                      >
                        {expandedSignal === s.symbol ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>
                    {expandedSignal === s.symbol && (
                      <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-2 text-xs">
                        <div className="bg-secondary/50 rounded p-2"><span className="text-muted-foreground">RSI:</span> <span className="font-mono">{s.rsi}</span></div>
                        <div className="bg-secondary/50 rounded p-2"><span className="text-muted-foreground">ATR:</span> <span className="font-mono">{s.atr}</span></div>
                        <div className="bg-secondary/50 rounded p-2"><span className="text-muted-foreground">SMA200:</span> <span className="font-mono">₹{s.indicators?.sma200}</span></div>
                        <div className="bg-secondary/50 rounded p-2"><span className="text-muted-foreground">Qty(A+):</span> <span className="font-mono">{s.sizing?.qtyA}</span></div>
                        <div className="bg-secondary/50 rounded p-2"><span className="text-muted-foreground">Qty(B):</span> <span className="font-mono">{s.sizing?.qtyB}</span></div>
                        <div className="bg-secondary/50 rounded p-2"><span className="text-muted-foreground">Risk:</span> <span className="font-mono">₹{s.sizing?.riskAmtA?.toLocaleString()}</span></div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* L1 Pass List */}
      {l1Results.length > 0 && l2Signals.length === 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Filter className="h-4 w-4 text-emerald-400" />
            L1 Candidates ({l1Results.length})
          </h3>
          <ScrollArea className="max-h-[400px]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pr-4">
              {l1Results.map(r => (
                <Card key={r.symbol} className="border-border">
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-semibold text-sm">{r.symbol}</span>
                        <span className="text-[10px] text-muted-foreground ml-2">{r.sector}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1 text-[10px]">
                      <div><span className="text-muted-foreground">Price</span><div className="font-mono">₹{r.closePrice.toFixed(0)}</div></div>
                      <div><span className="text-muted-foreground">RSI</span><div className="font-mono">{r.rsi14.toFixed(1)}</div></div>
                      <div><span className="text-muted-foreground">ADX</span><div className="font-mono">{r.adx.toFixed(1)}</div></div>
                      <div><span className="text-muted-foreground">Vol</span><div className="font-mono">{(r.dailyVolume / 1000000).toFixed(1)}M</div></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
          <p className="text-xs text-muted-foreground text-center">
            These stocks passed L1 filter. Run &quot;Full (L1 + L2)&quot; mode to run V-Swing engine on these candidates.
          </p>
        </div>
      )}

      {/* L1 Failure Reasons */}
      {l1Failed.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowFailed(!showFailed)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <AlertTriangle className="h-3 w-3" />
            <span>{l1Failed.length} stocks failed L1 filter</span>
            {showFailed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showFailed && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(failReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                <Badge key={reason} variant="secondary" className="text-xs">
                  {reason}: {count}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}