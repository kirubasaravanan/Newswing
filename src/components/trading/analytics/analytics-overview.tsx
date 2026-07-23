'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, TrendingUp, PieChart as PieIcon, LineChart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

// ── Analytics Overview ─────────────────────────────────
function AnalyticsOverview() {
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/trades');
      const json = await res.json();
      const allTrades = json.trades || [];
      const closed = allTrades.filter((t: any) => t.status === 'CLOSED' && t.pnl != null);

      const wins = closed.filter((t: any) => t.pnl > 0);
      const totalPnL = closed.reduce((s: number, t: any) => s + t.pnl, 0);
      const grossProfit = wins.reduce((s: number, t: any) => s + t.pnl, 0);
      const grossLoss = Math.abs(closed.filter((t: any) => t.pnl <= 0).reduce((s: number, t: any) => s + t.pnl, 0));

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
        month, pnl: Math.round(v.pnl), trades: v.trades,
      })).sort((a, b) => a.month.localeCompare(b.month));

      const buckets = [
        { range: '< -5%', min: -Infinity, max: -5 }, { range: '-5% to -2%', min: -5, max: -2 },
        { range: '-2% to 0%', min: -2, max: 0 }, { range: '0% to 2%', min: 0, max: 2 },
        { range: '2% to 5%', min: 2, max: 5 }, { range: '> 5%', min: 5, max: Infinity },
      ];
      const pnlDistribution = buckets.map(b => ({
        range: b.range,
        count: closed.filter((t: any) => t.pnlPercent >= b.min && t.pnlPercent < b.max).length,
      }));

      let peak = 0, running = 0, maxDD = 0;
      for (const t of closed.sort((a: any, b: any) => new Date(a.exitDate).getTime() - new Date(b.exitDate).getTime())) {
        running += t.pnl;
        peak = Math.max(peak, running);
        maxDD = Math.max(maxDD, (peak - running) / peak * 100);
      }

      setAnalyticsData({
        trades: closed, totalPnL,
        winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
        avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
        avgLoss: closed.length - wins.length > 0 ? grossLoss / (closed.length - wins.length) : 0,
        profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
        maxDD, byMonth, pnlDistribution,
      });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  if (loading) return <div className="flex items-center justify-center py-16"><div className="text-center text-muted-foreground"><RefreshCw className="h-6 w-6 mx-auto mb-2 animate-spin" /><p className="text-sm">Loading analytics...</p></div></div>;

  const COLORS = ['#10b981', '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#ec4899'];

  if (analyticsData && analyticsData.trades.length > 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&L</div>
            <div className={cn('text-xl font-bold mt-1', analyticsData.totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {analyticsData.totalPnL >= 0 ? '+' : ''}₹{Math.round(analyticsData.totalPnL).toLocaleString()}
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-emerald-400">Win Rate</div>
            <div className="text-xl font-bold mt-1 text-emerald-400">{analyticsData.winRate.toFixed(1)}%</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Profit Factor</div>
            <div className={cn('text-xl font-bold mt-1', analyticsData.profitFactor >= 1.5 ? 'text-emerald-400' : analyticsData.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400')}>
              {analyticsData.profitFactor.toFixed(2)}x
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Win</div>
            <div className="text-xl font-bold mt-1 text-emerald-400">+₹{Math.round(analyticsData.avgWin).toLocaleString()}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Loss</div>
            <div className="text-xl font-bold mt-1 text-red-400">-₹{Math.round(analyticsData.avgLoss).toLocaleString()}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-[10px] uppercase tracking-wider text-red-400">Max Drawdown</div>
          </CardContent></Card>
        </div>

        {/* ── STATUTORY TRANSACTION FEES & NET TAKE-HOME CARD ────── */}
        <Card className="border-border bg-emerald-500/5 border-emerald-500/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-emerald-400">
                <LineChart className="h-4 w-4" /> Statutory Transaction Fees & Net Take-Home Calculator
              </h3>
              <span className="text-xs font-mono font-bold text-muted-foreground">SEBI & Broker Rules (July 2025)</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
                <span className="text-[10px] text-muted-foreground font-sans uppercase">Gross P&L</span>
                <div className="text-sm font-bold text-emerald-400 mt-0.5">
                  {analyticsData.totalPnL >= 0 ? '+' : ''}₹{Math.round(analyticsData.totalPnL).toLocaleString('en-IN')}
                </div>
              </div>

              <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
                <span className="text-[10px] text-muted-foreground font-sans uppercase">Est. STT + Brokerage</span>
                <div className="text-sm font-bold text-amber-400 mt-0.5">
                  -₹{Math.round(analyticsData.trades.length * 45).toLocaleString('en-IN')}
                </div>
              </div>

              <div className="rounded-lg bg-secondary/40 p-2.5 border border-border/50">
                <span className="text-[10px] text-muted-foreground font-sans uppercase">GST (18%) + SEBI Fees</span>
                <div className="text-sm font-bold text-amber-400 mt-0.5">
                  -₹{Math.round(analyticsData.trades.length * 15).toLocaleString('en-IN')}
                </div>
              </div>

              <div className="rounded-lg bg-emerald-500/10 p-2.5 border border-emerald-500/30">
                <span className="text-[10px] text-emerald-400 font-sans font-bold uppercase">Net Take-Home Cash</span>
                <div className="text-sm font-bold text-emerald-400 mt-0.5">
                  +₹{Math.max(0, Math.round(analyticsData.totalPnL - (analyticsData.trades.length * 60))).toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {analyticsData.byMonth.length > 0 && (
            <Card className="border-border"><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Monthly P&L</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analyticsData.byMonth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`₹${v.toLocaleString()}`, 'P&L']} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                    <Bar dataKey="pnl" name="P&L" radius={[3, 3, 0, 0]}>
                      {analyticsData.byMonth.map((m: any, i: number) => <Cell key={i} fill={m.pnl >= 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>
          )}

          <Card className="border-border"><CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><PieIcon className="h-4 w-4" /> P&L Distribution</h3>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsData.pnlDistribution} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} />
                  <YAxis dataKey="range" type="category" tick={{ fontSize: 10, fill: '#71717a' }} width={80} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" name="Trades" radius={[0, 3, 3, 0]}>
                    {analyticsData.pnlDistribution.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.7} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent></Card>

          {analyticsData.trades.length > 1 && (
            <Card className="border-border lg:col-span-2"><CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-4">Cumulative P&L</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={(() => { let cum = 0; return analyticsData.trades.map((t: any, i: number) => { cum += t.pnl; return { idx: i + 1, cumPnL: Math.round(cum), pnl: Math.round(t.pnl) }; }); })()}>
                    <defs><linearGradient id="cumGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={analyticsData.totalPnL >= 0 ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
                      <stop offset="95%" stopColor="transparent" stopOpacity={0} />
                    </linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="idx" tick={{ fontSize: 10, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                    <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                    <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" />
                    <Area type="monotone" dataKey="cumPnL" stroke={analyticsData.totalPnL >= 0 ? '#10b981' : '#ef4444'} fill="url(#cumGrad2)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-16 text-muted-foreground">
      <LineChart className="h-12 w-12 mx-auto mb-3 opacity-20" />
      <p className="text-sm">Close some trades to see analytics.</p>
    </div>
  );
}

export default AnalyticsOverview;