'use client';

import { BarChart3 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OptionChainTab } from './options-chain-tab';
import { NewTradeTab } from './new-trade-tab';
import { PositionsTab } from './positions-tab';
import { StrategiesTab } from './strategies-tab';
import { OptionsAnalyticsTab } from './options-analytics-tab';

export function OptionsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10">
          <BarChart3 className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold">Options Trading</h1>
          <p className="text-xs text-muted-foreground">Black-Scholes priced chain with Greeks-based risk management</p>
        </div>
      </div>

      <Tabs defaultValue="chain" className="space-y-4">
        <TabsList className="bg-secondary/50 h-9 p-0.5">
          <TabsTrigger value="chain" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Option Chain
          </TabsTrigger>
          <TabsTrigger value="trade" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            New Trade
          </TabsTrigger>
          <TabsTrigger value="positions" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Positions
          </TabsTrigger>
          <TabsTrigger value="strategies" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Strategies
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs px-3 h-8 data-[state=active]:bg-indigo-600 data-[state=active]:text-white">
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chain"><OptionChainTab /></TabsContent>
        <TabsContent value="trade"><NewTradeTab /></TabsContent>
        <TabsContent value="positions"><PositionsTab /></TabsContent>
        <TabsContent value="strategies"><StrategiesTab /></TabsContent>
        <TabsContent value="analytics"><OptionsAnalyticsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

export default OptionsTab;