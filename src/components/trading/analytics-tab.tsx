'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LineChart, BarChart3, TrendingUp, PieChart as PieIcon, RefreshCw } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  Legend, ReferenceLine,
} from 'recharts';
import { cn } from '@/lib/utils';

interface AnalyticsData {
  trades: any[];
  totalPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDD: number;
  bySetupType: { name: string; value: number; wins: number; losses: number }[];
  byMonth: { month: string; pnl: number; trades: number }[];
  byScore: { score: string; avgPnL: number; count: number }[];
  pnlDistribution: { range: string; count: number }[];
}

export function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trades');
      const json = await res.json();
      const trades = json.trades || [];
      const closed = trades.filter((t: any) => t.status === 'CLOSED' && t.pnl != null);

      const wins = closed.filter((t: any) => t.pnl > 0);
      const losses = closed.filter((t: any) => t.pnl <= 0);
      const totalPnL = closed.reduce((s: number, t: any) => s + t.pnl, 0);
      const grossProfit = wins.reduce((s: number, t: any) => s + t.pnl, 0);
      const grossLoss = Math.abs(losses.reduce((s: number, t: any) => s + t.pnl, 0));

      // PnL by month
      const monthMap = new Map<string, { pnl: number; trades: number }>();
      for (const t of closed) {
        const d = new Date(t.exitDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const prev = monthMap.get(key) || { pnl: 0, trades: 0 };
        prev.pnl += t.pnl;
        prev.trades += 1;
        monthMap.set(key, prev);
      }
      const byMonth = Array.from(monthMap.entries()).map(([month, v]) => ({
        month,
        pnl: Math.round(v.pnl),
        trades: v.trades,
      })).sort((a, b) => a.month.localeCompare(b.month));

      // PnL distribution
      const buckets = [
        { range: '< -5%', min: -Infinity, max: -5 },
        { range: '-5% to -2%', min: -5, max: -2 },
        { range: '-2% to 0%', min: -2, max: 0 },
        { range: '0% to 2%', min: 0, max: 2 },
        { range: '2% to 5%', min: 2, max: 5 },
        { range: '> 5%', min: 5, max: Infinity },
      ];
      const pnlDistribution = buckets.map(b => ({
        range: b.range,
        count: closed.filter((t: any) => t.pnlPercent >= b.min && t.pnlPercent < b.max).length,
      }));

      // By tags/setup type
      const tagMap = new Map<string, { pnl: number; wins: number; losses: number }>();
      for (const t of closed) {
        const tags = (t.tags || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        const key = tags[0] || 'Manual';
        const prev = tagMap.get(key) || { pnl: 0, wins: 0, losses: 0 };
        prev.pnl += t.pnl;
        if (t.pnl > 0) prev.wins++; else prev.losses++;
        tagMap.set(key, prev);
      }
      const bySetupType = Array.from(tagMap.entries()).map(([name, v]) => ({
        name, value: Math.round(v.pnl), wins: v.wins, losses: v.losses,
      }));

      // Calculate max DD from trade sequence
      let peak = 0;
      let running = 0;
      let maxDD = 0;
      for (const t of closed.sort((a: any, b: any) => new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime())) {
        running += t.pnl;
        peak = Math.max(peak, running);
        maxDD = Math.max(maxDD, (peak - running) / peak * 100);
      }

      setData({
        trades: closed,
        totalPnL,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
        avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
        maxDD,
        bySetupType,
        byMonth,
        byScore: [],
        pnlDistribution,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center text-muted-foreground">
          <RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" />
          <p className="text-sm">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!data || data.trades.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <LineChart className="h-12 w-12 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Close some paper trades to see analytics here.</p>
      </div>
    );
  }

  const COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#ec4899'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Trading Analytics
        </h2>
        <Button variant="outline" size="sm" onClick={fetchAnalytics} className="gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</div>
          <div className={cn('text-xl font-bold mt-1', data.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {data.totalPnL >= 0 ? '+' : ''}₹{Math.round(data.totalPnL).toLocaleString()}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-400">Win Rate</div>
          <div className="text-xl font-bold mt-1 text-emerald-400">{data.winRate.toFixed(1)}%</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Profit Factor</div>
          <div className={cn('text-xl font-bold mt-1', data.profitFactor >= 1.5 ? 'text-emerald-400' : data.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400')}>
            {data.profitFactor.toFixed(2)}x
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Win</div>
          <div className="text-xl font-bold mt-1 text-emerald-400">+₹{Math.round(data.avgWin).toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Loss</div>
          <div className="text-xl font-bold mt-1 text-red-400">-₹{Math.round(data.avgLoss).toLocaleString()}</div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <div className="text-[10px] uppercase tracking-wider text-red-400">Max Drawdown</div>
          <div className="text-xl font-bold mt-1 text-red-400">{data.maxDD.toFixed(1)}%</div>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly P&L */}
        {data.byMonth.length > 0 && (
          <Card className="border-border">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Monthly P&L
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number) => [`₹${value.toLocaleString()}`, 'P&L']}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                    <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                      {data.byMonth.map((m, i) => (
                        <Cell key={i} fill={m.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* P&L Distribution */}
        <Card className="border-border">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <PieIcon className="h-4 w-4" /> P&L Distribution
            </h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.pnlDistribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} />
                  <YAxis dataKey="range" type="category" tick={{ fontSize: 10, fill: '#71717a' }} width={80} />
                  <Tooltip
                    contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                  />
                  <Bar dataKey="count" name="Trades" radius={[0, 3, 3, 0]}>
                    {data.pnlDistribution.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Cumulative P&L */}
        {data.trades.length > 1 && (
          <Card className="border-border lg:col-span-2">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4">Cumulative P&L</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={(() => {
                    let cum = 0;
                    return data.trades.map((t, i) => {
                      cum += t.pnl;
                      return { idx: i + 1, cumPnL: Math.round(cum), pnl: Math.round(t.pnl) };
                    });
                  })()}>
                    <defs>
                      <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={data.totalPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                        <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#71717a' }} label={{ value: 'Trade #', position: 'bottom', fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip
                      contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                      formatter={(value: number, name: string) => [`₹${value.toLocaleString()}`, name === 'cumPnL' ? 'Cumulative' : 'Trade P&L']}
                    />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                    <Area type="monotone" dataKey="cumPnL" stroke={data.totalPnL >= 0 ? '#10b981' : '#ef4444'} fill="url(#cumGrad)" strokeWidth={2} name="cumPnL" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}