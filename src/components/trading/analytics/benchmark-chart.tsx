'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Legend,
} from 'recharts';
import { cn } from '@/lib/utils';

// ── Benchmark Comparison ────────────────────────────────
function BenchmarkChart() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/benchmark?days=90');
        const json = await res.json();
        if (json.success) setData(json.benchmark);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || !data.chartData?.length) return <p className="text-center py-8 text-muted-foreground text-sm">No benchmark data available.</p>;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Portfolio Return</div>
          <div className={cn('text-lg font-bold font-mono', data.portfolioTotalReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {data.portfolioTotalReturn >= 0 ? '+' : ''}₹{data.portfolioTotalReturn.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Nifty 50 Return</div>
          <div className={cn('text-lg font-bold font-mono', data.niftyTotalReturn >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {data.niftyTotalReturn >= 0 ? '+' : ''}{data.niftyTotalReturn.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Alpha / Beta</div>
          <div className="text-lg font-bold font-mono text-indigo-400">
            {data.alpha}%
            {data.beta != null && <span className="text-xs text-muted-foreground ml-1">β{data.beta}</span>}
          </div>
        </div>
      </div>
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} interval={Math.floor(data.chartData.length / 6)} />
            <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
            <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="portfolio" stroke="#6366f1" strokeWidth={2} name="Portfolio (₹)" dot={false} />
            <Line type="monotone" dataKey="nifty" stroke="#10b981" strokeWidth={1.5} name="Nifty 50 (%)" dot={false} strokeDasharray="4 2" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default BenchmarkChart;