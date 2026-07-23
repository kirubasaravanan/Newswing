'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Activity, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LivePosition {
  id: string;
  symbol: string;
  direction: string;
  entryPrice: number;
  currentPrice: number;
  qty: number;
  stopLoss: number;
  targetPrice: number;
  pnl: number;
  pnlPercent: number;
  rMultiple: number;
  maxLoss: number;
  maxProfit: number;
  entryDate: string;
  holdingDays: number;
}

export function LivePnlTracker() {
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [totalPnL, setTotalPnL] = useState(0);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPnL = useCallback(async () => {
    try {
      const res = await fetch('/api/live-pnl');
      const data = await res.json();
      if (data.success) {
        setPositions(data.positions);
        setTotalPnL(data.totalPnL);
        setLastUpdated(new Date().toLocaleTimeString());
      }
    } catch (err) {
      console.error('Live P&L error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPnL();
    // Auto-refresh every 60 seconds
    intervalRef.current = setInterval(fetchPnL, 60000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPnL]);

  if (positions.length === 0 && !loading) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Live P&L Tracker</h3>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{positions.length} open</Badge>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-[10px] text-muted-foreground">Updated: {lastUpdated}</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => { setLoading(true); fetchPnL(); }}
          >
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Total P&L Bar */}
      <Card className={cn(
        'border',
        totalPnL >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'
      )}>
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Combined Open P&L</span>
            <span className={cn(
              'text-sm font-mono font-bold',
              totalPnL >= 0 ? 'text-emerald-400' : 'text-red-400'
            )}>
              {totalPnL >= 0 ? '+' : ''}₹{Math.round(totalPnL).toLocaleString()}
            </span>
          </div>
          {positions.length > 0 && (
            <div className="space-y-1.5">
              {positions.map(pos => {
                const progress = pos.maxProfit > 0
                  ? Math.max(0, Math.min(100, (pos.pnl / pos.maxProfit) * 100))
                  : 0;
                const slProgress = pos.maxLoss > 0
                  ? Math.max(0, Math.min(100, (-pos.pnl / pos.maxLoss) * 100))
                  : 0;
                const isProfit = pos.pnl >= 0;

                return (
                  <div key={pos.id} className="flex items-center gap-2 group">
                    <div className="w-16 text-xs font-mono font-medium shrink-0">{pos.symbol}</div>
                    <div className="flex-1">
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden relative">
                        {/* SL side (red from left) */}
                        {!isProfit && (
                          <div
                            className="absolute inset-y-0 left-0 bg-red-500/60 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(slProgress, 100)}%` }}
                          />
                        )}
                        {/* Profit side (green from center) */}
                        {isProfit && (
                          <div
                            className="absolute inset-y-0 left-1/2 bg-emerald-500/60 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(progress, 100)}%` }}
                          />
                        )}
                        {/* Center line (breakeven) */}
                        <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/30" />
                      </div>
                    </div>
                    <div className={cn(
                      'w-20 text-right text-xs font-mono font-semibold shrink-0',
                      isProfit ? 'text-emerald-400' : 'text-red-400'
                    )}>
                      {pos.pnl >= 0 ? '+' : ''}₹{Math.round(pos.pnl).toLocaleString()}
                    </div>
                    <div className={cn(
                      'w-14 text-right text-[10px] font-mono shrink-0',
                      isProfit ? 'text-emerald-400/70' : 'text-red-400/70'
                    )}>
                      {(pos.pnlPercent || 0) >= 0 ? '+' : ''}{(pos.pnlPercent || 0).toFixed(2)}%
                    </div>
                    <Badge variant="outline" className={cn(
                      'w-12 text-center text-[9px] px-1 py-0 shrink-0',
                      (pos.rMultiple || 0) >= 1 ? 'text-emerald-400 border-emerald-500/30' :
                      (pos.rMultiple || 0) >= 0 ? 'text-amber-400 border-amber-500/30' :
                      'text-red-400 border-red-500/30'
                    )}>
                      {(pos.rMultiple || 0) >= 0 ? '+' : ''}{(pos.rMultiple || 0).toFixed(1)}R
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Position Detail Cards */}
      {positions.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {positions.map(pos => (
            <Card key={pos.id} className={cn(
              'border transition-all',
              pos.pnl > 0 ? 'border-emerald-500/15' :
              pos.pnl < 0 ? 'border-red-500/15' : 'border-border'
            )}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {pos.direction === 'LONG' ? (
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <span className="font-semibold text-sm">{pos.symbol}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {pos.holdingDays}d held
                    </Badge>
                  </div>
                  <span className={cn(
                    'text-sm font-mono font-bold',
                    pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                  )}>
                    {pos.pnl >= 0 ? '+' : ''}₹{Math.round(pos.pnl || 0).toLocaleString()}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  <div className="rounded bg-secondary/50 px-2 py-1.5">
                    <div className="text-muted-foreground">Entry</div>
                    <div className="font-mono font-semibold">₹{pos.entryPrice}</div>
                  </div>
                  <div className="rounded bg-secondary/50 px-2 py-1.5">
                    <div className="text-muted-foreground">Current</div>
                    <div className={cn('font-mono font-semibold', (pos.pnl || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      ₹{pos.currentPrice != null ? pos.currentPrice.toFixed(2) : '--'}
                    </div>
                  </div>
                  <div className="rounded bg-secondary/50 px-2 py-1.5">
                    <div className="text-muted-foreground">R-Multiple</div>
                    <div className={cn('font-mono font-semibold', (pos.rMultiple || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {(pos.rMultiple || 0) >= 0 ? '+' : ''}{(pos.rMultiple || 0).toFixed(2)}R
                    </div>
                  </div>
                </div>

                {/* SL/TP progress bar */}
                <div className="mt-2">
                  <div className="flex justify-between text-[9px] text-muted-foreground mb-0.5">
                    <span>SL: ₹{pos.stopLoss}</span>
                    <span>Entry</span>
                    <span>TP: ₹{pos.targetPrice}</span>
                  </div>
                  <div className="h-1 rounded-full bg-secondary overflow-hidden relative">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/20" />
                    {pos.pnl >= 0 ? (
                      <div
                        className="absolute inset-y-0 left-1/2 bg-emerald-500/50 rounded-r-full transition-all duration-500"
                        style={{ width: `${Math.min((pos.pnl / pos.maxProfit) * 50, 50)}%` }}
                      />
                    ) : (
                      <div
                        className="absolute inset-y-0 right-1/2 bg-red-500/50 rounded-l-full transition-all duration-500"
                        style={{ width: `${Math.min((Math.abs(pos.pnl) / pos.maxLoss) * 50, 50)}%` }}
                      />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}