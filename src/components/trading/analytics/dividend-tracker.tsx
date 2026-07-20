'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

// ── Dividend Tracker (Analytics version) ───────────────
function DividendTracker() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/portfolio/dividends');
        const d = await res.json();
        if (d.success) setData(d);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);
  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!data || data.dividends.length === 0) return <p className="text-center py-8 text-muted-foreground text-sm">No dividends recorded. Add them in Settings → Dividends.</p>;
  const s = data.summary;
  const byYearEntries = Object.entries(s.byYear).sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="rounded-lg bg-emerald-500/10 p-3">
          <div className="text-[10px] text-emerald-400 uppercase">Total Dividends</div>
          <div className="text-lg font-bold font-mono text-emerald-400">₹{s.totalDividends.toLocaleString()}</div>
        </div>
        <div className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">Stocks</div>
          <div className="text-lg font-bold font-mono">{s.uniqueStocks}</div>
        </div>
        {byYearEntries.slice(0, 2).map(([year, amount]) => (
          <div key={year} className="rounded-lg bg-secondary/50 p-3">
            <div className="text-[10px] text-muted-foreground uppercase">{year}</div>
            <div className="text-lg font-bold font-mono text-emerald-400">₹{Math.round(amount as number).toLocaleString()}</div>
          </div>
        ))}
      </div>
      <h4 className="text-xs font-semibold mb-2">By Stock</h4>
      <ScrollArea className="max-h-[200px]">
        <div className="space-y-1 pr-2">
          {Object.entries(s.bySymbol).slice(0, 15).map(([sym, amt]) => (
            <div key={sym} className="flex items-center justify-between text-xs py-1.5 border-b border-border/30">
              <span className="font-semibold">{sym}</span>
              <span className="font-mono text-emerald-400">₹{Math.round(amt as number).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default DividendTracker;