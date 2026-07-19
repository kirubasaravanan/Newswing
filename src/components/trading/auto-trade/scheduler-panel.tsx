'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Timer, Zap, ArrowRightLeft } from 'lucide-react';
import type { SchedulerState, PositionRules } from './types';

interface SchedulerPanelProps {
  scheduler: SchedulerState | null;
  rules: PositionRules;
  marketHours: boolean;
  ruleEdits: PositionRules & { scanIntervalMin?: number; exitIntervalMin?: number };
  onRuleEditsChange: (edits: PositionRules & { scanIntervalMin?: number; exitIntervalMin?: number }) => void;
  onSchedulerToggle: (enabled: boolean) => void;
}

export function SchedulerPanel({
  scheduler, rules, marketHours, ruleEdits,
  onRuleEditsChange, onSchedulerToggle,
}: SchedulerPanelProps) {
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Timer className="h-4 w-4 text-primary" /> Automation Scheduler
            </h3>
            <p className="text-[10px] text-muted-foreground mt-1">
              V-Swing universe scan + PMS risk-managed exits during 9:15 AM - 3:30 PM IST
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={cn('text-xs', marketHours ? 'text-emerald-400' : 'text-muted-foreground')}>
              {marketHours ? 'OPEN' : 'CLOSED'}
            </span>
            <Switch
              checked={scheduler?.enabled || false}
              onCheckedChange={onSchedulerToggle}
              disabled={!!scheduler?.circuitBreaker}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg bg-secondary/50 p-4 space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-2">
              <Zap className="h-3 w-3 text-emerald-400" /> Entry Scan
            </h4>
            <div className="flex items-center justify-between text-xs">
              <Label className="text-muted-foreground">Interval (min)</Label>
              <Input type="number" value={ruleEdits.scanIntervalMin || 30}
                onChange={e => onRuleEditsChange({ ...ruleEdits, scanIntervalMin: parseInt(e.target.value) || 30 })}
                className="h-7 w-20 text-xs text-right" />
            </div>
            <div className="text-[10px] text-muted-foreground space-y-1">
              <p>Full universe L1→L2 scan with regime filter, circuit breaker, and adaptive sizing.</p>
              {scheduler?.circuitBreaker && (
                <p className="text-red-400 font-semibold">BLOCKED by circuit breaker</p>
              )}
              {scheduler?.niftyRegime === 'BEARISH' && rules.niftyRegimeFilter && (
                <p className="text-amber-400">BLOCKED by bearish regime filter</p>
              )}
            </div>
          </div>
          <div className="rounded-lg bg-secondary/50 p-4 space-y-3">
            <h4 className="text-xs font-semibold flex items-center gap-2">
              <ArrowRightLeft className="h-3 w-3 text-red-400" /> Exit Check
            </h4>
            <div className="flex items-center justify-between text-xs">
              <Label className="text-muted-foreground">Interval (min)</Label>
              <Input type="number" value={ruleEdits.exitIntervalMin || 5}
                onChange={e => onRuleEditsChange({ ...ruleEdits, exitIntervalMin: parseInt(e.target.value) || 5 })}
                className="h-7 w-20 text-xs text-right" />
            </div>
            <p className="text-[10px] text-muted-foreground">
              SL/TP, {rules.atrTrailMultiplier > 0 ? 'ATR-based' : 'R-based'} trailing stop, stale loser exit, time exit, partial booking.
            </p>
          </div>
        </div>

        {/* Timeline */}
        {scheduler && (
          <div className="mt-4 rounded-lg bg-secondary/30 p-3">
            <h4 className="text-[10px] text-muted-foreground uppercase mb-2">Timeline</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Last Scan</span>
                <div className="font-mono text-[11px]">{scheduler.lastScanAt ? new Date(scheduler.lastScanAt).toLocaleTimeString() : '--'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Last Exit</span>
                <div className="font-mono text-[11px]">{scheduler.lastExitAt ? new Date(scheduler.lastExitAt).toLocaleTimeString() : '--'}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                <div className={cn('font-mono text-[11px]',
                  scheduler.circuitBreaker ? 'text-red-400' : scheduler.enabled ? 'text-emerald-400' : 'text-muted-foreground'
                )}>
                  {scheduler.circuitBreaker ? 'HALTED' : scheduler.enabled ? 'ARMED' : 'DISARMED'}
                </div>
              </div>
              <div>
                <span className="text-muted-foreground">Regime</span>
                <div className={cn('font-mono text-[11px]',
                  scheduler.niftyRegime === 'BULLISH' ? 'text-emerald-400' :
                  scheduler.niftyRegime === 'BEARISH' ? 'text-red-400' : 'text-muted-foreground'
                )}>{scheduler.niftyRegime}</div>
              </div>
              <div>
                <span className="text-muted-foreground">Market</span>
                <div className={cn('font-mono text-[11px]', marketHours ? 'text-emerald-400' : 'text-red-400')}>
                  {marketHours ? 'OPEN' : 'CLOSED'}
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}