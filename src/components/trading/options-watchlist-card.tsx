'use client';

import { useEffect, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface OptionsUniverseRow {
  symbol: string;
  profitFactor: number; totalTrades: number; winRate: number; sharpeRatio: number;
  inTop10: boolean;
  isPriority: boolean;
  openPosition?: { direction: string; strike: number; expiry: string; entryPrice: number; qty: number };
}

/**
 * Real options watchlist display — did not exist before (options had no
 * frontend watchlist widget at all, fake or otherwise). Shows all 20 real
 * backtest-proven options symbols, ranked by PF, flagged whether each is in
 * the live TOP-10 trading set and/or the TOP-5 Discord-priority tier — see
 * options-proven-symbols.ts for the concurrency backtest this split came
 * from. Fetches /api/auto-trade/options-universe.
 */
export function OptionsWatchlistCard() {
  const [rows, setRows] = useState<OptionsUniverseRow[]>([]);
  const [cap, setCap] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auto-trade/options-universe');
        const data = await res.json();
        if (!cancelled) {
          if (data.success) { setRows(data.stocks || []); setCap(data.concurrencyCap ?? null); }
          else setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const top10 = rows.filter(r => r.inTop10);
  const openCount = top10.filter(r => r.openPosition).length;
  const displayed = expanded ? rows : top10;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-amber-400" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            🎯 Real Backtest-Proven Options Watchlist (TOP-10)
          </span>
        </div>
        {!loading && !error && (
          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 font-mono text-[10px]">
            {openCount} of {cap ?? '—'} concurrent slots open
          </Badge>
        )}
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading real backtest data…</p>}
      {error && <p className="text-xs text-red-400">Couldn't load options universe data.</p>}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
            {displayed.slice(0, expanded ? undefined : 10).map((item) => (
              <div key={item.symbol} className="rounded-lg bg-secondary/40 border border-border/50 p-2 text-center relative">
                {item.isPriority && (
                  <div className="absolute -top-1 -right-1 text-[9px]" title="TOP-5 Priority">⭐</div>
                )}
                <div className="text-[11px] font-mono font-bold truncate">{item.symbol}</div>
                <div className="text-[10px] text-amber-400 font-mono font-bold">PF {item.profitFactor.toFixed(2)}</div>
                <Badge variant="outline" className={cn(
                  "text-[8px] px-1 py-0 mt-1 uppercase font-bold",
                  item.openPosition ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : item.inTop10 ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                    : 'bg-secondary text-muted-foreground border-border/40'
                )}>
                  {item.openPosition ? 'HOLDING' : item.inTop10 ? 'ELIGIBLE' : 'NOT IN TOP-10'}
                </Badge>
              </div>
            ))}
          </div>

          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
          >
            {expanded ? 'Show only the live TOP-10' : `View all ${rows.length} proven symbols, ranked by real backtest PF`}
          </button>
        </>
      )}
    </div>
  );
}
