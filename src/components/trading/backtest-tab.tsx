'use client';

import { useState, useCallback } from 'react';
import { useTradeStore } from '@/store/trade-store';
import { DEFAULT_WATCHLIST, type BacktestResult } from '@/lib/trading/screening-engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { BarChart3, Play, TrendingUp, TrendingDown, Trophy, AlertTriangle, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
  BarChart, Bar, Cell, CartesianGrid, ReferenceLine,
} from 'recharts';

export function BacktestTab() {
  const { config } = useTradeStore();
  const [symbol, setSymbol] = useState('RELIANCE');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [pastRuns, setPastRuns] = useState<any[]>([]);

  const fetchPastRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/backtest');
      const data = await res.json();
      if (data.success) setPastRuns(data.runs);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useState(() => { fetchPastRuns(); });

  const runBacktest = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, config, days: 300 }),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ trades: data.trades, equityCurve: data.equityCurve, stats: data.stats });
        fetchPastRuns();
        toast.success(`Backtest complete: ${data.stats.totalTrades} trades`, {
          description: `Win Rate: ${data.stats.winRate}% | PF: ${data.stats.profitFactor}x`,
        });
      }
    } catch (err) {
      toast.error('Backtest failed');
      console.error('Backtest error:', err);
    } finally {
      setRunning(false);
    }
  };

  const { stats, trades, equityCurve } = result || { stats: null, trades: [], equityCurve: [] };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Strategy Backtester
        </h2>
      </div>

      {/* Controls */}
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</div>
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="w-48 h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {DEFAULT_WATCHLIST.map(s => (
                    <SelectItem key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={runBacktest} disabled={running} className="gap-2">
              <Play className={cn('h-4 w-4', running && 'animate-spin')} />
              {running ? 'Running...' : 'Run Backtest'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result && stats && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total Trades</div>
              <div className="text-2xl font-bold mt-1">{stats.totalTrades}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400">Win Rate</div>
              <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.winRate}%</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Profit Factor</div>
              <div className={cn('text-2xl font-bold mt-1', stats.profitFactor >= 1.5 ? 'text-emerald-400' : stats.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400')}>
                {stats.profitFactor}x
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Max Drawdown</div>
              <div className="text-2xl font-bold mt-1 text-red-400">{stats.maxDrawdown}%</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sharpe Ratio</div>
              <div className="text-2xl font-bold mt-1">{stats.sharpeRatio}</div>
            </CardContent></Card>
            <Card className={stats.finalCapital >= config.liveCapital ? 'border-emerald-500/20' : 'border-red-500/20'}>
              <CardContent className="p-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Final Capital</div>
                <div className={cn('text-2xl font-bold mt-1', stats.finalCapital >= config.liveCapital ? 'text-emerald-400' : 'text-red-400')}>
                  ₹{Math.round(stats.finalCapital).toLocaleString()}
                </div>
              </CardContent></Card>
          </div>

          {/* Win/Loss / Avg */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-400 flex items-center gap-1"><Trophy className="h-3 w-3" /> Wins</div>
              <div className="text-xl font-bold mt-1 text-emerald-400">{stats.winTrades}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-red-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Losses</div>
              <div className="text-xl font-bold mt-1 text-red-400">{stats.lossTrades}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Win</div>
              <div className="text-xl font-bold mt-1 text-emerald-400">+₹{Math.round(stats.avgWin).toLocaleString()}</div>
            </CardContent></Card>
            <Card><CardContent className="p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Loss</div>
              <div className="text-xl font-bold mt-1 text-red-400">-₹{Math.round(stats.avgLoss).toLocaleString()}</div>
            </CardContent></Card>
          </div>

          {/* Equity Curve */}
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4">Equity Curve</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equityCurve}>
                    <defs>
                      <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={equityCurve[equityCurve.length - 1]?.equity >= config.liveCapital ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                        <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} domain={['auto', 'auto']} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: '#a1a1aa' }}
                      formatter={(value: number) => [`₹${Math.round(value).toLocaleString()}`, 'Equity']}
                    />
                    <ReferenceLine y={config.liveCapital} stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" />
                    <Area type="monotone" dataKey="equity" stroke={equityCurve[equityCurve.length - 1]?.equity >= config.liveCapital ? '#10b981' : '#ef4444'} fill="url(#eqGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* P&L Distribution */}
          {trades.length > 0 && (
            <Card className="border-border">
              <CardContent className="p-4">
                <h3 className="text-sm font-semibold mb-4">Trade P&L Distribution</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trades.map((t, i) => ({ idx: i + 1, pnl: t.pnl, type: t.exitReason }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#71717a' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                      <Tooltip
                        contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                        formatter={(value: number, name: string) => [`₹${Math.round(value).toLocaleString()}`, name]}
                      />
                      <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                      <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                        {trades.map((t, i) => (
                          <Cell key={i} fill={t.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Trade Log */}
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">Trade Log ({trades.length} trades)</h3>
              <ScrollArea className="max-h-64">
                <div className="space-y-2 pr-2">
                  {trades.map((t, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-secondary/30 px-3 py-2 text-xs">
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground w-6">#{i + 1}</span>
                        <span className="font-mono font-semibold">{t.symbol}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{t.setupType}</Badge>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{t.exitReason}</Badge>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">S:{t.score}</span>
                        <span className="font-mono">₹{t.entryPrice} → ₹{t.exitPrice}</span>
                        <span className={cn('font-mono font-bold', t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {t.pnl >= 0 ? '+' : ''}₹{Math.round(t.pnl).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </>
      )}

      {!result && !running && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a stock and run backtest to validate the V-Swing strategy.</p>
        </div>
      )}
    </div>
  );
}