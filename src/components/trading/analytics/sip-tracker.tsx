'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ── SIP Tracker (Analytics version) ────────────────────
function SIPTracker() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/sip');
        const d = await res.json();
        if (d.success) setData(d);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || data.plans.length === 0) return <p className="text-center py-8 text-muted-foreground text-sm">No active SIP plans. Create one in Settings → SIP Plans.</p>;
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Total Invested</div>
          <div className="text-lg font-bold font-mono">₹{Math.round(data.totalInvested).toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Current Value</div>
          <div className={cn('text-lg font-bold font-mono', (data.totalCurrentValue - data.totalInvested) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{Math.round(data.totalCurrentValue).toLocaleString()}
          </div>
        </div>
      </div>
      <ScrollArea className="max-h-[300px]">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 font-medium">Symbol</th><th className="text-right py-1 font-medium">Amount</th>
            <th className="text-right py-1 font-medium">Frequency</th><th className="text-right py-1 font-medium">Installments</th>
            <th className="text-right py-1 font-medium">Avg Price</th><th className="text-right py-1 font-medium">Return</th>
          </tr></thead>
          <tbody>
            {data.plans.map((p: any) => (
              <tr key={p.id} className="border-b border-border/30">
                <td className="py-1.5 font-semibold">{p.symbol}</td>
                <td className="text-right py-1.5 font-mono">₹{p.amount.toLocaleString()}</td>
                <td className="text-right py-1.5"><Badge variant="outline" className="text-[9px] h-4">{p.frequency}</Badge></td>
                <td className="text-right py-1.5 font-mono">{p.installmentsCompleted}</td>
                <td className="text-right py-1.5 font-mono">₹{p.avgPrice > 0 ? p.avgPrice.toFixed(1) : '—'}</td>
                <td className={cn('text-right py-1.5 font-mono', p.returnPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {p.returnPct.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

export default SIPTracker;