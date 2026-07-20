'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchSafe, fmt } from './helpers';
import type { Position } from './types';

function PositionsTab() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [summary, setSummary] = useState({ totalMargin: 0, totalUnrealizedPnl: 0, positionCount: 0 });
  const [loading, setLoading] = useState(true);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [closePremium, setClosePremium] = useState('');
  const [closeReason, setCloseReason] = useState('MANUAL');
  const [showAll, setShowAll] = useState(false);
  const [allTrades, setAllTrades] = useState<any[]>([]);

  const fetchPositions = useCallback(async () => {
    setLoading(true);
    const [posData, tradesData] = await Promise.all([
      fetchSafe('/api/options/positions'),
      fetchSafe('/api/options/trades?status=ALL'),
    ]);
    if (posData?.success) {
      setPositions(posData.positions);
      setSummary(posData.summary);
    }
    if (tradesData?.success) {
      setAllTrades(tradesData.trades || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchPositions(); }, []);

  const handleClose = async () => {
    if (!closeId || !closePremium) return;
    await fetch('/api/options/trades', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: closeId, exitPremium: parseFloat(closePremium), exitReason: closeReason }),
    }).catch(() => null);
    setCloseId(null);
    setClosePremium('');
    fetchPositions();
  };

  const displayTrades = showAll ? allTrades : positions;

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Total Margin</div>
          <div className="text-lg font-bold">₹{summary.totalMargin.toLocaleString()}</div>
        </Card>
        <Card className={cn('p-3', summary.totalUnrealizedPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20')}>
          <div className="text-[10px] text-muted-foreground">Unrealized P&L</div>
          <div className={cn('text-lg font-bold', summary.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            ₹{summary.totalUnrealizedPnl.toLocaleString()}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] text-muted-foreground">Open Positions</div>
          <div className="text-lg font-bold">{summary.positionCount}</div>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant={showAll ? 'outline' : 'default'}
          size="sm"
          onClick={() => setShowAll(false)}
          className="h-7 text-xs"
        >
          Open ({positions.length})
        </Button>
        <Button
          variant={showAll ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowAll(true)}
          className="h-7 text-xs"
        >
          All Trades ({allTrades.length})
        </Button>
        <Button variant="ghost" size="sm" onClick={fetchPositions} className="h-7 text-xs ml-auto">
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
      </div>

      {/* Position Cards */}
      {loading ? (
        <div className="text-center text-muted-foreground text-sm py-8">Loading positions...</div>
      ) : displayTrades.length === 0 ? (
        <div className="text-center text-muted-foreground text-sm py-8">No trades yet. Create one from the New Trade tab.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayTrades.map((trade: any) => {
            const pnl = trade.unrealizedPnl ?? trade.pnl ?? 0;
            const pnlPct = trade.unrealizedPnlPct ?? trade.pnlPercent ?? 0;
            const isOpen = trade.status === 'OPEN';
            const dte = trade.expiryDate ? Math.max(0, Math.ceil((new Date(trade.expiryDate + 'T15:30:00+05:30').getTime() - Date.now()) / 86400000)) : 0;

            return (
              <Card key={trade.id} className={cn('overflow-hidden', !isOpen && 'opacity-60')}>
                <CardContent className="p-3 space-y-2">
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{trade.symbol}</span>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5', trade.optionType === 'CE' ? 'border-emerald-500/50 text-emerald-400' : 'border-red-500/50 text-red-400')}>
                        {trade.optionType}
                      </Badge>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5', trade.action === 'BUY' ? 'border-blue-500/50 text-blue-400' : 'border-orange-500/50 text-orange-400')}>
                        {trade.action}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5">
                        {trade.strikePrice}
                      </Badge>
                    </div>
                    {isOpen && dte < 2 && (
                      <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">⚠ {dte}d left</Badge>
                    )}
                  </div>

                  {/* Prices */}
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">Entry</div>
                      <div className="font-medium">₹{trade.entryPremium}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Current</div>
                      <div className="font-medium">₹{trade.currentPremium ?? '—'}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Lot×Qty</div>
                      <div className="font-medium">{trade.lotSize}×{trade.qty}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Expiry</div>
                      <div className={cn('font-medium', dte < 3 && 'text-red-400')}>{trade.expiryDate} ({dte}d)</div>
                    </div>
                  </div>

                  {/* P&L */}
                  <div className={cn(
                    'rounded-lg p-2 text-center text-sm font-bold',
                    pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  )}>
                    {pnl >= 0 ? '+' : ''}₹{pnl.toLocaleString()} ({pnl >= 0 ? '+' : ''}{fmt(pnlPct)}%)
                  </div>

                  {/* Greeks at Entry */}
                  {(trade.entryDelta != null) && (
                    <div className="flex gap-3 text-[10px] text-muted-foreground">
                      <span>Δ {fmt(trade.entryDelta)}</span>
                      <span>Γ {fmt(trade.entryGamma, 4)}</span>
                      <span>Θ {fmt(trade.entryTheta)}</span>
                      <span>ν {fmt(trade.entryVega)}</span>
                      <span>IV {fmt(trade.entryIV)}%</span>
                    </div>
                  )}

                  {/* SL/TP */}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-red-400">SL: ₹{trade.stopLoss ?? '—'}</span>
                    <span className="text-emerald-400">TP: ₹{trade.takeProfit ?? '—'}</span>
                    {!isOpen && trade.exitReason && (
                      <Badge variant="outline" className="text-[10px]">{trade.exitReason}</Badge>
                    )}
                  </div>

                  {/* Close Button */}
                  {isOpen && (
                    <Dialog open={closeId === trade.id} onOpenChange={(open) => !open && setCloseId(null)}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="w-full h-7 text-xs" onClick={() => setCloseId(trade.id)}>
                          Close Position
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-sm">
                        <DialogHeader>
                          <DialogTitle className="text-sm">Close Position</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="text-xs text-muted-foreground">
                            {trade.symbol} {trade.strikePrice} {trade.optionType} {trade.action}
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Exit Premium</Label>
                            <Input type="number" value={closePremium} onChange={(e) => setClosePremium(e.target.value)} className="h-9 text-sm" placeholder={String(trade.currentPremium || trade.entryPremium)} step="0.5" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Exit Reason</Label>
                            <Select value={closeReason} onValueChange={setCloseReason}>
                              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="MANUAL">Manual</SelectItem>
                                <SelectItem value="SL_HIT">Stop Loss Hit</SelectItem>
                                <SelectItem value="TP_HIT">Take Profit Hit</SelectItem>
                                <SelectItem value="THETA_DECAY">Theta Decay</SelectItem>
                                <SelectItem value="EXPIRED">Expired</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <Button onClick={handleClose} className="w-full h-9 bg-indigo-600 hover:bg-indigo-700">
                            Close Trade
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { PositionsTab };