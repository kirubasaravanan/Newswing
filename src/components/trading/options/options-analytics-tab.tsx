'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { Bar } from 'recharts';
import { cn } from '@/lib/utils';
import { fetchSafe } from './helpers';
import type { Position } from './types';
import { COLORS } from './constants';

function OptionsAnalyticsTab() {
  const [trades, setTrades] = useState<any[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [tData, pData] = await Promise.all([
        fetchSafe('/api/options/trades?status=ALL'),
        fetchSafe('/api/options/positions'),
      ]);
      if (tData?.success) setTrades(tData.trades || []);
      if (pData?.success) setPositions(pData.positions || []);
      setLoading(false);
    };
    load();
  }, []);

  const closedTrades = trades.filter((t) => t.status !== 'OPEN');
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const wins = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
  const losses = closedTrades.filter((t) => (t.pnl || 0) <= 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const avgPnl = closedTrades.length > 0 ? totalPnl / closedTrades.length : 0;

  // P&L by exit reason
  const pnlByReason = useMemo(() => {
    const map: Record<string, number> = {};
    closedTrades.forEach((t) => {
      const reason = t.exitReason || 'UNKNOWN';
      map[reason] = (map[reason] || 0) + (t.pnl || 0);
    });
    return Object.entries(map).map(([reason, pnl]) => ({ reason, pnl: Math.round(pnl) }));
  }, [closedTrades]);

  // OI-based sentiment from positions (using entry IV as proxy)
  const sentimentData = useMemo(() => {
    const ceTrades = positions.filter((p) => p.optionType === 'CE');
    const peTrades = positions.filter((p) => p.optionType === 'PE');
    const ceTotal = ceTrades.reduce((sum, p) => sum + p.entryPremium * p.lotSize * p.qty, 0);
    const peTotal = peTrades.reduce((sum, p) => sum + p.entryPremium * p.lotSize * p.qty, 0);
    return [
      { name: 'Call (CE)', value: Math.round(ceTotal) || 1, fill: '#10b981' },
      { name: 'Put (PE)', value: Math.round(peTotal) || 1, fill: '#ef4444' },
    ];
  }, [positions]);

  // Daily P&L trend (group by exitDate)
  const pnlTrend = useMemo(() => {
    const map: Record<string, number> = {};
    closedTrades.forEach((t) => {
      if (t.exitDate) {
        const day = new Date(t.exitDate).toISOString().split('T')[0];
        map[day] = (map[day] || 0) + (t.pnl || 0);
      }
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, pnl]) => ({ date, pnl: Math.round(pnl) }));
  }, [closedTrades]);

  // Theta decay analysis
  const thetaAnalysis = useMemo(() => {
    const totalThetaPerDay = trades
      .filter((t) => t.entryTheta && t.status === 'OPEN')
      .reduce((sum, t) => {
        const shares = t.lotSize * t.qty;
        const thetaPerShare = Math.abs(t.entryTheta || 0);
        return sum + thetaPerShare * shares * (t.action === 'BUY' ? -1 : 1);
      }, 0);
    return totalThetaPerDay;
  }, [trades]);

  if (loading) {
    return <div className="text-center text-muted-foreground text-sm py-8">Loading analytics...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Total Trades</div>
          <div className="text-xl font-bold">{trades.length}</div>
          <div className="text-[10px] text-muted-foreground">{positions.length} open</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Win Rate</div>
          <div className={cn('text-xl font-bold', winRate >= 50 ? 'text-emerald-400' : 'text-red-400')}>
            {winRate.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground">{wins}W / {losses}L</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Total P&L</div>
          <div className={cn('text-xl font-bold', totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{totalPnl.toLocaleString()}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Avg P&L/Trade</div>
          <div className={cn('text-xl font-bold', avgPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{avgPnl.toFixed(0)}
          </div>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* P&L Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">P&L by Trade</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pnlTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                    formatter={(value: number) => [`₹${value}`, 'P&L']}
                  />
                  <Bar dataKey="pnl" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">No closed trades yet</div>
            )}
          </CardContent>
        </Card>

        {/* OI Sentiment */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Open Position Sentiment</CardTitle>
          </CardHeader>
          <CardContent>
            {positions.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={sentimentData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                    formatter={(value: number) => [`₹${value}`, 'Premium']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {sentimentData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">No open positions</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* P&L by Exit Reason */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">P&L by Exit Reason</CardTitle>
          </CardHeader>
          <CardContent>
            {pnlByReason.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pnlByReason}
                    dataKey="pnl"
                    nameKey="reason"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ reason, pnl }) => `${reason}: ₹${pnl}`}
                    labelLine={{ stroke: 'hsl(var(--muted-foreground))' }}
                  >
                    {pnlByReason.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', fontSize: 11 }}
                    formatter={(value: number) => [`₹${value}`, 'P&L']}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground text-xs">No closed trades</div>
            )}
          </CardContent>
        </Card>

        {/* Theta Decay Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Theta Decay (Open Positions)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-secondary/30 p-4 text-center">
              <div className="text-[10px] text-muted-foreground mb-1">Net Theta / Day</div>
              <div className={cn('text-2xl font-bold', thetaAnalysis < 0 ? 'text-red-400' : 'text-emerald-400')}>
                {thetaAnalysis < 0 ? '-' : '+'}₹{Math.abs(thetaAnalysis).toFixed(0)}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {thetaAnalysis < 0 ? 'Paying theta (net buyer)' : 'Collecting theta (net seller)'}
              </div>
            </div>

            {/* Per-position theta breakdown */}
            {positions.filter((p) => p.entryTheta != null).length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-muted-foreground font-medium">Per Position:</div>
                {positions.filter((p) => p.entryTheta != null).map((p) => {
                  const dailyTheta = (p.entryTheta || 0) * p.lotSize * p.qty * (p.action === 'BUY' ? -1 : 1);
                  return (
                    <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                      <span>{p.symbol} {p.strikePrice} {p.optionType}</span>
                      <span className={cn(dailyTheta < 0 ? 'text-red-400' : 'text-emerald-400')}>
                        {dailyTheta < 0 ? '-' : '+'}₹{Math.abs(dailyTheta).toFixed(0)}/day
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export { OptionsAnalyticsTab };