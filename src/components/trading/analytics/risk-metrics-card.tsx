'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Risk Metrics Card ─────────────────────────────────
function RiskMetricsCard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/portfolio/risk-metrics');
      const data = await res.json();
      if (data.success) setMetrics(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 mx-auto animate-spin" /></div>;
  if (!metrics || metrics.tradeCount < 2) return <p className="text-center py-8 text-muted-foreground text-sm">Need at least 2 closed trades for risk metrics.</p>;

  const m = metrics.metrics;
  const items = [
    { label: 'Sharpe Ratio', value: m.sharpe.toFixed(2), color: m.sharpe >= 1 ? 'text-emerald-400' : m.sharpe >= 0 ? 'text-amber-400' : 'text-red-400', desc: m.sharpe >= 1 ? 'Good' : m.sharpe >= 0 ? 'Moderate' : 'Poor' },
    { label: 'Sortino Ratio', value: m.sortino.toFixed(2), color: m.sortino >= 1.5 ? 'text-emerald-400' : 'text-amber-400', desc: 'Downside risk adjusted' },
    { label: 'Max Drawdown', value: `${m.maxDD.toFixed(1)}%`, color: 'text-red-400', desc: 'Worst peak-to-trough' },
    { label: 'Calmar Ratio', value: m.calmar.toFixed(2), color: m.calmar >= 1 ? 'text-emerald-400' : 'text-amber-400', desc: 'Return / MaxDD' },
    { label: 'VaR (95%)', value: `${m.var95.toFixed(2)}%`, color: 'text-red-400', desc: 'Worst 5% day loss' },
    { label: 'CAGR', value: `${m.cagr.toFixed(1)}%`, color: m.cagr >= 15 ? 'text-emerald-400' : 'text-amber-400', desc: 'Annualized return' },
    { label: 'Expectancy', value: `${m.expectancy?.toFixed(2) || 0}%`, color: (m.expectancy || 0) > 0 ? 'text-emerald-400' : 'text-red-400', desc: 'Avg win% x WR - Avg loss% x LR' },
    { label: 'Avg R-Multiple', value: `${m.avgRMultiple?.toFixed(2) || 0}R`, color: (m.avgRMultiple || 0) >= 1 ? 'text-emerald-400' : 'text-red-400', desc: 'Avg profit / risk per trade' },
    { label: 'Profit Factor', value: m.profitFactor?.toFixed(2) || '0', color: (m.profitFactor || 0) >= 1.5 ? 'text-emerald-400' : 'text-amber-400', desc: 'Gross profit / gross loss' },
    { label: 'Avg Holding', value: `${m.avgHoldingDays}d`, color: 'text-indigo-400', desc: 'Average trade duration' },
    { label: 'Best Trade', value: `${m.bestTrade?.toFixed(1) || 0}%`, color: 'text-emerald-400', desc: '' },
    { label: 'Worst Trade', value: `${m.worstTrade?.toFixed(1) || 0}%`, color: 'text-red-400', desc: '' },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 gap-3">
      {items.map(item => (
        <div key={item.label} className="rounded-lg bg-secondary/50 p-3">
          <div className="text-[10px] text-muted-foreground uppercase">{item.label}</div>
          <div className={cn('text-lg font-bold font-mono mt-0.5', item.color)}>{item.value}</div>
          {item.desc && <div className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</div>}
        </div>
      ))}
    </div>
  );
}

export default RiskMetricsCard;