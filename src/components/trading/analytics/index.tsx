'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BarChart3, RefreshCw } from 'lucide-react';
import RiskMetricsCard from './risk-metrics-card';
import BenchmarkChart from './benchmark-chart';
import AlertsPanel from './alerts-panel';
import CapitalGainsReport from './capital-gains-report';
import RebalancePanel from './rebalance-panel';
import SIPTracker from './sip-tracker';
import DividendTracker from './dividend-tracker';
import RMultipleDistribution from './r-multiple-distribution';
import EquityCurveCard from './equity-curve-card';
import AnalyticsOverview from './analytics-overview';

// ── Main Analytics Tab ─────────────────────────────────
export function AnalyticsTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="h-5 w-5 text-indigo-400" /> Analytics</h2>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start mb-4">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="risk" className="text-xs">Risk Metrics</TabsTrigger>
          <TabsTrigger value="rmultiple" className="text-xs">R-Multiples</TabsTrigger>
          <TabsTrigger value="equity" className="text-xs">Equity Curve</TabsTrigger>
          <TabsTrigger value="benchmark" className="text-xs">Benchmark</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs">Alerts</TabsTrigger>
          <TabsTrigger value="tax" className="text-xs">Capital Gains</TabsTrigger>
          <TabsTrigger value="rebalance" className="text-xs">Rebalance</TabsTrigger>
          <TabsTrigger value="sip" className="text-xs">SIP</TabsTrigger>
          <TabsTrigger value="dividends" className="text-xs">Dividends</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><Card className="border-border"><CardContent className="p-4"><AnalyticsOverview /></CardContent></Card></TabsContent>
        <TabsContent value="risk"><Card className="border-border"><CardContent className="p-4"><RiskMetricsCard /></CardContent></Card></TabsContent>
        <TabsContent value="rmultiple"><Card className="border-border"><CardContent className="p-4"><RMultipleDistribution /></CardContent></Card></TabsContent>
        <TabsContent value="equity"><Card className="border-border"><CardContent className="p-4"><EquityCurveCard /></CardContent></Card></TabsContent>
        <TabsContent value="benchmark"><Card className="border-border"><CardContent className="p-4"><BenchmarkChart /></CardContent></Card></TabsContent>
        <TabsContent value="alerts"><Card className="border-border"><CardContent className="p-4"><AlertsPanel /></CardContent></Card></TabsContent>
        <TabsContent value="tax"><Card className="border-border"><CardContent className="p-4"><CapitalGainsReport /></CardContent></Card></TabsContent>
        <TabsContent value="rebalance"><Card className="border-border"><CardContent className="p-4"><RebalancePanel /></CardContent></Card></TabsContent>
        <TabsContent value="sip"><Card className="border-border"><CardContent className="p-4"><SIPTracker /></CardContent></Card></TabsContent>
        <TabsContent value="dividends"><Card className="border-border"><CardContent className="p-4"><DividendTracker /></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}

export default AnalyticsTab;