/**
 * Data Source Status API
 * GET /api/data-status — check Yahoo availability, cache stats, toggle source
 */
import { NextResponse } from 'next/server';
import { checkYahooAvailability, getDataProviderStatus, clearCache, type DataSource } from '@/lib/trading/data-provider';

let cachedYahooStatus: { available: boolean; checkedAt: string } | null = null;

export async function GET() {
  try {
    const status = getDataProviderStatus();

    // Check Yahoo availability (throttled - only once per 5 minutes)
    if (!cachedYahooStatus || Date.now() - new Date(cachedYahooStatus.checkedAt).getTime() > 300000) {
      const available = await checkYahooAvailability();
      cachedYahooStatus = { available, checkedAt: new Date().toISOString() };
    }

    return NextResponse.json({
      success: true,
      provider: status,
      yahoo: cachedYahooStatus,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (body.action === 'clear_cache') {
      clearCache();
      return NextResponse.json({ success: true, message: 'Cache cleared' });
    }
    if (body.action === 'check_yahoo') {
      const available = await checkYahooAvailability();
      cachedYahooStatus = { available, checkedAt: new Date().toISOString() };
      return NextResponse.json({ success: true, yahoo: cachedYahooStatus });
    }
    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}