'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Activity, Thermometer, Flame, ShieldAlert, RotateCcw } from 'lucide-react';
import type { SchedulerState, PositionRules } from './types';

interface EngineStateCardProps {
  scheduler: SchedulerState | null;
  rules: PositionRules;
  onResetCircuitBreaker: () => void;
}

export function EngineStateCard({ scheduler, rules, onResetCircuitBreaker }: EngineStateCardProps) {
  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Activity className="h-4 w-4 text-primary" /> Today
          </h3>
          {scheduler && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Scans</span>
                <span className="font-mono font-bold">{scheduler.scanCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Entries</span>
                <span className="font-mono font-bold text-emerald-400">{scheduler.todayEntries}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Exits</span>
                <span className="font-mono font-bold text-red-400">{scheduler.todayExits}</span>
              </div>
              <div className="flex justify-between text-xs pt-2 border-t border-border/50">
                <span className="text-muted-foreground">Today P&L</span>
                <span className={cn('font-mono font-bold', scheduler.todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {scheduler.todayPnl >= 0 ? '+' : ''}₹{Math.round(scheduler.todayPnl).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Daily Limit</span>
                <span className={cn('font-mono',
                  scheduler.todayPnl < 0 && Math.abs(scheduler.todayPnl) >= rules.dailyLossLimit * 0.8 ? 'text-red-400 font-bold' : 'text-muted-foreground'
                )}>
                  ₹{rules.dailyLossLimit.toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* v2: Engine State Card */}
      <Card className="border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <Thermometer className="h-4 w-4 text-primary" /> Engine State
          </h3>
          <div className="space-y-2">
            {/* Nifty Regime */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Nifty Regime</span>
              <Badge variant="outline" className={cn('text-[10px] h-5',
                scheduler?.niftyRegime === 'BULLISH' ? 'text-emerald-400 border-emerald-500/30' :
                scheduler?.niftyRegime === 'BEARISH' ? 'text-red-400 border-red-500/30' : 'text-muted-foreground'
              )}>
                {scheduler?.niftyRegime || 'UNKNOWN'}
              </Badge>
            </div>
            {/* Adaptive Factor */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Size Factor</span>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all',
                    (scheduler?.lastAdaptiveFactor || 1) >= 0.8 ? 'bg-emerald-400' :
                    (scheduler?.lastAdaptiveFactor || 1) >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
                  )} style={{ width: `${((scheduler?.lastAdaptiveFactor || 1) * 100)}%` }} />
                </div>
                <span className={cn('font-mono w-8 text-right',
                  (scheduler?.lastAdaptiveFactor || 1) < 1 ? 'text-amber-400' : ''
                )}>{((scheduler?.lastAdaptiveFactor || 1) * 100).toFixed(0)}%</span>
              </div>
            </div>
            {/* Consecutive Losses */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Flame className="h-3 w-3" /> Loss Streak
              </span>
              <span className={cn('font-mono font-bold',
                (scheduler?.consecutiveLosses || 0) >= 3 ? 'text-red-400' :
                (scheduler?.consecutiveLosses || 0) >= 1 ? 'text-amber-400' : 'text-emerald-400'
              )}>{scheduler?.consecutiveLosses || 0}</span>
            </div>
            {/* Circuit Breaker */}
            {scheduler?.circuitBreaker && (
              <div className="mt-2 rounded-lg bg-red-500/10 p-2 border border-red-500/20">
                <div className="text-[10px] text-red-400 font-bold uppercase flex items-center gap-1">
                  <ShieldAlert className="h-3 w-3" /> Circuit Breaker Active
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {scheduler.circuitBreakerReason}
                </div>
                <Button variant="outline" size="sm" onClick={onResetCircuitBreaker}
                  className="mt-1.5 h-6 text-[10px] gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10">
                  <RotateCcw className="h-2.5 w-2.5" /> Reset
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}