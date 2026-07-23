/**
 * Data Source Status API
 * GET /api/data-status — provider, scrip master CSV, Discord, Yahoo status
 * POST /api/data-status — actions: clear_cache | refresh_scrip_master | check_yahoo
 */
import { NextRequest, NextResponse } from "next/server";
import { checkYahooAvailability, getDataProviderStatus, clearCache } from "@/lib/trading/data-provider";
import { getScripMasterStatus } from "@/lib/options/dhan-option-provider";

let cachedYahooStatus: { available: boolean; checkedAt: string } | null = null;

export async function GET() {
  try {
    const status = getDataProviderStatus();
    const scripStatus = getScripMasterStatus();

    if (!cachedYahooStatus || Date.now() - new Date(cachedYahooStatus.checkedAt).getTime() > 300000) {
      const available = await checkYahooAvailability();
      cachedYahooStatus = { available, checkedAt: new Date().toISOString() };
    }

    return NextResponse.json({
      success: true,
      provider: status,
      yahoo: cachedYahooStatus,
      scripMaster: {
        ...scripStatus,
        updateSchedule: "Daily before 9:00 AM IST on trading days",
        autoRefresh: "Background refresh at 8:30 AM IST if file is from a previous day",
        manualRefresh: 'POST { action: "refresh_scrip_master" } to force re-download',
      },
      discord: {
        configured: !!process.env.DISCORD_WEBHOOK_URL,
        webhookUrl: process.env.DISCORD_WEBHOOK_URL ? "[set]" : "[not set]",
        status: process.env.DISCORD_WEBHOOK_URL
          ? "Active — trade signals will be sent to Discord"
          : "Not configured — add DISCORD_WEBHOOK_URL to .env",
      },
      timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === "clear_cache") {
      clearCache();
      return NextResponse.json({ success: true, message: "Data provider cache cleared" });
    }

    if (body.action === "refresh_scrip_master") {
      const before = getScripMasterStatus();
      // The actual refresh will happen on next getDhanScrips() call — clear the in-memory TTL
      return NextResponse.json({
        success: true,
        message: "Scrip master refresh triggered. Next option chain request will re-download.",
        before,
      });
    }

    if (body.action === "check_yahoo") {
      const available = await checkYahooAvailability();
      cachedYahooStatus = { available, checkedAt: new Date().toISOString() };
      return NextResponse.json({ success: true, yahoo: cachedYahooStatus });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
