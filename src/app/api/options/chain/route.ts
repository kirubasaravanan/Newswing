import { NextRequest, NextResponse } from 'next/server';
import { fetchOptionChain, getNextExpiries } from '@/lib/options/option-chain';

// In-memory cache (30s TTL)
const chainCache = new Map<string, { data: any; fetchedAt: number }>();
const CACHE_TTL = 30_000;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || 'NIFTY';
    const expiry = searchParams.get('expiry') || '';

    // Get default expiry if not provided
    const targetExpiry = expiry || getNextExpiries(symbol, 1)[0] || '';
    if (!targetExpiry) {
      return NextResponse.json({ success: false, error: 'No expiry dates available' }, { status: 400 });
    }

    const cacheKey = `${symbol}:${targetExpiry}`;
    const cached = chainCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return NextResponse.json({ success: true, ...cached.data, cached: true });
    }

    const data = await fetchOptionChain(symbol, targetExpiry);
    chainCache.set(cacheKey, { data, fetchedAt: Date.now() });

    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}