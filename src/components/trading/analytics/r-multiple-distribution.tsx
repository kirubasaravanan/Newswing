'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { cn } from '@/lib/utils';

// ── R-Multiple Distribution ────────────────────────────
function RMultipleDistribution() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/risk-metrics');
        const json = await res.json();
        if (json.success) setData(json);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || !data.rMultiples?.length) return <p className="text-center py-8 text-muted-foreground text-sm">No closed trades yet.</p>;

  const rMultiples = data.rMultiples;
  const m = data.metrics;

  // Build histogram buckets
  const buckets: { range: string; count: number; positive: boolean }[] = [];
  const ranges = [
    [-10, -3], [-3, -2], [-2, -1], [-1, -0.5], [-0.5, 0],
    [0, 0.5], [0.5, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 10],
  ];
  for (const [lo, hi] of ranges) {
    const count = rMultiples.filter(r => r >= lo && r < hi).length;
    if (count > 0) buckets.push({ range: `${lo}R to ${hi}R`, count, positive: lo >= 0 });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">R-Multiple Distribution</h3>
        <div className="flex gap-4 text-xs">
          <span className="text-muted-foreground">Avg: <span className={cn('font-bold', (m.avgRMultiple || 0) >= 1 ? 'text-emerald-400' : 'text-red-400')}>{m.avgRMultiple?.toFixed(2) || 0}R</span></span>
          <span className="text-muted-foreground">Expectancy: <span className={cn('font-bold', (m.expectancy || 0) > 0 ? 'text-emerald-400' : 'text-red-400')}>{m.expectancy?.toFixed(2) || 0}%</span></span>
        </div>
      </div>
      <div className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={buckets}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="range" tick={{ fontSize: 9, fill: '#71717a' }} angle={-45} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {buckets.map((b, i) => <Cell key={i} fill={b.positive ? '#10b981' : '#ef4444'} fillOpacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Profit Factor</div>
          <div className={cn('text-lg font-bold font-mono', (m.profitFactor || 0) >= 1.5 ? 'text-emerald-400' : 'text-amber-400')}>
            {m.profitFactor?.toFixed(2) || '0'}x
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Avg Win</div>
          <div className="text-lg font-bold font-mono text-emerald-400">{m.avgWin?.toFixed(2) || 0}%</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Avg Loss</div>
          <div className="text-lg font-bold font-mono text-red-400">{m.avgLoss?.toFixed(2) || 0}%</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Win Rate</div>
          <div className="text-lg font-bold font-mono text-indigo-400">{m.winRate?.toFixed(1) || 0}%</div>
        </div>
      </div>
    </div>
  );
}

export default RMultipleDistribution;