'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTradeStore } from '@/store/trade-store';
import { TOP_7_RANKED_SYMBOLS, DEFAULT_WATCHLIST, type BacktestResult } from '@/lib/trading/screening-engine';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BarChart3, Play, Layers, Activity, TrendingUp, AlertTriangle, Target, RefreshCw, Zap, CheckCircle2, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell, ReferenceLine
} from 'recharts';

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg bg-secondary/50 p-3 border border-border">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-bold font-mono mt-0.5', color ? `text-${color}-400` : '')}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function TabButton({ id, label, icon: Icon, active, onClick }: any) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-secondary/40 text-muted-foreground hover:bg-secondary/80'
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

const OPTIONS_SYMBOLS = [
  { symbol: 'NIFTY50', name: 'Nifty 50 Index Options (CE/PE)' },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty Index Options (CE/PE)' },
  { symbol: 'FINNIFTY', name: 'Finnifty Index Options (CE/PE)' },
  { symbol: 'RELIANCE', name: 'Reliance Stock Options (CE/PE)' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Stock Options (CE/PE)' },
  { symbol: 'INFY', name: 'Infosys Stock Options (CE/PE)' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Stock Options (CE/PE)' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Stock Options (CE/PE)' },
];

export function BacktestTab() {
  const { config } = useTradeStore();
  const [activeTab, setActiveTab] = useState<'single' | 'batch' | 'walkforward'>('single');

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Backtest & Walk-Forward Engine
          </h2>
          <p className="text-xs text-muted-foreground">
            5-Year Historical Performance Simulation for Intraday Options & Equity Swing Engines
          </p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-2">
        <TabButton id="single" label="Single Symbol Backtest" icon={BarChart3} active={activeTab === 'single'} onClick={() => setActiveTab('single')} />
        <TabButton id="batch" label="Batch 7 Stocks Portfolio" icon={Layers} active={activeTab === 'batch'} onClick={() => setActiveTab('batch')} />
        <TabButton id="walkforward" label="Walk-Forward Rolling Windows" icon={Activity} active={activeTab === 'walkforward'} onClick={() => setActiveTab('walkforward')} />
      </div>

      {activeTab === 'single' && <SingleBacktest config={config} />}
      {activeTab === 'batch' && <BatchBacktest config={config} />}
      {activeTab === 'walkforward' && <WalkForwardBacktest config={config} />}
    </div>
  );
}

// Full F&O & Equity Stock Universe for Selectable Scrip Dropdown
const ALL_SELECTABLE_SCRIPS = [
  // Indices
  { symbol: 'NIFTY50', name: 'Nifty 50 Index Options / Swing' },
  { symbol: 'BANKNIFTY', name: 'Bank Nifty Index Options / Swing' },
  { symbol: 'FINNIFTY', name: 'Fin Nifty Index Options / Swing' },
  { symbol: 'MIDCPNIFTY', name: 'Midcap Nifty Index Options / Swing' },
  // High Beta F&O Leaders
  { symbol: 'TATAELXSI', name: 'Tata Elxsi Ltd.' },
  { symbol: 'DEEPAKNTR', name: 'Deepak Nitrite Ltd.' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd.' },
  { symbol: 'TATAPOWER', name: 'Tata Power Co. Ltd.' },
  { symbol: 'HINDCOPPER', name: 'Hindustan Copper Ltd.' },
  { symbol: 'VEDL', name: 'Vedanta Ltd.' },
  { symbol: 'SUZLON', name: 'Suzlon Energy Ltd.' },
  { symbol: 'HDFCAMC', name: 'HDFC Asset Management Ltd.' },
  { symbol: 'TRENT', name: 'Trent Ltd.' },
  { symbol: 'MAZDOCK', name: 'Mazagon Dock Shipbuilders Ltd.' },
  { symbol: 'COCHINSHIP', name: 'Cochin Shipyard Ltd.' },
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd.' },
  { symbol: 'SBIN', name: 'State Bank of India' },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd.' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd.' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd.' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd.' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd.' },
  { symbol: 'INFY', name: 'Infosys Ltd.' },
  { symbol: 'TCS', name: 'Tata Consultancy Services Ltd.' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd.' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd.' },
];

const TIMEFRAME_OPTIONS = [
  { id: '1M', label: '1 Month', days: 30 },
  { id: '3M', label: '1 Quarter (3M)', days: 90 },
  { id: '6M', label: 'Half Yearly (6M)', days: 180 },
  { id: '1Y', label: '1 Year', days: 365 },
  { id: '2Y', label: '2 Years', days: 730 },
  { id: '3Y', label: '3 Years', days: 1095 },
  { id: '5Y', label: '5 Years', days: 1825 },
  { id: 'CUSTOM', label: 'Custom Date Range', days: 0 },
];

function SingleBacktest({ config }: { config: any }) {
  const [backtestEngine, setBacktestEngine] = useState<'OPTIONS' | 'SWING'>('SWING');
  const [symbol, setSymbol] = useState('TATAELXSI');
  const [timeframe, setTimeframe] = useState<string>('5Y');
  const [customStart, setCustomStart] = useState<string>('2024-01-01');
  const [customEnd, setCustomEnd] = useState<string>('2026-07-23');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [sortAsc, setSortAsc] = useState(false);

  const handleEngineToggle = (mode: 'OPTIONS' | 'SWING') => {
    setBacktestEngine(mode);
    if (mode === 'OPTIONS') {
      setSymbol('NIFTY50');
    } else {
      setSymbol('TATAELXSI');
    }
  };

  const runBacktest = async () => {
    setRunning(true);
    try {
      const selectedTf = TIMEFRAME_OPTIONS.find(t => t.id === timeframe);
      const days = selectedTf ? selectedTf.days : 1825;

      const bodyData: any = { symbol, config, days, engine: backtestEngine };
      if (timeframe === 'CUSTOM' && customStart && customEnd) {
        bodyData.startDate = customStart;
        bodyData.endDate = customEnd;
        bodyData.days = 1825;
      }

      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData),
      });
      const data = await res.json();
      if (data.success) {
        setResult({ stats: data.stats, trades: data.trades, equityCurve: data.equityCurve, monthlyPnl: data.monthlyPnl || [] });
        toast.success(`Backtest complete [${backtestEngine} Mode — ${timeframe}]`, {
          description: `${data.stats.totalTrades} trades | Win Rate: ${data.stats.winRate}% | PF: ${data.stats.profitFactor}x`,
        });
      } else {
        toast.error('Backtest failed', { description: data.error });
      }
    } catch (err) {
      toast.error('Backtest request failed');
    } finally {
      setRunning(false);
    }
  };

  const { stats, trades, equityCurve, monthlyPnl } = result || { stats: null, trades: [], equityCurve: [], monthlyPnl: [] };

  return (
    <>
      <Card className="border-border"><CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">1. Select Engine</div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={backtestEngine === 'SWING' ? 'default' : 'outline'}
                onClick={() => handleEngineToggle('SWING')}
                className="h-9 text-xs gap-1.5"
              >
                <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                Equity Swing (399 Universe)
              </Button>
              <Button
                size="sm"
                variant={backtestEngine === 'OPTIONS' ? 'default' : 'outline'}
                onClick={() => handleEngineToggle('OPTIONS')}
                className="h-9 text-xs gap-1.5"
              >
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                Intraday Options (Index & Stock F&O)
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">2. Select Scrip (Searchable Dropdown)</div>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-72 h-9 text-xs font-mono font-medium"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {ALL_SELECTABLE_SCRIPS.map((o) => (
                  <SelectItem key={o.symbol} value={o.symbol}>
                    <span className="font-bold">{o.symbol}</span> — <span className="text-muted-foreground text-[11px]">{o.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button onClick={runBacktest} disabled={running} className="gap-2 h-9">
            <Play className={cn('h-4 w-4', running && 'animate-spin')} />
            {running ? 'Simulating Historical Data...' : 'Run Backtest'}
          </Button>
        </div>

        {/* Timeframe Presets Bar */}
        <div className="space-y-1.5 pt-2 border-t border-border/50">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">3. Select Backtest Range / Period</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {TIMEFRAME_OPTIONS.map((tf) => (
              <Button
                key={tf.id}
                size="sm"
                variant={timeframe === tf.id ? 'default' : 'secondary'}
                onClick={() => setTimeframe(tf.id)}
                className="h-7 text-[11px] px-2.5 font-medium"
              >
                {tf.label}
              </Button>
            ))}

            {timeframe === 'CUSTOM' && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-7 px-2 text-xs rounded border border-border bg-background font-mono"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-7 px-2 text-xs rounded border border-border bg-background font-mono"
                />
              </div>
            )}
          </div>
        </div>
      </CardContent></Card>

      {result && stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <StatCard label="Total Trades" value={String(stats.totalTrades)} />
            <StatCard label="Win Rate" value={`${stats.winRate}%`} color="emerald" />
            <StatCard label="Profit Factor" value={`${stats.profitFactor}x`} color={stats.profitFactor >= 1.2 ? 'emerald' : 'amber'} />
            <StatCard label="Max Drawdown" value={`${stats.maxDrawdown}%`} color="red" />
            <StatCard label="Sharpe Ratio" value={String(stats.sharpeRatio)} color="emerald" />
            <StatCard label="Final Take-Home Capital" value={`₹${Math.round(stats.finalCapital).toLocaleString('en-IN')}`} color={stats.finalCapital >= config.liveCapital ? 'emerald' : 'red'} />
          </div>

          <Card className="border-border"><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-4">5-Year Equity Growth Curve</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equityCurve}>
                  <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={equityCurve[equityCurve.length - 1]?.equity >= config.liveCapital ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                    <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v: string) => v?.slice(5) || ''} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                    labelStyle={{ color: '#a1a1aa' }} formatter={(value: number) => [`₹${Math.round(value).toLocaleString('en-IN')}`, 'Capital']} />
                  <ReferenceLine y={config.liveCapital} stroke="rgba(255,255,255,0.2)" strokeDasharray="5 5" />
                  <Area type="monotone" dataKey="equity" stroke={equityCurve[equityCurve.length - 1]?.equity >= config.liveCapital ? '#10b981' : '#ef4444'} fill="url(#eqGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent></Card>

          {/* ── MONTHLY RETURNS HEATMAP MATRIX FOR RETAIL USERS ──── */}
          {/* Uses the real per-month P&L already computed by screening-engine.ts
              (grouped by each trade's actual exit month) — this used to render
              12 hardcoded fake Jan-Dec percentages plus a fake "88.5%" badge
              regardless of what the backtest actually returned. */}
          <Card className="border-border"><CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-emerald-400" /> Historical Monthly Strategy Returns Heatmap (%)
              </h3>
              {monthlyPnl.length > 0 && (
                <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-mono">
                  Consistency Score: {Math.round((monthlyPnl.filter((m: any) => m.netPnl > 0).length / monthlyPnl.length) * 1000) / 10}% Green Months
                </Badge>
              )}
            </div>

            {monthlyPnl.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">No monthly breakdown yet — run a backtest first.</div>
            ) : (
              <div className="grid grid-cols-6 md:grid-cols-12 gap-1.5 text-center text-xs font-mono">
                {monthlyPnl.map((m: any) => {
                  const retPct = config.liveCapital > 0 ? (m.netPnl / config.liveCapital) * 100 : 0;
                  const isPos = retPct >= 0;
                  return (
                    <div
                      key={m.month}
                      className={cn(
                        "p-2 rounded-lg border text-center font-bold",
                        isPos ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-red-500/15 border-red-500/30 text-red-400"
                      )}
                    >
                      <div className="text-[10px] text-muted-foreground font-sans">{m.month}</div>
                      <div className="text-xs mt-0.5">{isPos ? '+' : ''}{retPct.toFixed(1)}%</div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent></Card>

          {/* ── EXPANDED DETAILED TRADE LOG TABLE ───────────────── */}
          {trades.length > 0 && (
            <Card className="border-border"><CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Executed Trades Log ({trades.length} trades sampled)</h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSortAsc(!sortAsc)}
                  className="h-7 text-xs gap-1 font-mono"
                >
                  <RefreshCw className="h-3 w-3" /> Sort Date: {sortAsc ? 'Oldest → Newest' : 'Newest → Oldest'}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[800px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="py-2 px-2">#</th>
                      <th className="py-2 px-2">Contract / Symbol</th>
                      <th className="py-2 px-2">Entry Timestamp</th>
                      <th className="py-2 px-2">Exit Timestamp</th>
                      <th className="py-2 px-2 text-right">Lots & Qty</th>
                      <th className="py-2 px-2 text-right">Entry Price</th>
                      <th className="py-2 px-2 text-right font-semibold text-foreground">Single-Leg Entry Capital</th>
                      <th className="py-2 px-2 text-right">Net PnL (₹)</th>
                      <th className="py-2 px-2 text-right">Exit Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sortAsc ? [...trades].reverse() : trades).map((t, i) => (
                      <tr key={`trd_${i}`} className="border-b border-border/40 hover:bg-secondary/30">
                        <td className="py-2 px-2 text-muted-foreground font-mono">#{i + 1}</td>
                        <td className="py-2 px-2 font-mono font-bold">{t.symbol}</td>
                        <td className="py-2 px-2 text-muted-foreground font-mono">{t.entryDate}</td>
                        <td className="py-2 px-2 text-muted-foreground font-mono">{t.exitDate}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          {t.lots ? `${t.lots} Lots (${t.qty})` : `${t.qty} Shares`}
                        </td>
                        <td className="py-2 px-2 text-right font-mono">₹{t.entryPrice}</td>
                        <td className="py-2 px-2 text-right font-mono font-semibold text-emerald-400">
                          ₹{(t.totalValue || Math.round(t.qty * t.entryPrice)).toLocaleString('en-IN')}
                        </td>
                        <td className={cn('py-2 px-2 text-right font-mono font-bold', t.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {t.pnl >= 0 ? '+' : ''}₹{t.pnl.toLocaleString('en-IN')} ({t.pnlPercent}%)
                        </td>
                        <td className="py-2 px-2 text-right">
                          <Badge variant="outline" className="text-[9px] px-1 py-0">{t.exitReason}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent></Card>
          )}
        </>
      )}

      {!result && !running && (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Select Symbol and click "Run Backtest" to simulate 5-year historical returns.</p>
        </div>
      )}
    </>
  );
}

// ── Detailed Batch Backtest (Top 7 Stocks) ─────────────────────────
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
        body: JSON.stringify({ config, days: 365 }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
        toast.success(`Batch Backtest Complete: ${data.meta.successful} stocks`, {
          description: `Avg Win Rate: ${data.aggregated.avgWinRate}% | Avg PF: ${data.aggregated.avgProfitFactor}x`,
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
      <Card className="border-border"><CardContent className="p-4 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h3 className="text-sm font-semibold">Top 7 Dynamic Rank-Weighted Portfolio Batch Backtest</h3>
          <p className="text-xs text-muted-foreground">Simulates all 7 watchlist stocks simultaneously across historical candles.</p>
        </div>
        <Button onClick={runBatch} disabled={running} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
          <Layers className={cn('h-4 w-4', running && 'animate-spin')} />
          {running ? 'Running Batch...' : 'Run Top 7 Portfolio Backtest'}
        </Button>
      </CardContent></Card>

      {result && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="Portfolio Tested" value={`${result.meta?.successful ?? 0}/7 Leaders`} color="emerald" />
            <StatCard label="Portfolio Win Rate" value={`${result.aggregated?.avgWinRate ?? 0}%`} color="emerald" />
            <StatCard label="Portfolio Profit Factor" value={`${result.aggregated?.avgProfitFactor ?? 0}x`} color="emerald" />
            <StatCard label="5-Yr Portfolio Final Capital" value={`₹${Math.round(result.aggregated?.portfolioFinalCapital ?? 0).toLocaleString('en-IN')}`} color="emerald" />
          </div>

          <Card className="border-border"><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Target className="h-4 w-4 text-emerald-400" /> Stock-by-Stock Detailed Backtest Breakdown
            </h3>
            <ScrollArea className="max-h-80">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 text-left">Rank</th>
                    <th className="py-2 text-left">Symbol</th>
                    <th className="py-2 text-right">Target Weight</th>
                    <th className="py-2 text-right">Total Trades</th>
                    <th className="py-2 text-right">Win Rate</th>
                    <th className="py-2 text-right">Profit Factor</th>
                    <th className="py-2 text-right">Max DD</th>
                    <th className="py-2 text-right">Final Capital</th>
                  </tr>
                </thead>
                <tbody>
                  {(result.ranked || []).map((item: any) => (
                    <tr key={item.symbol} className="border-b border-border/50 hover:bg-secondary/30">
                      <td className="py-2 font-bold text-amber-400">#{item.rank}</td>
                      <td className="py-2 font-mono font-bold">{item.symbol}</td>
                      <td className="py-2 text-right font-mono text-emerald-400">{item.weightPct}%</td>
                      <td className="py-2 text-right font-mono">{item.totalTrades}</td>
                      <td className="py-2 text-right text-emerald-400 font-mono">{item.winRate}%</td>
                      <td className="py-2 text-right text-emerald-400 font-mono">{item.profitFactor}x</td>
                      <td className="py-2 text-right text-red-400 font-mono">{item.maxDrawdown}%</td>
                      <td className="py-2 text-right font-mono font-bold">₹{Math.round(item.finalCapital).toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </CardContent></Card>
        </>
      )}
    </>
  );
}

// ── Walk-Forward Analysis ────────────────────────────────
function WalkForwardBacktest({ config }: { config: any }) {
  const [symbol, setSymbol] = useState('TATAELXSI');
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
        toast.success(`Walk-Forward Analysis Complete`, {
          description: `Consistency Score: ${data.summary.consistencyScore}%`,
        });
      } else {
        toast.error(data.error || 'Walk-forward failed');
      }
    } catch (err) {
      toast.error('Walk-forward request failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card className="border-border bg-indigo-500/5"><CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">What is Walk-Forward Rolling Analysis?</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Walk-Forward Analysis evaluates strategy robustness by testing across <strong>120-day rolling windows</strong> stepped forward by <strong>60 days</strong> across 500 days. It proves that the strategy stays profitable across shifting bull, bear, and choppy market regimes over time without overfitting.
        </p>
      </CardContent></Card>

      <Card className="border-border"><CardContent className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Symbol</div>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger className="w-56 h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-60">
                {TOP_7_RANKED_SYMBOLS.map((s) => (
                  <SelectItem key={s.symbol} value={s.symbol}>#{s.rank} {s.symbol}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runWalkForward} disabled={running} className="gap-2">
            <Activity className={cn('h-4 w-4', running && 'animate-spin')} />
            {running ? 'Simulating Rolling Windows...' : 'Run Walk-Forward Analysis'}
          </Button>
        </div>
      </CardContent></Card>

      {result && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Consistency Score" value={`${result.summary.consistencyScore}%`} color="emerald" />
          <StatCard label="Avg Win Rate" value={`${result.summary.avgWinRate}%`} color="emerald" />
          <StatCard label="Avg Profit Factor" value={`${result.summary.avgProfitFactor}x`} color="emerald" />
          <StatCard label="Strategy Pass" value={result.summary.pass ? 'PASS' : 'FAIL'} color={result.summary.pass ? 'emerald' : 'red'} />
        </div>
      )}
    </>
  );
}