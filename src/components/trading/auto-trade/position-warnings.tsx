'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface PositionWarningsProps {
  exitWarnings: any[];
}

export function PositionWarnings({ exitWarnings }: PositionWarningsProps) {
  if (exitWarnings.length === 0) return null;

  return (
    <Card className={cn('border-amber-500/30 bg-amber-500/5',
      exitWarnings.some((w: any) => w.healthUrgency === 'CRITICAL') ? 'border-red-500/30 bg-red-500/5' : ''
    )}>
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          Position Warnings ({exitWarnings.length})
        </h3>
        <div className="space-y-1.5">
          {exitWarnings.map((w: any, i: number) => (
            <div key={i} className={cn(
              'flex items-center gap-2 text-xs px-3 py-2 rounded-lg',
              w.healthUrgency === 'CRITICAL' ? 'bg-red-500/10' : 'bg-amber-500/10'
            )}>
              <Badge variant="outline" className={cn('text-[9px] h-4',
                w.healthUrgency === 'CRITICAL' ? 'text-red-400 border-red-500/30' : 'text-amber-400 border-amber-500/30'
              )}>{w.healthUrgency === 'CRITICAL' ? 'CRITICAL' : 'WARNING'}</Badge>
              <span className="font-semibold">{w.symbol}</span>
              {/* Health Score Bar */}
              <div className="flex items-center gap-1.5 flex-1">
                <div className="flex-1 max-w-[80px] h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all',
                    w.healthScore >= 70 ? 'bg-emerald-400' :
                    w.healthScore >= 40 ? 'bg-amber-400' : 'bg-red-400'
                  )} style={{ width: `${w.healthScore}%` }} />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">{w.healthScore}/100</span>
              </div>
              <span className="text-muted-foreground truncate max-w-[200px]">{w.message}</span>
              <span className={cn('ml-auto font-mono shrink-0', (w.pnlPercent || 0) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {w.pnlPercent >= 0 ? '+' : ''}{w.pnlPercent?.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}