'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  ComposedChart, Area, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

// ── Equity Curve with Drawdown ─────────────────────────
function EquityCurveCard() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/equity-curve?days=90');
        const json = await res.json();
        if (json.success) setData(json);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || !data.chartData?.length) return (
    <div className="text-center py-8">
      <p className="text-sm text-muted-foreground">No equity curve data yet.</p>
      <p className="text-xs text-muted-foreground mt-1">NAV snapshots are taken when you visit Dashboard or Analytics.</p>
    </div>
  );

  const s = data.summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Equity Curve & Drawdown</h3>
        <div className="flex gap-3 text-xs">
          <span className="text-muted-foreground">NAV: <span className="font-bold font-mono">₹{s.currentNAV.toLocaleString()}</span></span>
          <span className={cn('font-mono', s.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {s.totalReturn >= 0 ? '+' : ''}{s.totalReturn.toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval={Math.floor(data.chartData.length / 6)} />
            <YAxis yAxisId="nav" tick={{ fontSize: 10, fill: '#71717a' }} />
            <YAxis yAxisId="dd" orientation="right" tick={{ fontSize: 9, fill: '#ef4444' }} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine yAxisId="dd" y={0} stroke="rgba(255,255,255,0.15)" />
            <Area yAxisId="nav" type="monotone" dataKey="nav" stroke="#6366f1" fill="url(#navGrad)" strokeWidth={2} name="NAV" dot={false} />
            <Bar yAxisId="dd" dataKey="drawdown" fill="#ef4444" fillOpacity={0.3} name="Drawdown %" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <defs>
              <linearGradient id="navGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                <stop offset="95%" stopColor="transparent" stopOpacity={0} />
              </linearGradient>
            </defs>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { l: 'Total Return', v: `${s.totalReturn >= 0 ? '+' : ''}${s.totalReturn.toFixed(2)}%`, c: s.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400' },
          { l: 'Max Drawdown', v: `-${s.maxDD.toFixed(2)}%`, c: 'text-red-400' },
          { l: 'Best Day', v: `+₹${s.bestDay.toLocaleString()}`, c: 'text-emerald-400' },
          { l: 'Worst Day', v: `₹${s.worstDay.toLocaleString()}`, c: 'text-red-400' },
          { l: 'Positive Days', v: `${s.positiveDays}/${s.snapshots}`, c: 'text-indigo-400' },
        ].map(item => (
          <div key={item.l} className="rounded-lg bg-secondary/50 p-3">
            <div className="text-[10px] text-muted-foreground uppercase">{item.l}</div>
            <div className={cn('text-sm font-bold font-mono mt-0.5', item.c)}>{item.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default EquityCurveCard;