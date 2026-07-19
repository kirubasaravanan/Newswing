'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Settings, ShieldAlert } from 'lucide-react';
import type { PositionRules, DrawdownData } from './types';

interface RulesPanelProps {
  rules: PositionRules;
  drawdown: DrawdownData | null;
  editingRules: boolean;
  ruleEdits: PositionRules & { scanIntervalMin?: number; exitIntervalMin?: number };
  onEditClick: () => void;
  onSave: () => void;
  onCancel: () => void;
  onRuleEditsChange: (edits: PositionRules & { scanIntervalMin?: number; exitIntervalMin?: number }) => void;
}

export function RulesPanel({
  rules, drawdown, editingRules, ruleEdits,
  onEditClick, onSave, onCancel, onRuleEditsChange,
}: RulesPanelProps) {
  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Settings className="h-4 w-4" /> Position & Risk Rules
          </h3>
          {!editingRules ? (
            <Button variant="ghost" size="sm" onClick={onEditClick} className="h-7 text-xs">Edit</Button>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" onClick={onSave} className="h-7 text-xs">Save</Button>
              <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-xs">Cancel</Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Position Sizing */}
          <div className="space-y-2">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Position Sizing</h4>
            {editingRules ? [
              { key: 'maxPerStock', label: 'Max/Stock (₹)', type: 'number' as const },
              { key: 'maxTotalPositions', label: 'Max Positions', type: 'number' as const },
              { key: 'riskPerTradePct', label: 'Risk/Trade (%)', type: 'number' as const },
              { key: 'maxBuysPerMonth', label: 'Buys/Month/Stock', type: 'number' as const },
              { key: 'maxSectorPct', label: 'Sector Cap (%)', type: 'number' as const },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between text-xs">
                <Label className="text-muted-foreground">{f.label}</Label>
                <Input type={f.type} value={(ruleEdits as any)[f.key]}
                  onChange={e => onRuleEditsChange({ ...ruleEdits, [f.key]: f.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value })}
                  className="h-7 w-24 text-xs text-right" />
              </div>
            )) : [
              { l: 'Max/Stock', v: `₹${rules.maxPerStock.toLocaleString()}` },
              { l: 'Max Positions', v: String(rules.maxTotalPositions) },
              { l: 'Risk/Trade', v: `${rules.riskPerTradePct}%` },
              { l: 'Buys/Month', v: String(rules.maxBuysPerMonth) },
              { l: 'Sector Cap', v: `${rules.maxSectorPct}%` },
            ].map(r => (
              <div key={r.l} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{r.l}</span><span className="font-mono">{r.v}</span>
              </div>
            ))}
          </div>

          {/* Exit Management */}
          <div className="space-y-2">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Exit Management</h4>
            {editingRules ? [
              { key: 'maxHoldingDays', label: 'Max Holding (d)' },
              { key: 'trailingStopR', label: 'Trail Start (R)' },
              { key: 'trailToR', label: 'Trail To (R)' },
              { key: 'atrTrailMultiplier', label: 'ATR Trail Mult' },
              { key: 'partialBookR', label: 'Partial At (R)' },
              { key: 'partialBookPct', label: 'Partial Book %' },
              { key: 'cooldownDays', label: 'Cooldown (d)' },
              { key: 'timeExitMins', label: 'Time Exit (min)' },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between text-xs">
                <Label className="text-muted-foreground">{f.label}</Label>
                <Input type="number" value={(ruleEdits as any)[f.key]}
                  onChange={e => onRuleEditsChange({ ...ruleEdits, [f.key]: parseFloat(e.target.value) || 0 })}
                  className="h-7 w-24 text-xs text-right" />
              </div>
            )) : [
              { l: 'Max Holding', v: `${rules.maxHoldingDays}d` },
              { l: 'Trail Start', v: `${rules.trailingStopR}R` },
              { l: 'Trail To', v: `${rules.trailToR}R` },
              { l: 'ATR Trail', v: `${rules.atrTrailMultiplier}x ATR` },
              { l: 'Partial', v: `${rules.partialBookPct}% @ ${rules.partialBookR}R` },
              { l: 'Cooldown', v: `${rules.cooldownDays}d` },
              { l: 'Time Exit', v: `${rules.timeExitMins}m` },
            ].map(r => (
              <div key={r.l} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{r.l}</span><span className="font-mono">{r.v}</span>
              </div>
            ))}
          </div>

          {/* v2: Risk Controls */}
          <div className="space-y-2">
            <h4 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> v2 Risk Controls
            </h4>
            {editingRules ? [
              { key: 'maxDrawdownPct', label: 'Max Drawdown (%)', type: 'number' as const },
              { key: 'dailyLossLimit', label: 'Daily Loss (₹)', type: 'number' as const },
              { key: 'niftyRegimeFilter', label: 'Nifty Regime', type: 'toggle' as const },
              { key: 'adaptiveSizing', label: 'Adaptive Sizing', type: 'toggle' as const },
              { key: 'streakPenaltyPct', label: 'Streak Penalty (%)', type: 'number' as const },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between text-xs">
                <Label className="text-muted-foreground">{f.label}</Label>
                {f.type === 'toggle' ? (
                  <Switch checked={(ruleEdits as any)[f.key] as boolean}
                    onCheckedChange={v => onRuleEditsChange({ ...ruleEdits, [f.key]: v })} className="scale-75" />
                ) : (
                  <Input type="number" value={(ruleEdits as any)[f.key]}
                    onChange={e => onRuleEditsChange({ ...ruleEdits, [f.key]: parseFloat(e.target.value) || 0 })}
                    className="h-7 w-24 text-xs text-right" />
                )}
              </div>
            )) : [
              { l: 'Max DD', v: `${rules.maxDrawdownPct}%`, warn: (drawdown?.drawdownPct || 0) >= rules.maxDrawdownPct * 0.7 },
              { l: 'Daily Limit', v: `₹${rules.dailyLossLimit.toLocaleString()}` },
              { l: 'Regime Filter', v: rules.niftyRegimeFilter ? 'ON' : 'OFF', active: rules.niftyRegimeFilter },
              { l: 'Adaptive', v: rules.adaptiveSizing ? 'ON' : 'OFF', active: rules.adaptiveSizing },
              { l: 'Streak Penalty', v: `${rules.streakPenaltyPct}%/loss` },
            ].map(r => (
              <div key={r.l} className="flex justify-between text-xs">
                <span className="text-muted-foreground">{r.l}</span>
                <span className={cn('font-mono', r.warn ? 'text-red-400 font-bold' : r.active ? 'text-emerald-400' : '')}>{r.v}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}