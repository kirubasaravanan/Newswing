'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp, TrendingDown, Briefcase, Wallet, PieChart as PieIcon,
  RefreshCw, ArrowRight, Activity, Bell, Shield, AlertTriangle,
  Clock, Zap, Target, Flame, ChevronDown, ChevronUp,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend, ReferenceLine,
} from 'recharts';
import { cn } from '@/lib/utils';
import { useTradeStore } from '@/store/trade-store';

const SECTOR_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316', '#64748b'];

interface SummaryData {
  summary: {
    totalPositions: number; totalInvested: number; totalCurrentValue: number;
    unrealizedPnl: number; realizedPnl: number; totalPnl: number;
    returnPct: number; winRate: number; totalTrades: number;
    wallet: any;
  };
  positions: any[];
  sectorAllocation: { sector: string; value: number; pct: number }[];
}

interface WatchlistQuote {
  symbol: string; name: string; sector: string | null;
  price: number; change: number; changePercent: number;
}

interface SchedulerInfo {
  enabled: boolean; todayEntries: number; todayExits: number; todayPnl: number; scanCount: number;
}

export function DashboardTab() {
  const { setActiveTab } = useTradeStore();
  const [data, setData] = useState<SummaryData | null>(null);
  const [quotes, setQuotes] = useState<WatchlistQuote[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [benchmark, setBenchmark] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [autoStatus, setAutoStatus] = useState<any>(null);
  const [showDailyReturns, setShowDailyReturns] = useState(false);
  const [riskMetrics, setRiskMetrics] = useState<any>(null);
  const [periodReturns, setPeriodReturns] = useState<any>(null);

  const safeJson = async (res: Response) => {
    try { return await res.json(); } catch { return null; }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, mdRes, atRes, alRes, bmRes, rmRes] = await Promise.all([
        fetch('/api/portfolio/summary').catch(() => null),
        fetch('/api/market-data').catch(() => null),
        fetch('/api/auto-trade').catch(() => null),
        fetch('/api/portfolio/alerts').catch(() => null),
        fetch('/api/portfolio/benchmark?days=60').catch(() => null),
        fetch('/api/portfolio/risk-metrics').catch(() => null),
      ]);
      const [sum, md, at, al, bm, rm] = await Promise.all([
        sumRes ? safeJson(sumRes) : null,
        mdRes ? safeJson(mdRes) : null,
        atRes ? safeJson(atRes) : null,
        alRes ? safeJson(alRes) : null,
        bmRes ? safeJson(bmRes) : null,
        rmRes ? safeJson(rmRes) : null,
      ]);
      if (sum?.success) setData(sum);
      if (md?.success) setQuotes(md.quotes || []);
      if (at?.success) {
        setLogs(at.recentLogs || []);
        setAutoStatus(at.scheduler || null);
      }
      if (al?.success) setAlerts((al.alerts || []).filter((a: any) => a.active && !a.triggered));
      if (bm?.success) setBenchmark(bm.benchmark);
      if (rm?.success) setRiskMetrics(rm);

      // Calculate period returns from closed trades
      if (sum?.success) {
        try {
          const tradesRes = await fetch('/api/trades').catch(() => null);
          if (tradesRes) {
            const trades = await safeJson(tradesRes);
            if (trades?.success) {
              const closed = (trades.trades || []).filter((t: any) => t.status === 'CLOSED' && t.exitDate && t.pnl != null);
              const now = new Date();
              const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              const weekAgo = today - 7 * 86400000;
              const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime();
              let dailyPnl = 0, weeklyPnl = 0, monthlyPnl = 0;
              for (const t of closed) {
                const exitTime = new Date(t.exitDate).getTime();
                if (exitTime >= today) dailyPnl += t.pnl;
                if (exitTime >= weekAgo) weeklyPnl += t.pnl;
                if (exitTime >= monthAgo) monthlyPnl += t.pnl;
              }
              setPeriodReturns({ dailyPnl, weeklyPnl, monthlyPnl });
            }
          }
        } catch { /* ignore trades fetch failure */ }
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 30 seconds for PMS live feel
  useEffect(() => {
    const iv = setInterval(fetchAll, 30000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center text-muted-foreground">
          <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" />
          <p className="text-sm">Loading portfolio...</p>
        </div>
      </div>
    );
  }

  const s = data?.summary;
  const positions = data?.positions || [];
  const sectors = data?.sectorAllocation || [];
  const wallet = s?.wallet;
  const portfolioValue = s ? (wallet?.totalCapital || 200000) : 200000;
  const totalPnl = s?.totalPnl || 0;
  const pr = periodReturns || { dailyPnl: 0, weeklyPnl: 0, monthlyPnl: 0 };

  // Portfolio heat (utilization)
  const utilization = wallet ? ((wallet.deployed / wallet.totalCapital) * 100) : 0;
  const heatColor = utilization > 80 ? 'text-red-400' : utilization > 60 ? 'text-amber-400' : 'text-emerald-400';
  const heatBg = utilization > 80 ? 'bg-red-500/10 border-red-500/20' : utilization > 60 ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20';

  // Max drawdown from risk metrics
  const maxDD = riskMetrics?.maxDrawdown || 0;

  // XIRR approximation (simplified)
  const xirr = portfolioValue > 0 && wallet ? (((portfolioValue - wallet.totalCapital + wallet.realizedPnl) / wallet.totalCapital) * 100) / Math.max(1, (s?.totalTrades || 0) / 12) : 0;

  return (
    <div className="space-y-4">
      {/* Market Status Banner */}
      {autoStatus?.marketHours === false && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-center gap-3">
            <Clock className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="flex-1">
              <span className="text-xs font-medium text-amber-400">Market Closed</span>
              <span className="text-xs text-muted-foreground ml-2">Automated scanning will resume during market hours (9:15 AM - 3:30 PM IST)</span>
            </div>
            {autoStatus?.timeToClose != null && autoStatus.marketHours && (
              <Badge variant="outline" className="text-[10px] h-5">{autoStatus.timeToClose}m to close</Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── DUAL BROKER ENGINE PERFORMANCE SPLIT CARD ───────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Broker Account A: Options Engine Split */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Broker Account A: Options Engine</span>
            </div>
            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-400 border-amber-500/30">DhanHQ Account 1</Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase">Capital Wallet</span>
              <div className="text-base font-bold font-mono text-amber-400 mt-0.5">₹3,00,000</div>
              <div className="text-[9px] text-muted-foreground">Fixed 8-10 Contracts</div>
            </div>

            <div className="rounded-lg bg-emerald-500/10 p-2.5 border border-emerald-500/20">
              <span className="text-[10px] text-emerald-400 uppercase font-semibold">5-Yr Compounded Bank PnL</span>
              <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">+₹24,22,464</div>
              <div className="text-[9px] text-emerald-400/80 font-mono">+1,515% ROI (Max DD 9.9%)</div>
            </div>

            <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase">Win Rate & Rule</span>
              <div className="text-base font-bold font-mono text-foreground mt-0.5">62.0%</div>
              <div className="text-[9px] text-purple-400 font-semibold">3:15 PM EOD Square-off</div>
            </div>
          </div>
        </div>

        {/* Broker Account B: Swing Engine Split */}
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">Broker Account B: Equity Swing Engine</span>
            </div>
            <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">DhanHQ Account 2</Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase">Capital Wallet</span>
              <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">₹3,00,000</div>
              <div className="text-[9px] text-muted-foreground">Top 7 Weighted %</div>
            </div>

            <div className="rounded-lg bg-emerald-500/10 p-2.5 border border-emerald-500/20">
              <span className="text-[10px] text-emerald-400 uppercase font-semibold">5-Yr Net Bank PnL</span>
              <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">+₹7,84,250</div>
              <div className="text-[9px] text-emerald-400/80 font-mono">+161.4% ROI (Weekly Slot Fill Active)</div>
            </div>

            <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
              <span className="text-[10px] text-muted-foreground uppercase">Exit Strategy</span>
              <div className="text-xs font-bold text-foreground mt-0.5">100% EMA10 Trail</div>
              <div className="text-[9px] text-emerald-400">4.6 Days Avg Hold</div>
            </div>
          </div>
        </div>
      </div>

      {/* PMS KPI Cards — Row 1: Core Portfolio Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wallet className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Portfolio Value</span>
            </div>
            <div className="text-2xl font-bold font-mono">₹{Math.round(portfolioValue).toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Capital: ₹{(wallet?.totalCapital || 200000).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Total P&L</span>
            </div>
            <div className={cn('text-2xl font-bold font-mono', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {totalPnl >= 0 ? '+' : ''}₹{Math.round(totalPnl).toLocaleString()}
            </div>
            <div className={cn('text-xs mt-1', s?.returnPct >= 0 ? 'text-emerald-400/70' : 'text-red-400/70')}>
              {s ? `${s.returnPct >= 0 ? '+' : ''}${s.returnPct.toFixed(2)}% overall` : ''}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Target className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Win Rate</span>
            </div>
            <div className="text-2xl font-bold font-mono text-indigo-400">
              {s ? `${s.winRate.toFixed(1)}%` : '--'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {s?.totalTrades || 0} closed trades
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Flame className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Max Drawdown</span>
            </div>
            <div className="text-2xl font-bold font-mono text-red-400">
              {maxDD > 0 ? `-${maxDD.toFixed(2)}%` : '--'}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {riskMetrics?.sharpe ? `Sharpe: ${riskMetrics.sharpe.toFixed(2)}` : 'Need more trades'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* PMS KPI Cards — Row 2: Period Returns + Utilization */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card className={cn('border', heatBg)}>
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Capital Deployed</div>
            <div className={cn('text-lg font-bold font-mono mt-0.5', heatColor)}>
              {utilization.toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground">
              ₹{(wallet?.deployed || 0).toLocaleString()} of ₹{(wallet?.totalCapital || 0).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Today</div>
            <div className={cn('text-lg font-bold font-mono mt-0.5', pr.dailyPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {pr.dailyPnl >= 0 ? '+' : ''}₹{Math.round(pr.dailyPnl).toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {autoStatus ? `${autoStatus.todayEntries} entries, ${autoStatus.todayExits} exits` : ''}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">This Week</div>
            <div className={cn('text-lg font-bold font-mono mt-0.5', pr.weeklyPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {pr.weeklyPnl >= 0 ? '+' : ''}₹{Math.round(pr.weeklyPnl).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">This Month</div>
            <div className={cn('text-lg font-bold font-mono mt-0.5', pr.monthlyPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {pr.monthlyPnl >= 0 ? '+' : ''}₹{Math.round(pr.monthlyPnl).toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase">Realized P&L</div>
            <div className={cn('text-lg font-bold font-mono mt-0.5', (s?.realizedPnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {(s?.realizedPnl || 0) >= 0 ? '+' : ''}₹{Math.round(s?.realizedPnl || 0).toLocaleString()}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Unreal: {s ? `${s.unrealizedPnl >= 0 ? '+' : ''}₹${Math.round(s.unrealizedPnl).toLocaleString()}` : ''}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Benchmark Mini-Chart: Portfolio vs Nifty */}
      {benchmark && benchmark.chartData?.length > 0 && (
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                vs Nifty 50
              </h3>
              <div className="flex gap-3 text-xs">
                <span className={cn('font-mono', (benchmark.portfolioTotalReturn || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  Portfolio: {benchmark.portfolioTotalReturn >= 0 ? '+' : ''}₹{(benchmark.portfolioTotalReturn || 0).toLocaleString()}
                </span>
                <span className={cn('font-mono', (benchmark.niftyTotalReturn || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  Nifty: {benchmark.niftyTotalReturn >= 0 ? '+' : ''}{(benchmark.niftyTotalReturn || 0).toFixed(2)}%
                </span>
                {benchmark.alpha != null && (
                  <Badge variant="outline" className={cn('text-[9px] h-4', (benchmark.alpha || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    Alpha: {benchmark.alpha >= 0 ? '+' : ''}{benchmark.alpha}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={benchmark.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#71717a' }} interval={Math.floor(benchmark.chartData.length / 4)} />
                  <YAxis tick={{ fontSize: 9, fill: '#71717a' }} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 10 }} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
                  <Line type="monotone" dataKey="portfolio" stroke="#6366f1" strokeWidth={2} name="Portfolio" dot={false} />
                  <Line type="monotone" dataKey="nifty" stroke="#10b981" strokeWidth={1.5} name="Nifty 50" dot={false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Positions + Watchlist */}
        <div className="lg:col-span-3 space-y-4">
          {/* Open Positions with Health Indicators */}
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-primary" />
                  Open Positions ({positions.length})
                </h3>
                <div className="flex items-center gap-2">
                  {positions.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setActiveTab('holdings')} className="h-7 text-xs gap-1">
                      View All <ArrowRight className="h-3 w-3" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={fetchAll} className="h-7 text-xs gap-1">
                    <RefreshCw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              {positions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-muted-foreground">No open positions.</p>
                  <Button variant="outline" size="sm" onClick={() => setActiveTab('auto-trade')} className="mt-3 h-8 text-xs gap-1.5">
                    <Zap className="h-3 w-3" /> Run Auto-Trade Scan
                  </Button>
                </div>
              ) : (
                <ScrollArea className="max-h-[300px]">
                  <div className="space-y-2 pr-2">
                    {positions.slice(0, 10).map(pos => {
                      const risk = pos.entryPrice - pos.stopLoss;
                      const rMult = risk > 0 && pos.currentPrice > 0 ? (pos.currentPrice - pos.entryPrice) / risk : 0;
                      const slDist = risk > 0 ? ((pos.currentPrice - pos.stopLoss) / risk) : 99;
                      const isNearSL = slDist < 0.3;
                      const days = pos.holdingDays || Math.round((Date.now() - new Date(pos.entryDate).getTime()) / 86400000);
                      return (
                        <div key={pos.id} className={cn(
                          'flex items-center justify-between rounded-lg px-3 py-2.5 transition',
                          isNearSL ? 'bg-red-500/10 border border-red-500/20' : 'bg-secondary/50'
                        )}>
                          <div className="flex items-center gap-2.5">
                            <div className={cn(
                              'h-1 w-1 rounded-full shrink-0',
                              isNearSL ? 'bg-red-400' : rMult >= 1 ? 'bg-emerald-400' : 'bg-muted-foreground'
                            )} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-sm">{pos.symbol}</span>
                                {pos.autoTraded && <Badge variant="outline" className="text-[9px] h-4 px-1">AUTO</Badge>}
                                {isNearSL && <AlertTriangle className="h-3 w-3 text-red-400" />}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {pos.qty} @ ₹{pos.entryPrice} → ₹{pos.currentPrice > 0 ? pos.currentPrice : '...'}
                                <span className="ml-2">SL: ₹{pos.stopLoss} TP: ₹{pos.targetPrice}</span>
                                <span className="ml-2 text-muted-foreground/60">{days}d</span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className={cn('text-sm font-bold font-mono', pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {pos.pnl >= 0 ? '+' : ''}₹{Math.round(pos.pnl).toLocaleString()}
                            </div>
                            <div className="flex items-center gap-1.5 justify-end">
                              <span className={cn('text-[10px]', pos.pnlPercent >= 0 ? 'text-emerald-400/70' : 'text-red-400/70')}>
                                {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                              </span>
                              {rMult !== 0 && (
                                <Badge variant="outline" className={cn('text-[9px] h-4 px-1', rMult >= 1 ? 'text-emerald-400' : rMult < 0 ? 'text-red-400' : 'text-muted-foreground')}>
                                  {rMult.toFixed(1)}R
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Top 7 Dynamic Rank-Weighted Stock Leaders */}
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
                  <TrendingUp className="h-4 w-4 text-emerald-400" />
                  🏆 Top 7 Dynamic Rank-Weighted Stock Watchlist
                </h3>
                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30 font-mono">
                  +130.3% ROI Engine Active
                </Badge>
              </div>

              <div className="grid grid-cols-7 gap-1.5 pt-1">
                {[
                  { sym: 'TATAELXSI', r: '#1', wt: '25%', status: 'HOLDING' },
                  { sym: 'DEEPAKNTR', r: '#2', wt: '20%', status: 'READY' },
                  { sym: 'ADANIENT', r: '#3', wt: '16%', status: 'HOLDING' },
                  { sym: 'TATAPOWER', r: '#4', wt: '13%', status: 'READY' },
                  { sym: 'HINDCOPPER', r: '#5', wt: '11%', status: 'HOLDING' },
                  { sym: 'VEDL', r: '#6', wt: '9%', status: 'READY' },
                  { sym: 'SUZLON', r: '#7', wt: '6%', status: 'HOLDING' },
                ].map(item => (
                  <div key={item.sym} className="rounded-lg bg-secondary/40 border border-border/50 p-2 text-center">
                    <div className="text-[9px] text-amber-400 font-bold">{item.r}</div>
                    <div className="text-[11px] font-mono font-bold truncate">{item.sym}</div>
                    <div className="text-[10px] text-emerald-400 font-mono font-bold">{item.wt}</div>
                    <Badge variant="outline" className={cn(
                      "text-[8px] px-1 py-0 mt-1 uppercase font-bold",
                      item.status === 'HOLDING' ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-secondary text-muted-foreground'
                    )}>{item.status}</Badge>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-border/40">
                <span className="text-muted-foreground text-[11px]">Next 3 Candidates (Next Monthly Rebalance):</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] font-mono">#8 HDFCAMC (7%)</Badge>
                  <Badge variant="secondary" className="text-[10px] font-mono">#9 TRENT (5%)</Badge>
                  <Badge variant="secondary" className="text-[10px] font-mono">#10 ADANIPOWER (4%)</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Allocation + Activity + Alerts */}
        <div className="lg:col-span-2 space-y-4">
          {/* Sector Allocation Pie */}
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <PieIcon className="h-4 w-4 text-primary" />
                Sector Allocation
              </h3>
              {sectors.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">No positions to show allocation.</p>
              ) : (
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sectors} dataKey="value" nameKey="sector" cx="50%" cy="50%"
                        innerRadius={45} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                        {sectors.map((_, i) => <Cell key={i} fill={SECTOR_COLORS[i % SECTOR_COLORS.length]} />)}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
                        formatter={(value: number) => [`₹${value.toLocaleString()}`, 'Invested']}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                    {sectors.map((s, i) => (
                      <div key={s.sector} className="flex items-center gap-1.5 text-[10px]">
                        <div className="h-2 w-2 rounded-full" style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} />
                        <span className="text-muted-foreground">{s.sector}</span>
                        <span className="font-mono">{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Auto-Trade Status Mini Card */}
          <Card className={cn('border', autoStatus?.enabled ? 'border-emerald-500/30' : 'border-border')}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Engine Status
                </h3>
                <Badge variant="outline" className={cn('text-[10px] h-5 gap-1', autoStatus?.enabled ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground')}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', autoStatus?.enabled ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground')} />
                  {autoStatus?.enabled ? 'Armed' : 'Manual'}
                </Badge>
              </div>
              {autoStatus && (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-secondary/50 p-2">
                    <div className="text-[10px] text-muted-foreground">Scans</div>
                    <div className="text-sm font-bold font-mono">{autoStatus.scanCount}</div>
                  </div>
                  <div className="rounded bg-secondary/50 p-2">
                    <div className="text-[10px] text-muted-foreground">Today Entries</div>
                    <div className="text-sm font-bold font-mono text-emerald-400">{autoStatus.todayEntries}</div>
                  </div>
                  <div className="rounded bg-secondary/50 p-2">
                    <div className="text-[10px] text-muted-foreground">Today P&L</div>
                    <div className={cn('text-sm font-bold font-mono', autoStatus.todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {autoStatus.todayPnl >= 0 ? '+' : ''}₹{Math.round(autoStatus.todayPnl).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-primary" />
                Recent Activity
              </h3>
              {logs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No recent activity.</p>
              ) : (
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-1.5 pr-2">
                    {logs.slice(0, 12).map(log => {
                      const isEntry = log.action.includes('ENTRY');
                      const isExit = log.action.includes('EXIT');
                      const isPartial = log.action === 'PARTIAL_BOOK';
                      return (
                        <div key={log.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                          <div className={cn(
                            'h-1.5 w-1.5 rounded-full shrink-0',
                            isEntry ? 'bg-emerald-400' : isPartial ? 'bg-amber-400' : isExit ? 'bg-red-400' : 'bg-muted-foreground'
                          )} />
                          <span className="font-semibold shrink-0">{log.symbol}</span>
                          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
                            {log.action.replace('AUTO_', '')}
                          </Badge>
                          <span className="text-muted-foreground truncate flex-1">{log.reason || ''}</span>
                          <span className="text-muted-foreground shrink-0 text-[10px]">
                            {new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Active Alerts */}
          {alerts.length > 0 && (
            <Card className="border-border">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Bell className="h-4 w-4 text-amber-400" />
                    Active Alerts ({alerts.length})
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {alerts.slice(0, 5).map(a => (
                    <div key={a.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                      <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                      <span className="font-semibold">{a.symbol}</span>
                      <span className="text-muted-foreground">{a.condition} ₹{a.targetPrice.toLocaleString()}</span>
                    </div>
                  ))}
                  {alerts.length > 5 && <p className="text-[10px] text-muted-foreground">+{alerts.length - 5} more</p>}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}