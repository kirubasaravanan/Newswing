import { NextRequest, NextResponse } from "next/server";
import { runScreening, DEFAULT_CONFIG, TOP_7_RANKED_SYMBOLS, type ScreeningConfig } from "@/lib/trading/screening-engine";
import { getHistoricalData } from "@/lib/trading/data-provider";
import { db } from "@/lib/db";
import { getFullUniverse } from "@/lib/trading/universe-scanner";
import { sendDiscordSignal } from "@/lib/notifications/discord";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const scanMode: string = body.scanMode || "watchlist";
    const days = body.days || 300;
    const sendDiscord: boolean = body.sendDiscord !== false;
    let symbols: string[] = body.symbols || [];

    if (symbols.length === 0) {
      if (scanMode === "universe") {
        const universe = getFullUniverse();
        symbols = universe.map((s) => s.symbol);
      } else {
        symbols = TOP_7_RANKED_SYMBOLS.map((s) => s.symbol);
      }
    }

    const results: ReturnType<typeof runScreening>[] = [];
    const errors: { symbol: string; error: string }[] = [];

    for (const symbol of symbols) {
      try {
        const { data: candles, source } = await getHistoricalData(symbol, days);
        if (!candles || candles.length < 50) {
          errors.push({ symbol, error: `Insufficient real candles (${candles?.length || 0}) from ${source}` });
          continue;
        }
        const result = runScreening(symbol, candles, config, true, true);
        if (result) {
          results.push(result);

          // Send real A+ signal to Discord as PAPER TRADE signal
          if (sendDiscord && result.setupType === "A+") {
            const currentPrice = candles[candles.length - 1]?.close || result.entryPrice;
            const optionType = result.score > 6 ? "CE" : "PE";
            try {
              await sendDiscordSignal({
                symbol,
                strike: Math.round(currentPrice / 50) * 50,
                optionType,
                expiry: new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
                spotPrice: currentPrice,
                premium: 0,
                stopLoss: result.stopLoss,
                takeProfit: result.targetPrice,
                lotSize: 1,
                lots: Math.max(1, Math.floor(result.sizing.allocatedCapital / (currentPrice * 50))),
                totalCapital: result.sizing.allocatedCapital,
                confluenceScore: result.score,
                setupType: result.setupType,
                direction: optionType === "CE" ? "BUY CE (Bullish)" : "BUY PE (Bearish)",
                engine: (config.engineMode as "OPTIONS" | "SWING") || "SWING",
                dataSource: source || "real_candles",
                timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
              });
            } catch (discordErr) {
              console.warn("[Screener] Discord signal failed:", String(discordErr));
            }
          }
        }
      } catch (err: any) {
        errors.push({ symbol, error: err.message || String(err) });
      }
    }

    results.sort((a, b) => ((a?.rank || 99) - (b?.rank || 99)) || ((b?.score || 0) - (a?.score || 0)));

    return NextResponse.json({
      success: true,
      results,
      totalScanned: symbols.length,
      signalsFound: results.length,
      errors: errors.length > 0 ? errors : undefined,
      note: results.length === 0
        ? "No A+/B setups detected — only real signals are shown. Market may be closed or conditions not met."
        : `${results.length} real signal(s) found from live candle data.`,
    });
  } catch (error) {
    console.error("Screener API error:", error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
