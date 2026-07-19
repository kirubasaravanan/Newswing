'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, ArrowDownRight, ArrowUpRight, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ── Rebalance Tool ─────────────────────────────────────
function RebalancePanel() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchRebalance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/rebalance');
      const json = await res.json();
      if (json.success) setData(json.rebalance);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchRebalance(); }, [fetchRebalance]);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || data.allocations.length === 0) return <p className="text-center py-8 text-muted-foreground text-sm">Open some positions to see rebalancing suggestions.</p>;

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Portfolio Value</div>
          <div className="text-lg font-bold font-mono">₹{data.totalValue.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Cash Available</div>
          <div className="text-lg font-bold font-mono text-emerald-400">₹{data.cashAvailable.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Sectors</div>
          <div className="text-lg font-bold font-mono text-indigo-400">{data.sectorCount}</div>
        </div>
      </div>

      {data.actions.length > 0 && (
        <div className="mb-4 space-y-1.5">
          <h4 className="text-xs font-semibold flex items-center gap-1"><Scale className="h-3 w-3" /> Suggested Actions</h4>
          {data.actions.map((a: any, i: number) => (
            <div key={i} className={cn('flex items-center gap-2 text-xs p-2 rounded-lg',
              a.type === 'REDUCE' ? 'bg-red-500/10' : 'bg-emerald-500/10')}>
              {a.type === 'REDUCE' ? <ArrowDownRight className="h-3 w-3 text-red-400" /> : <ArrowUpRight className="h-3 w-3 text-emerald-400" />}
              <Badge variant="outline" className={cn('text-[9px] h-4', a.type === 'REDUCE' ? 'text-red-400' : 'text-emerald-400')}>{a.type}</Badge>
              <span>{a.note}</span>
              <span className="ml-auto font-mono">₹{a.amount.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}

      <h4 className="text-xs font-semibold mb-2">Sector Allocation</h4>
      <ScrollArea className="max-h-[180px]">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 font-medium">Sector</th>
            <th className="text-right py-1 font-medium">Value</th>
            <th className="text-right py-1 font-medium">Now</th>
            <th className="text-right py-1 font-medium">Target</th>
            <th className="text-right py-1 font-medium">Diff</th>
          </tr></thead>
          <tbody>
            {data.allocations.map((a: any) => (
              <tr key={a.sector} className="border-b border-border/30">
                <td className="py-1">{a.sector}</td>
                <td className="text-right py-1 font-mono">₹{a.value.toLocaleString()}</td>
                <td className="text-right py-1 font-mono">{a.currentPct}%</td>
                <td className="text-right py-1 font-mono text-muted-foreground">{a.targetPct}%</td>
                <td className={cn('text-right py-1 font-mono', Math.abs(a.diff) > 10 ? (a.diff > 0 ? 'text-red-400' : 'text-emerald-400') : 'text-muted-foreground')}>
                  {a.diff > 0 ? '+' : ''}{a.diff}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

export default RebalancePanel;