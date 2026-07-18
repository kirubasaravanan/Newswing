'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { Shield, CheckCircle2, AlertTriangle, XCircle, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  passed: boolean;
  critical: boolean; // if false, it's a warning (nice-to-have)
}

interface TradeQualityChecklistProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  checklistItems: ChecklistItem[];
  symbol: string;
}

export function TradeQualityChecklist({ open, onClose, onConfirm, checklistItems, symbol }: TradeQualityChecklistProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // Reset checked state when items change
  useEffect(() => {
    setChecked({});
  }, [checklistItems]);

  const criticalCount = checklistItems.filter(i => i.critical).length;
  const passedCritical = checklistItems.filter(i => i.critical && i.passed).length;
  const passedWarning = checklistItems.filter(i => !i.critical && i.passed).length;
  const failedCritical = criticalCount - passedCritical;

  // User must manually check all critical items
  const allCriticalChecked = checklistItems
    .filter(i => i.critical)
    .every(i => checked[i.id]);

  const canProceed = allCriticalChecked && failedCritical === 0;
  const qualityScore = Math.round(((passedCritical + passedWarning) / checklistItems.length) * 100);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Pre-Trade Quality Check
          </DialogTitle>
        </DialogHeader>

        {/* Quality Score */}
        <div className="flex items-center gap-4 mb-2">
          <div className={cn(
            'flex h-14 w-14 items-center justify-center rounded-xl text-lg font-bold',
            qualityScore >= 80 ? 'bg-emerald-500/15 text-emerald-400' :
            qualityScore >= 50 ? 'bg-amber-500/15 text-amber-400' :
            'bg-red-500/15 text-red-400'
          )}>
            {qualityScore}%
          </div>
          <div>
            <div className="text-sm font-semibold">{symbol} — Setup Quality</div>
            <div className="text-xs text-muted-foreground">
              {passedCritical}/{criticalCount} critical checks passed
              {failedCritical > 0 && (
                <span className="text-red-400 ml-1">({failedCritical} failed)</span>
              )}
            </div>
          </div>
        </div>

        {/* Checklist Items */}
        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
          {checklistItems.map(item => (
            <div key={item.id} className={cn(
              'flex items-start gap-3 rounded-lg border p-3 transition-colors',
              item.passed
                ? item.critical ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-emerald-500/10 bg-emerald-500/3'
                : item.critical ? 'border-red-500/20 bg-red-500/5' : 'border-amber-500/15 bg-amber-500/3'
            )}>
              <Checkbox
                checked={checked[item.id] || false}
                onCheckedChange={(v) => setChecked(prev => ({ ...prev, [item.id]: !!v }))}
                disabled={!item.passed && item.critical}
                className={cn(
                  'mt-0.5',
                  item.passed ? 'border-emerald-500 data-[state=checked]:bg-emerald-500' :
                  item.critical ? 'border-red-500' : 'border-amber-500'
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {item.passed ? (
                    <CheckCircle2 className={cn('h-3.5 w-3.5 shrink-0', item.critical ? 'text-emerald-400' : 'text-emerald-400/60')} />
                  ) : item.critical ? (
                    <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className={cn(
                    'text-sm font-medium',
                    !item.passed && item.critical ? 'text-red-400' : ''
                  )}>
                    {item.label}
                  </span>
                  {item.critical && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-400 border-red-500/30">Required</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 ml-5.5">{item.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Warning message if critical failed */}
        {failedCritical > 0 && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
            <strong>{failedCritical} critical check{failedCritical > 1 ? 's' : ''} failed.</strong> You can still acknowledge and proceed, but this trade may not meet V-Swing quality standards.
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={onConfirm}
            disabled={failedCritical > 0 && !allCriticalChecked}
            className={cn(
              canProceed ? '' : 'bg-amber-600 hover:bg-amber-700'
            )}
          >
            <Shield className="h-4 w-4 mr-2" />
            {canProceed ? 'Confirm Entry' : 'Acknowledge & Proceed'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}