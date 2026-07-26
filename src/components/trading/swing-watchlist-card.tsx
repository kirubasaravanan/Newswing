'use client';

import { useEffect, useState, useCallback } from 'react';
import { TrendingUp, RefreshCw, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SwingUniverseRow {
  symbol: string; name: string; sector: string;
  profitFactor: number; totalTrades: number; winRate: number; sharpeRatio: number;
  currentlyRsRanked: boolean; rank: number | null; weightPct: number | null;
  currentPrice: number; aligned: boolean; missing: string[];
  openPosition?: { entryPrice: number; qty: number; pnl: number; pnlPct: number };
}

/**
 * Real, single source of truth for the swing watchlist display — replaces
 * the previously hardcoded "Top 7" banners that were duplicated (with
 * invented symbols/weights and a fabricated "+161.4% ROI" badge) across
 * dashboard-tab.tsx, auto-trade/index.tsx, and screener-tab.tsx. Fetches
 * from /api/auto-trade/swing-universe (the real 74-symbol backtest-ranked
 * pool — see swing-universe-status.ts) instead of any static array.
 *
 * Shows the symbols currently eligible to trade THIS week (live RS rank +
 * proven-backtest intersection) first, since that's what's actually live —
 * the rest of the 74 are one click away via the count, not silently
 * pretended not to exist.
 */
export function SwingWatchlistCard() {
  const [rows, setRows] = useState<SwingUniverseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-trade/swing-universe');
      const data = await res.json();
      if (data.success) { setRows(data.stocks || []); setError(false); }
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRebalanceNow = async () => {
    setRebalancing(true);
    try {
      const res = await fetch('/api/auto-trade/rebalance-watchlist', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('Watchlist rebalanced', {
          description: `Real weekly RS scan complete — new Top 7: ${data.top7.map((s: any) => s.symbol).join(', ')}`,
        });
        await fetchData();
      } else {
        toast.error('Rebalance failed', { description: data.error || 'Unknown error' });
      }
    } catch (err) {
      toast.error('Rebalance failed', { description: String(err) });
    } finally {
      setRebalancing(false);
    }
  };

  const eligibleNow = rows.filter(r => r.currentlyRsRanked).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const displayed = expanded ? rows : eligibleNow;

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
            🏆 Real Backtest-Proven Swing Watchlist
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!loading && !error && (
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 font-mono text-[10px]">
              {eligibleNow.length} of {rows.length} proven symbols currently RS-eligible
            </Badge>
          )}
          <Button
            size="sm" variant="outline" onClick={handleRebalanceNow} disabled={rebalancing}
            className="h-7 text-xs gap-1"
          >
            {rebalancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {rebalancing ? 'Scanning full universe…' : 'Rebalance Watchlist Now'}
          </Button>
        </div>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading real backtest + live rank data…</p>}
      {error && <p className="text-xs text-red-400">Couldn't load swing universe data.</p>}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
            {displayed.slice(0, expanded ? undefined : 7).map((item) => (
              <div key={item.symbol} className="rounded-lg bg-secondary/40 border border-border/50 p-2 text-center">
                <div className="text-[9px] text-amber-400 font-bold">
                  {item.rank ? `#${item.rank}` : '—'}
                </div>
                <div className="text-[11px] font-mono font-bold truncate">{item.symbol}</div>
                <div className="text-[10px] text-emerald-400 font-mono font-bold">
                  PF {item.profitFactor.toFixed(2)}
                </div>
                <Badge variant="outline" className={cn(
                  "text-[8px] px-1 py-0 mt-1 uppercase font-bold",
                  item.openPosition ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : item.aligned ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                    : 'bg-secondary text-muted-foreground border-border/40'
                )}>
                  {item.openPosition ? 'HOLDING' : item.aligned ? 'READY' : 'PENDING'}
                </Badge>
              </div>
            ))}
          </div>

          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
          >
            {expanded ? 'Show only this week\'s eligible names' : `View all ${rows.length} proven symbols, ranked by real backtest PF`}
          </button>
        </>
      )}
    </div>
  );
}
