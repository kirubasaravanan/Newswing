'use client';

import { useEffect, useRef, memo } from 'react';

interface TradingViewChartProps {
  symbol: string;
  interval?: string;
  height?: number;
}

/**
 * TradingView Advanced Chart Widget
 * Uses free embeddable widget — real NSE data, interactive, years of history.
 * Symbol format: NSE:RELIANCE, NSE:TCS, etc.
 */
function TradingViewChartInner({ symbol, interval = 'D', height = 500 }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear previous widget
    containerRef.current.innerHTML = '';

    const tvSymbol = symbol.startsWith('NSE:') ? symbol : `NSE:${symbol}`;

    // Load TradingView widget script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onload = () => {
      if (containerRef.current && typeof (window as any).newTradingView !== 'undefined') {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol: tvSymbol,
          interval: interval,
          timezone: 'Asia/Kolkata',
          theme: 'dark',
          style: '1',
          locale: 'in',
          toolbar_bg: '#0f0f1a',
          enable_publishing: false,
          allow_symbol_change: true,
          hide_side_toolbar: false,
          container_id: containerRef.current.id,
          // Studies
          studies: [
            'MASimple@tv-basicstudies',
            'EMA@tv-basicstudies',
            'RSI@tv-basicstudies',
            'ATR@tv-basicstudies',
          ],
          // Overrides
          overrides: {
            'mainSeriesProperties.candleStyle.upColor': '#10b981',
            'mainSeriesProperties.candleStyle.downColor': '#ef4444',
            'mainSeriesProperties.candleStyle.borderUpColor': '#10b981',
            'mainSeriesProperties.candleStyle.borderDownColor': '#ef4444',
            'mainSeriesProperties.candleStyle.wickUpColor': '#10b981',
            'mainSeriesProperties.candleStyle.wickDownColor': '#ef4444',
            'paneProperties.background': '#0f0f1a',
            'paneProperties.vertGridProperties.color': '#1e1e3a',
            'paneProperties.horzGridProperties.color': '#1e1e3a',
            'scalesProperties.textColor': '#94a3b8',
          },
          // Feature set
          disabled_features: [
            'header_symbol_search',
            'symbol_search_hot_key',
          ],
          enabled_features: [
            'study_templates',
          ],
          // Save/load
          save_image: true,
        });
      }
    };

    document.head.appendChild(script);

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, interval]);

  return (
    <div
      id={`tv-chart-${symbol.replace(/[^a-zA-Z0-9]/g, '')}`}
      ref={containerRef}
      style={{ height: `${height}px`, width: '100%' }}
      className="rounded-lg overflow-hidden border border-border"
    />
  );
}

export const TradingViewChart = memo(TradingViewChartInner);