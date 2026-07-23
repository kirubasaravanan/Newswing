import { NextRequest, NextResponse } from "next/server";
import { sendDiscordSignal, sendDiscordPaperResult, sendDiscordSystemAlert } from "@/lib/notifications/discord";

/**
 * POST /api/discord/signal
 * Sends a trade signal OR paper trade result to Discord.
 * Body: { type: "SIGNAL" | "PAPER_RESULT" | "ALERT", payload: TradeSignal | PaperTradeResult | string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, payload } = body;

    if (!type || !payload) {
      return NextResponse.json({ success: false, error: "type and payload required" }, { status: 400 });
    }

    let ok = false;

    if (type === "SIGNAL") {
      ok = await sendDiscordSignal(payload);
    } else if (type === "PAPER_RESULT") {
      ok = await sendDiscordPaperResult(payload);
    } else if (type === "ALERT") {
      ok = await sendDiscordSystemAlert(payload.message, payload.level || "INFO");
    } else {
      return NextResponse.json({ success: false, error: "Unknown type: " + type }, { status: 400 });
    }

    if (!ok && !process.env.DISCORD_WEBHOOK_URL) {
      return NextResponse.json({ success: false, error: "DISCORD_WEBHOOK_URL not set in .env" });
    }

    return NextResponse.json({ success: ok });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  const configured = !!process.env.DISCORD_WEBHOOK_URL;
  return NextResponse.json({
    status: "ok",
    discordConfigured: configured,
    message: configured
      ? "Discord webhook is configured. POST { type, payload } to send signals."
      : "DISCORD_WEBHOOK_URL not set in .env. Add it to enable Discord notifications."
  });
}
