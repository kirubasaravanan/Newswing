'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTradeStore } from '@/store/trade-store';
import { DEFAULT_WATCHLIST, type BacktestResult } from '@/lib/trading/screening-engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { BarChart3, Play, TrendingUp, TrendingDown, Trophy, AlertTriangle, Zap, Layers, Activity, Target } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
  BarChart, Bar, Cell, CartesianGrid, ReferenceLine,
} from 'recharts';

type TabId = 'single' | 'batch' | 'walkforward';

function TabButton({ id, label, icon: Icon, active, onClick }: { id: TabId; label: string; icon: any; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all',
        active ? 'bg-primary text-primary-foreground shadow-lg' : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

export function BacktestTab() {
  const { config } = useTradeStore();
  const [activeTab, setActiveTab] = useState<TabId>('single');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Strategy Backtester
        </h2>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2">
        <TabButton id="single" label="Single Stock" icon={BarChart3} active={activeTab === 'single'} onClick={() => setActiveTab('single')} />
        <TabButton id="batch" label="Batch (30 Stocks)" icon={Layers} active={activeTab === 'batch'} onClick={() => setActiveTab('batch')} />
        <TabButton id="walkforward" label="Walk-Forward" icon={Activity} active={activeTab === 'walkforward'} onClick={() => setActiveTab('walkforward')} />
      </div>

      {activeTab === 'single' && <SingleBacktest config={config} />}
      {activeTab === 'batch' && <BatchBacktest config={config} />}
      {activeTab === 'walkforward' && <WalkForwardBacktest config={config} />}
    </div>
  );
}

// ── Single Stock Backtest (original) ─────────────────────
function SingleBacktest({ config }: { config: any }) {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);

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
        toast.success(`Backtest complete: ${data.stats.totalTrades} trades`, {
          description: `Win Rate: ${data.stats.winRate}% | PF: ${data.stats.profitFactor}x`,
        });
      }
    } catch (err) {
      toast.error('Backtest failed');
    } finally {
      setRunning(false);
    }
  };

  const { stats, trades, equityCurve } = result || { stats: null, trades: [], equityCurve: [] };

  return (
    <>
      <Card className="border-border"><CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</div>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-48 h-9 text-sm"><SelectValue /></SelectTrigger>
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
      </CardContent></Card>

      {result && stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <StatCard label="Total Trades" value={String(stats.totalTrades)} />
            <StatCard label="Win Rate" value={`${stats.winRate}%`} color="emerald" />
            <StatCard label="Profit Factor" value={`${stats.profitFactor}x`} color={stats.profitFactor >= 1.5 ? 'emerald' : stats.profitFactor >= 1 ? 'amber' : 'red'} />
            <StatCard label="Max Drawdown" value={`${stats.maxDrawdown}%`} color="red" />
            <StatCard label="Sharpe Ratio" value={String(stats.sharpeRatio)} />
            <StatCard label="Final Capital" value={`₹${Math.round(stats.finalCapital).toLocaleString()}`} color={stats.finalCapital >= config.liveCapital ? 'emerald' : 'red'} />
          </div>
          <Card className="border-border"><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-4">Equity Curve</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve}>
                  <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={equityCurve[equityCurve.length - 1]?.equity >= config.liveCapital ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                    <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }} formatter={(value: number) => [`₹${Math.round(value).toLocaleString()}`, 'Equity']} />
                  <ReferenceLine y={config.liveCapital} stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" />
                  <Area type="monotone" dataKey="equity" stroke={equityCurve[equityCurve.length - 1]?.equity >= config.liveCapital ? '#10b981' : '#ef4444'} fill="url(#eqGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent></Card>
          {trades.length > 0 && (
            <Card className="border-border"><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4">Trade P&L Distribution</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trades.map((t, i) => ({ idx: i + 1, pnl: t.pnl }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number) => [`₹${Math.round(value).toLocaleString()}`, 'P&L']} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                    <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                      {trades.map((t, i) => <Cell key={i} fill={t.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>
          )}
          <Card className="border-border"><CardContent className="p-4">
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
          </CardContent></Card>
        </>
      )}
      {!result && !running && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select a stock and run backtest to validate the V-Swing strategy.</p>
        </div>
      )}
    </>
  );
}

// ── Batch Backtest ───────────────────────────────────────
function BatchBacktest({ config }: { config: any }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runBatch = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/backtest/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, days: 180, maxStocks: 30 }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        toast.success(`Batch complete: ${data.meta.successful}/${data.meta.tested} profitable`, {
          description: `Consistency: ${data.aggregated.consistencyScore}% | Avg Sharpe: ${data.aggregated.avgSharpe}`,
        });
      } else {
        toast.error(data.error || 'Batch backtest failed');
      }
    } catch (err) {
      toast.error('Batch backtest failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card className="border-border"><CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Backtest top 30 F&O stocks in parallel. Validates strategy robustness across the universe.</p>
          </div>
          <Button onClick={runBatch} disabled={running} className="gap-2">
            <Layers className={cn('h-4 w-4', running && 'animate-spin')} />
            {running ? `Scanning...` : 'Run Batch (30 Stocks)'}
          </Button>
        </div>
      </CardContent></Card>

      {result && (
        <>
          {/* Meta */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <StatCard label="Universe Size" value={String(result.meta.totalUniverse)} />
            <StatCard label="Stocks Tested" value={String(result.meta.successful)} />
            <StatCard label="Failed" value={String(result.meta.failed)} color="red" />
            <StatCard label="Consistency" value={`${result.aggregated.consistencyScore}%`} color={result.aggregated.consistencyScore >= 70 ? 'emerald' : 'amber'} />
            <StatCard label="Avg Win Rate" value={`${result.aggregated.avgWinRate}%`} color={result.aggregated.avgWinRate >= 50 ? 'emerald' : 'red'} />
            <StatCard label="Avg Sharpe" value={String(result.aggregated.avgSharpe)} color={result.aggregated.avgSharpe >= 1 ? 'emerald' : 'amber'} />
          </div>

          {/* Aggregated Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Avg Profit Factor" value={`${result.aggregated.avgProfitFactor}x`} color={result.aggregated.avgProfitFactor >= 1.5 ? 'emerald' : 'amber'} />
            <StatCard label="Avg CAGR" value={`${result.aggregated.avgCAGR}%`} color={result.aggregated.avgCAGR > 0 ? 'emerald' : 'red'} />
            <StatCard label="Avg Max DD" value={`${result.aggregated.avgMaxDrawdown}%`} color="red" />
            <StatCard label="Profitable Count" value={`${result.aggregated.profitableCount}/${result.meta.successful}`} color={result.aggregated.profitableCount > result.meta.successful / 2 ? 'emerald' : 'red'} />
          </div>

          {/* Ranked Table */}
          <Card className="border-border"><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Target className="h-4 w-4" /> Ranked by Sharpe Ratio (top performers)
            </h3>
            <ScrollArea className="max-h-80">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-left">#</th>
                    <th className="py-2 text-left">Symbol</th>
                    <th className="py-2 text-right">Trades</th>
                    <th className="py-2 text-right">Win Rate</th>
                    <th className="py-2 text-right">Profit Factor</th>
                    <th className="py-2 text-right">Sharpe</th>
                    <th className="py-2 text-right">Max DD</th>
                    <th className="py-2 text-right">CAGR</th>
                    <th className="py-2 text-right">Final Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {result.ranked.slice(0, 20).map((s: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-2 text-muted-foreground">{i + 1}</td>
                      <td className="py-2 font-mono font-semibold">{s.symbol}</td>
                      <td className="py-2 text-right">{s.totalTrades}</td>
                      <td className={cn('py-2 text-right', s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400')}>{s.winRate}%</td>
                      <td className={cn('py-2 text-right', s.profitFactor >= 1.5 ? 'text-emerald-400' : s.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400')}>{s.profitFactor}x</td>
                      <td className="py-2 text-right">{s.sharpeRatio}</td>
                      <td className="py-2 text-right text-red-400">{s.maxDrawdown}%</td>
                      <td className={cn('py-2 text-right', s.cagr > 0 ? 'text-emerald-400' : 'text-red-400')}>{s.cagr}%</td>
                      <td className="py-2 text-right font-mono">₹{Math.round(s.finalCapital).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent></Card>

          {/* Sharpe Distribution Chart */}
          {result.ranked.length > 0 && (
            <Card className="border-border"><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4">Sharpe Ratio Distribution</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.ranked.map((s: any, i: number) => ({ name: s.symbol, sharpe: s.sharpe }))} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#71717a' }} width={80} />
                    <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                    <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
                    <Bar dataKey="sharpe" name="Sharpe" radius={[0, 3, 3, 0]}>
                      {result.ranked.map((s: any, i: number) => (
                        <Cell key={i} fill={s.sharpe >= 1 ? '#10b981' : s.sharpe >= 0 ? '#f59e0b' : '#ef4444'} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>
          )}
        </>
      )}

      {!result && !running && (
        <div className="text-center py-16 text-muted-foreground">
          <Layers className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Run batch backtest to validate strategy across 30 F&O stocks simultaneously.</p>
        </div>
      )}
    </>
  );
}

// ── Walk-Forward Analysis ────────────────────────────────
function WalkForwardBacktest({ config }: { config: any }) {
  const [symbol, setSymbol] = useState('RELIANCE');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runWalkForward = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/backtest/walkforward', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol, config, totalDays: 500, windowDays: 120, stepDays: 60 }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        toast.success(`Walk-forward complete: ${data.meta.totalWindows} windows`, {
          description: `Consistency: ${data.summary.consistencyScore}% | Pass: ${data.summary.pass ? 'YES' : 'NO'}`,
        });
      } else {
        toast.error(data.error || 'Walk-forward failed');
      }
    } catch (err) {
      toast.error('Walk-forward failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card className="border-border"><CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</div>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-48 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {DEFAULT_WATCHLIST.map(s => (
                  <SelectItem key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            Rolling 120-day windows with 60-day step across 500 days
          </div>
          <Button onClick={runWalkForward} disabled={running} className="gap-2">
            <Activity className={cn('h-4 w-4', running && 'animate-spin')} />
            {running ? 'Analyzing...' : 'Run Walk-Forward'}
          </Button>
        </div>
      </CardContent></Card>

      {result && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <StatCard label="Windows" value={String(result.meta.totalWindows)} />
            <StatCard label="Consistency" value={`${result.summary.consistencyScore}%`} color={result.summary.consistencyScore >= 60 ? 'emerald' : 'red'} />
            <StatCard label="Avg Win Rate" value={`${result.summary.avgWinRate}%`} color={result.summary.avgWinRate >= 50 ? 'emerald' : 'red'} />
            <StatCard label="Avg Sharpe" value={String(result.summary.avgSharpe)} color={result.summary.avgSharpe >= 0.5 ? 'emerald' : 'red'} />
            <StatCard label="Avg Profit Factor" value={`${result.summary.avgProfitFactor}x`} color={result.summary.avgProfitFactor >= 1.2 ? 'emerald' : 'amber'} />
            <StatCard label="Strategy Pass" value={result.summary.pass ? 'PASS' : 'FAIL'} color={result.summary.pass ? 'emerald' : 'red'} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="WR Std Dev" value={`${result.summary.stdWinRate}%`} />
            <StatCard label="Sharpe Std Dev" value={String(result.summary.stdSharpe)} />
            <StatCard label="Avg CAGR" value={`${result.summary.avgCAGR}%`} color={result.summary.avgCAGR > 0 ? 'emerald' : 'red'} />
            <StatCard label="Profitable Windows" value={`${result.summary.profitableWindows}/${result.meta.totalWindows}`} color={result.summary.profitableWindows > result.meta.totalWindows / 2 ? 'emerald' : 'red'} />
          </div>

          {/* Window-by-Window Table */}
          <Card className="border-border"><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Rolling Window Results</h3>
            <ScrollArea className="max-h-72">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-left">#</th>
                    <th className="py-2 text-left">Period</th>
                    <th className="py-2 text-right">Trades</th>
                    <th className="py-2 text-right">Win Rate</th>
                    <th className="py-2 text-right">Sharpe</th>
                    <th className="py-2 text-right">PF</th>
                    <th className="py-2 text-right">Max DD</th>
                    <th className="py-2 text-right">CAGR</th>
                    <th className="py-2 text-right">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {result.windows.map((w: any, i: number) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-2 text-muted-foreground">{w.windowIndex}</td>
                      <td className="py-2 font-mono text-xs">{w.startDate?.slice(5)} → {w.endDate?.slice(5)}</td>
                      <td className="py-2 text-right">{w.totalTrades}</td>
                      <td className={cn('py-2 text-right', w.winRate >= 50 ? 'text-emerald-400' : 'text-red-400')}>{w.winRate}%</td>
                      <td className={cn('py-2 text-right', w.sharpeRatio >= 0.5 ? 'text-emerald-400' : 'text-red-400')}>{w.sharpeRatio}</td>
                      <td className={cn('py-2 text-right', w.profitFactor >= 1.2 ? 'text-emerald-400' : 'text-amber-400')}>{w.profitFactor}x</td>
                      <td className="py-2 text-right text-red-400">{w.maxDrawdown}%</td>
                      <td className={cn('py-2 text-right', w.cagr > 0 ? 'text-emerald-400' : 'text-red-400')}>{w.cagr}%</td>
                      <td className="py-2 text-right font-mono">₹{Math.round(w.finalCapital).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent></Card>

          {/* Rolling Sharpe Chart */}
          {result.windows.length > 1 && (
            <Card className="border-border"><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4">Rolling Window Sharpe Ratio</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={result.windows.map((w: any) => ({ window: `W${w.windowIndex}`, sharpe: w.sharpeRatio, wr: w.winRate }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="window" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                    <ReferenceLine y={0.5} stroke="#10b981" strokeDasharray="5 5" label={{ value: 'Min threshold', position: 'right', fill: '#10b981', fontSize: 10 }} />
                    <Bar dataKey="sharpe" name="Sharpe" radius={[3, 3, 0, 0]}>
                      {result.windows.map((w: any, i: number) => (
                        <Cell key={i} fill={w.sharpeRatio >= 0.5 ? '#10b981' : '#ef4444'} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>
          )}
        </>
      )}

      {!result && !running && (
        <div className="text-center py-16 text-muted-foreground">
          <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Run walk-forward analysis to validate strategy stability over rolling time windows.</p>
        </div>
      )}
    </>
  );
}

// ── Shared StatCard ──────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: string; color?: 'emerald' | 'red' | 'amber' }) {
  const colorClass = color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : color === 'amber' ? 'text-amber-400' : '';
  return (
    <Card><CardContent className="p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-2xl font-bold mt-1', colorClass)}>{value}</div>
    </CardContent></Card>
  );
}