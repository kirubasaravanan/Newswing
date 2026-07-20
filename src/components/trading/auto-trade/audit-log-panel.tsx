'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { FileText, Plus, Minus, XCircle, RefreshCw, CheckCircle2 } from 'lucide-react';
import type { AutoTradeLog } from './types';

interface AuditLogPanelProps {
  logs: AutoTradeLog[];
  showAllLogs: boolean;
  selectedLog: AutoTradeLog | null;
  onShowAllLogsChange: (show: boolean) => void;
  onSelectedLogChange: (log: AutoTradeLog | null) => void;
  onRefresh: () => void;
}

export function AuditLogPanel({
  logs, showAllLogs, selectedLog,
  onShowAllLogsChange, onSelectedLogChange, onRefresh,
}: AuditLogPanelProps) {
  return (
    <>
      <Card className="border-border">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" /> Execution Audit Log
            </h3>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => onShowAllLogsChange(!showAllLogs)} className="h-7 text-xs gap-1">
                {showAllLogs ? 'Recent' : 'All'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onRefresh} className="h-7 text-xs gap-1">
                <RefreshCw className="h-3 w-3" /> Refresh
              </Button>
            </div>
          </div>
          <ScrollArea className="max-h-[500px]">
            <div className="space-y-1 pr-2">
              {(showAllLogs ? logs : logs.slice(0, 30)).map((log) => {
                const isEntry = log.action.includes('ENTRY');
                const isExit = log.action.includes('EXIT');
                const isPartial = log.action === 'PARTIAL_BOOK';
                return (
                  <div key={log.id}
                    className="flex items-start gap-2 text-xs py-2 px-2 rounded-lg hover:bg-secondary/30 cursor-pointer border-b border-border/30 last:border-0"
                    onClick={() => onSelectedLogChange(log)}>
                    <div className="mt-0.5 shrink-0">
                      {isEntry ? <Plus className="h-3 w-3 text-emerald-400" /> :
                       isPartial ? <Minus className="h-3 w-3 text-amber-400" /> :
                       isExit ? <XCircle className="h-3 w-3 text-red-400" /> :
                       <RefreshCw className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold">{log.symbol}</span>
                        <Badge variant="outline" className={cn('text-[9px] h-3.5 px-1',
                          isEntry ? 'text-emerald-400' : isPartial ? 'text-amber-400' : isExit ? 'text-red-400' : 'text-muted-foreground'
                        )}>
                          {log.action.replace('AUTO_', '')}
                        </Badge>
                        {log.executed ? <CheckCircle2 className="h-3 w-3 text-emerald-400/50" /> : <XCircle className="h-3 w-3 text-red-400/50" />}
                      </div>
                      <p className="text-muted-foreground truncate">{log.reason}</p>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-[10px]">
                      {new Date(log.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Log Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={() => onSelectedLogChange(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {selectedLog?.symbol} — {selectedLog?.action.replace('AUTO_', '')}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground">Action</div>
                  <div className="font-mono">{selectedLog.action}</div>
                </div>
                <div className="rounded bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground">Executed</div>
                  <div className={selectedLog.executed ? 'text-emerald-400' : 'text-red-400'}>
                    {selectedLog.executed ? 'Yes' : 'No'}
                  </div>
                </div>
                <div className="rounded bg-secondary/50 p-2 col-span-2">
                  <div className="text-[10px] text-muted-foreground">Time</div>
                  <div className="font-mono">{new Date(selectedLog.createdAt).toLocaleString()}</div>
                </div>
              </div>
              <div className="rounded bg-secondary/50 p-2">
                <div className="text-[10px] text-muted-foreground mb-1">Reason</div>
                <div className="text-[11px]">{selectedLog.reason}</div>
              </div>
              {selectedLog.signal && (
                <div className="rounded bg-secondary/50 p-2">
                  <div className="text-[10px] text-muted-foreground mb-1">Signal Details</div>
                  <pre className="text-[10px] text-muted-foreground overflow-auto max-h-[200px] whitespace-pre-wrap">
                    {(() => { try { return JSON.stringify(JSON.parse(selectedLog.signal), null, 2); } catch { return selectedLog.signal; } })()}
                  </pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <DialogClose asChild><Button variant="ghost" size="sm">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}