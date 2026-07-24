import { NextRequest, NextResponse } from "next/server";
import { runScreening, DEFAULT_CONFIG, TOP_7_RANKED_SYMBOLS, type ScreeningConfig } from "@/lib/trading/screening-engine";
import { getHistoricalData } from "@/lib/trading/data-provider";
import { db } from "@/lib/db";
import { getFullUniverse } from "@/lib/trading/universe-scanner";
import { sendDiscordSignal } from "@/lib/notifications/discord";
import { getStrikeStep, getNextExpiry } from "@/lib/trading/options-scanner";
import { getOptionLotSize } from "@/lib/options/black-scholes";
import { fetchDhanOptionChain } from "@/lib/options/dhan-option-provider";
import { getActiveTop7, getActiveVacantSlots } from "@/lib/trading/rs-ranking";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const config: ScreeningConfig = { ...DEFAULT_CONFIG, ...body.config };
    const scanMode: string = body.scanMode || "watchlist";
    const days = body.days || 300;
    const sendDiscord: boolean = body.sendDiscord !== false;
    let symbols: string[] = body.symbols || [];

    // Real weekly RS ranking (see rs-ranking.ts) — falls back to the static
    // TOP_7_RANKED_SYMBOLS list only if no dynamic ranking exists yet.
    const activeTop7 = await getActiveTop7();
    const activeVacant = await getActiveVacantSlots();
    const dynamicRankTable = [...activeTop7, ...activeVacant];
    const watchlistSymbols = activeTop7.length > 0 ? activeTop7 : TOP_7_RANKED_SYMBOLS;

    if (symbols.length === 0) {
      if (scanMode === "universe") {
        const universe = getFullUniverse();
        symbols = universe.map((s) => s.symbol);
      } else {
        symbols = watchlistSymbols.map((s) => s.symbol);
      }
    }

    const results: ReturnType<typeof runScreening>[] = [];
    const errors: { symbol: string; error: string }[] = [];

    let niftyCandles: Awaited<ReturnType<typeof getHistoricalData>>["data"] = [];
    try {
      niftyCandles = (await getHistoricalData("NIFTY50", days + 50)).data;
    } catch { /* relative-strength check below will simply stay unproven without Nifty data */ }

    for (const symbol of symbols) {
      try {
        const { data: candles, source } = await getHistoricalData(symbol, days);
        if (!candles || candles.length < 50) {
          errors.push({ symbol, error: `Insufficient real candles (${candles?.length || 0}) from ${source}` });
          continue;
        }
        const result = runScreening(symbol, candles, config, true, true, niftyCandles, dynamicRankTable);
        if (result) {
          results.push(result);

          // Send real A+ signal to Discord as PAPER TRADE signal
          if (sendDiscord && result.setupType === "A+") {
            const currentPrice = candles[candles.length - 1]?.close || result.entryPrice;
            // runScreening only detects bullish (long) setups — there is no
            // bearish/short detection path anywhere in the engine — so the
            // implied option trade is always a CALL. The previous
            // `score > 6` check was always false (max possible score is 6),
            // so every A+ setup here was mislabeled "PUT BUY (Bearish)" to
            // Discord: the opposite trade of what the engine actually found.
            const optionType: "CE" | "PE" = "CE";
            const strikeStep = getStrikeStep(symbol, currentPrice);
            const strike = Math.round(currentPrice / strikeStep) * strikeStep;
            const lotSize = getOptionLotSize(symbol);
            const expiry = getNextExpiry();

            // Fetch a REAL live premium for this strike — sending a
            // placeholder premium of 0 to Discord would be exactly the kind
            // of fabricated data this system must never present as real.
            let premium = 0;
            try {
              const chain = await fetchDhanOptionChain(symbol, expiry);
              if (chain?.chain?.length) {
                const row = chain.chain.find((r) => r.strike === strike)
                  || chain.chain.reduce((closest, r) =>
                    Math.abs(r.strike - strike) < Math.abs(closest.strike - strike) ? r : closest
                  );
                if (row?.ce && row.ce.ltp > 0) premium = row.ce.ltp;
              }
            } catch { /* no real premium available this cycle — handled below */ }

            if (premium > 0) {
              try {
                await sendDiscordSignal({
                  symbol,
                  strike,
                  optionType,
                  expiry,
                  spotPrice: currentPrice,
                  premium,
                  stopLoss: result.stopLoss,
                  takeProfit: result.targetPrice,
                  lotSize,
                  lots: Math.max(1, Math.floor(result.sizing.allocatedCapital / (premium * lotSize))),
                  totalCapital: result.sizing.allocatedCapital,
                  confluenceScore: result.score,
                  setupType: result.setupType,
                  direction: "BUY CE (Bullish)",
                  engine: (config.engineMode as "OPTIONS" | "SWING") || "SWING",
                  dataSource: source || "real_candles",
                  timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                });
              } catch (discordErr) {
                console.warn("[Screener] Discord signal failed:", String(discordErr));
              }
            }
            // else: no real live premium available — skip the options
            // cross-post rather than sending a fabricated/placeholder price.
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
