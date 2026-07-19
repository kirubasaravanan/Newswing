'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ── Capital Gains Report ────────────────────────────────
function CapitalGainsReport() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/capital-gains');
        const json = await res.json();
        if (json.success) setData(json);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || (data.stcg.length === 0 && data.ltcg.length === 0)) return <p className="text-center py-8 text-muted-foreground text-sm">No closed trades for capital gains report.</p>;

  const s = data.summary;
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-red-500/10 p-3">
          <div className="text-[10px] text-red-400 uppercase">STCG ({s.stcgRate})</div>
          <div className="text-lg font-bold font-mono text-red-400">₹{Math.round(s.totalSTCG).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Tax: ₹{s.stcgTax.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-blue-500/10 p-3">
          <div className="text-[10px] text-blue-400 uppercase">LTCG ({s.ltcgRate})</div>
          <div className="text-lg font-bold font-mono text-blue-400">₹{Math.round(s.totalLTCG).toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">Tax: ₹{s.ltcgTax.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Exemption</div>
          <div className="text-lg font-bold font-mono">₹{s.ltcgExemption.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">LTCG threshold</div>
        </div>
        <div className="rounded-lg bg-amber-500/10 p-3">
          <div className="text-[10px] text-amber-400 uppercase">Total Tax Est.</div>
          <div className="text-lg font-bold font-mono text-amber-400">₹{s.totalTax.toLocaleString()}</div>
        </div>
      </div>
      {data.byFinancialYear.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold mb-2">By Financial Year</h4>
          <ScrollArea className="max-h-[150px]">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-1 font-medium">FY</th><th className="text-right py-1 font-medium">STCG</th>
                <th className="text-right py-1 font-medium">LTCG</th><th className="text-right py-1 font-medium">Tax</th>
              </tr></thead>
              <tbody>
                {data.byFinancialYear.map((fy: any) => (
                  <tr key={fy.fy} className="border-b border-border/30">
                    <td className="py-1 font-mono">{fy.fy}</td>
                    <td className={cn('text-right py-1 font-mono', fy.stcg >= 0 ? 'text-red-400' : 'text-emerald-400')}>{fy.stcg >= 0 ? '+' : ''}₹{fy.stcg.toLocaleString()}</td>
                    <td className={cn('text-right py-1 font-mono', fy.ltcg >= 0 ? 'text-red-400' : 'text-emerald-400')}>{fy.ltcg >= 0 ? '+' : ''}₹{fy.ltcg.toLocaleString()}</td>
                    <td className="text-right py-1 font-mono text-amber-400">₹{(fy.stcgTax + fy.ltcgTax).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </div>
      )}
      <ScrollArea className="max-h-[200px]">
        <table className="w-full text-xs">
          <thead><tr className="border-b border-border text-muted-foreground">
            <th className="text-left py-1 font-medium">Symbol</th><th className="text-right py-1 font-medium">P&L</th>
            <th className="text-right py-1 font-medium">Type</th><th className="text-right py-1 font-medium">Days</th>
            <th className="text-right py-1 font-medium">Exit</th>
          </tr></thead>
          <tbody>
            {[...data.stcg.map((t: any) => ({ ...t, type: 'STCG' })), ...data.ltcg.map((t: any) => ({ ...t, type: 'LTCG' }))]
              .sort((a: any, b: any) => new Date(b.exitDate).getTime() - new Date(a.exitDate).getTime())
              .slice(0, 20)
              .map((t: any) => (
                <tr key={t.id} className="border-b border-border/30">
                  <td className="py-1 font-semibold">{t.symbol}</td>
                  <td className={cn('text-right py-1 font-mono', (t.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {(t.pnl || 0) >= 0 ? '+' : ''}₹{Math.round(t.pnl || 0).toLocaleString()}
                  </td>
                  <td className="text-right py-1"><Badge variant="outline" className={cn('text-[9px] h-4', t.type === 'LTCG' ? 'text-blue-400' : 'text-red-400')}>{t.type}</Badge></td>
                  <td className="text-right py-1 font-mono text-muted-foreground">{t.holdingDays}d</td>
                  <td className="text-right py-1 text-muted-foreground">{new Date(t.exitDate).toLocaleDateString()}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </ScrollArea>
    </div>
  );
}

export default CapitalGainsReport;