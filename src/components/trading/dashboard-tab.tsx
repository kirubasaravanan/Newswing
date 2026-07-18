'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp, TrendingDown, Briefcase, Wallet, PieChart as PieIcon,
  RefreshCw, ArrowRight, Activity, Bell,
} from 'lucide-react';
import {
  PieChart, Pie, Cell, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Legend,
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

export function DashboardTab() {
  const { setActiveTab } = useTradeStore();
  const [data, setData] = useState<SummaryData | null>(null);
  const [quotes, setQuotes] = useState<WatchlistQuote[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [benchmark, setBenchmark] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [sumRes, mdRes, atRes, alRes, bmRes] = await Promise.all([
        fetch('/api/portfolio/summary'),
        fetch('/api/market-data'),
        fetch('/api/auto-trade'),
        fetch('/api/portfolio/alerts'),
        fetch('/api/portfolio/benchmark?days=60'),
      ]);
      const [sum, md, at, al, bm] = await Promise.all([sumRes.json(), mdRes.json(), atRes.json(), alRes.json(), bmRes.json()]);
      if (sum.success) setData(sum);
      if (md.success) setQuotes(md.quotes || []);
      if (at.success) setLogs(at.recentLogs || []);
      if (al.success) setAlerts((al.alerts || []).filter((a: any) => a.active && !a.triggered));
      if (bm.success) setBenchmark(bm.benchmark);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
  const portfolioValue = s ? (s.wallet?.totalCapital || 200000) + s.totalPnl : 200000;

  return (
    <div className="space-y-5">
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Wallet className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Portfolio Value</span>
            </div>
            <div className="text-2xl font-bold font-mono">₹{Math.round(portfolioValue).toLocaleString()}</div>
            {s && s.totalPositions > 0 && (
              <div className={cn('text-xs mt-1', s.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                Unreal: {s.unrealizedPnl >= 0 ? '+' : ''}₹{Math.round(s.unrealizedPnl).toLocaleString()}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Total P&L</span>
            </div>
            <div className={cn('text-2xl font-bold font-mono', s && s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {s ? `${s.totalPnl >= 0 ? '+' : ''}₹${Math.round(s.totalPnl).toLocaleString()}` : '₹0'}
            </div>
            {s && (
              <div className={cn('text-xs mt-1', s.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {s.returnPct >= 0 ? '+' : ''}{s.returnPct.toFixed(2)}% return
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Briefcase className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Invested</span>
            </div>
            <div className="text-2xl font-bold font-mono">
              ₹{s ? Math.round(s.totalInvested).toLocaleString() : '0'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {s?.totalPositions || 0} open position{s && s.totalPositions !== 1 ? 's' : ''}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-wider">Win Rate</span>
            </div>
            <div className="text-2xl font-bold font-mono text-indigo-400">
              {s ? `${s.winRate.toFixed(1)}%` : '--'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {s?.totalTrades || 0} closed trades
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
                  <Line type="monotone" dataKey="portfolio" stroke="#6366f1" strokeWidth={2} name="Portfolio (₹)" dot={false} />
                  <Line type="monotone" dataKey="nifty" stroke="#10b981" strokeWidth={1.5} name="Nifty 50 (%)" dot={false} strokeDasharray="4 2" />
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
          {/* Open Positions Quick View */}
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Open Positions ({positions.length})
                </h3>
                {positions.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={() => setActiveTab('holdings')} className="h-7 text-xs gap-1">
                    View All <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
              {positions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No open positions. Go to Scanner to find opportunities.
                </p>
              ) : (
                <ScrollArea className="max-h-[280px]">
                  <div className="space-y-2 pr-2">
                    {positions.slice(0, 8).map(pos => (
                      <div key={pos.id} className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-sm">{pos.symbol}</span>
                              {pos.autoTraded && <Badge variant="outline" className="text-[9px] h-4 px-1">AUTO</Badge>}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {pos.qty} @ ₹{pos.entryPrice} → ₹{pos.currentPrice > 0 ? pos.currentPrice : '...'}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={cn('text-sm font-bold font-mono', pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {pos.pnl >= 0 ? '+' : ''}₹{Math.round(pos.pnl).toLocaleString()}
                          </div>
                          <div className={cn('text-[10px]', pos.pnlPercent >= 0 ? 'text-emerald-400/70' : 'text-red-400/70')}>
                            {pos.pnlPercent >= 0 ? '+' : ''}{pos.pnlPercent.toFixed(2)}%
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          {/* Watchlist Market Overview */}
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-primary" />
                Watchlist — Live Prices
              </h3>
              {quotes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Loading market data...</p>
              ) : (
                <ScrollArea className="max-h-[260px]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border/50 text-muted-foreground">
                        <th className="text-left py-1.5 font-medium">Symbol</th>
                        <th className="text-right py-1.5 font-medium">Price</th>
                        <th className="text-right py-1.5 font-medium">Change</th>
                        <th className="text-right py-1.5 font-medium hidden sm:table-cell">Sector</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quotes.filter(q => q.price > 0).slice(0, 15).map(q => (
                        <tr key={q.symbol} className="border-b border-border/30 hover:bg-secondary/30">
                          <td className="py-1.5 font-medium">{q.symbol}</td>
                          <td className="py-1.5 text-right font-mono">₹{q.price.toLocaleString()}</td>
                          <td className={cn('py-1.5 text-right font-mono', q.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                            {q.changePercent >= 0 ? '+' : ''}{q.changePercent.toFixed(2)}%
                          </td>
                          <td className="py-1.5 text-right hidden sm:table-cell">
                            {q.sector && <Badge variant="outline" className="text-[9px] h-4">{q.sector}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Allocation + Activity */}
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
                <ScrollArea className="max-h-[220px]">
                  <div className="space-y-1.5 pr-2">
                    {logs.slice(0, 15).map(log => {
                      const isEntry = log.action.includes('ENTRY');
                      const isExit = log.action.includes('EXIT');
                      return (
                        <div key={log.id} className="flex items-center gap-2 text-xs py-1.5 border-b border-border/30 last:border-0">
                          <div className={cn(
                            'h-1.5 w-1.5 rounded-full shrink-0',
                            isEntry ? 'bg-emerald-400' : isExit ? 'bg-red-400' : 'bg-muted-foreground'
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
          <Card className="border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-amber-400" />
                  Active Alerts ({alerts.length})
                </h3>
              </div>
              {alerts.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No active alerts. Set alerts in Analytics tab.</p>
              ) : (
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
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}