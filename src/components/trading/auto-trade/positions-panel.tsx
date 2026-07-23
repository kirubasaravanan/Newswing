'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { TrendingUp } from 'lucide-react';
import { TradingViewChart } from '../tradingview-chart';
import type { OpenPosition, PositionRules } from './types';

interface PositionsPanelProps {
  openPositions: OpenPosition[];
  rules: PositionRules;
  chartSymbol: string | null;
  onChartSymbolChange: (symbol: string | null) => void;
}

export function PositionsPanel({
  openPositions, rules, chartSymbol, onChartSymbolChange,
}: PositionsPanelProps) {
  return (
    <>
      <Card className="border-border">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4" /> Open Auto-Positions ({openPositions.length})
          </h3>
          {openPositions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-muted-foreground">No open positions. Run Scan & Trade to find entries.</p>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2 pr-2">
                {openPositions.map(pos => {
                  const days = Math.floor((Date.now() - new Date(pos.entryDate).getTime()) / 86400000);
                  const risk = pos.entryPrice - pos.stopLoss;
                  const agePct = rules.maxHoldingDays > 0 ? (days / rules.maxHoldingDays) * 100 : 0;
                  const isPartial = pos.tags?.includes('partial-booked');
                  const rrRatio = risk > 0 ? (pos.targetPrice - pos.entryPrice) / risk : 0;
                  return (
                    <div key={pos.id}
                      className={cn(
                        'rounded-lg p-3 cursor-pointer hover:bg-secondary/80 transition',
                        agePct >= 80 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-secondary/50'
                      )}
                      onClick={() => onChartSymbolChange(pos.symbol)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{pos.symbol}</span>
                          <Badge variant="outline" className="text-[10px] h-4">AUTO</Badge>
                          {isPartial && <Badge variant="outline" className="text-[10px] h-4 text-amber-400 border-amber-500/30">PARTIAL</Badge>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={cn('text-[10px]', agePct >= 80 ? 'text-amber-400 font-bold' : 'text-muted-foreground')}>
                            {days}/{rules.maxHoldingDays}d
                          </span>
                          <span className="text-xs font-mono font-semibold">₹{pos.entryPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                          <span className="text-[10px] text-muted-foreground">x{pos.qty}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-4 text-[10px]">
                        <span className="text-red-400 font-mono">SL: ₹{pos.stopLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                        <span className="text-emerald-400 font-mono">TP: ₹{pos.targetPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                        <span className="text-muted-foreground">
                          Risk: ₹{risk > 0 ? (risk * pos.qty).toLocaleString('en-IN', { maximumFractionDigits: 0 }) : 'N/A'}
                        </span>
                        <span className="text-muted-foreground font-semibold">
                          {rrRatio > 0 ? `R:R ${rrRatio.toFixed(1)}x` : ''}
                        </span>
                        {/* v2: Show which factors are in tags */}
                        {pos.tags && (
                          <div className="flex gap-1 ml-auto">
                            {pos.tags.split(',').filter(t => ['aplus', 'b'].includes(t)).map(t => (
                              <Badge key={t} variant="outline" className={cn('text-[9px] h-4',
                                t === 'aplus' ? 'text-emerald-400 border-emerald-500/30' : 'text-blue-400 border-blue-500/30'
                              )}>{t.toUpperCase()}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Aging bar */}
                      {agePct >= 50 && (
                        <div className="mt-2 h-1 rounded-full bg-secondary overflow-hidden">
                          <div className={cn('h-full rounded-full transition-all', agePct >= 80 ? 'bg-amber-400' : 'bg-blue-400')}
                            style={{ width: `${Math.min(100, agePct)}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {chartSymbol && (
        <Card className="border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{chartSymbol} — TradingView</h3>
              <Button variant="ghost" size="sm" onClick={() => onChartSymbolChange(null)} className="h-7 text-xs">Close</Button>
            </div>
            <TradingViewChart symbol={chartSymbol} height={450} />
          </CardContent>
        </Card>
      )}
    </>
  );
}