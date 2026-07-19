import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/watchlist/folders — list all folders with their stocks
export async function GET() {
  try {
    const folders = await db.watchlistFolder.findMany({
      orderBy: { sortOrder: 'asc' },
      include: { stocks: { orderBy: { symbol: 'asc' } } },
    });
    // Also get stocks with no folder (ungrouped)
    const ungrouped = await db.watchlistStock.findMany({
      where: { folderId: null },
      orderBy: { symbol: 'asc' },
    });
    return NextResponse.json({ success: true, folders, ungrouped });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// POST /api/watchlist/folders — create folder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, color, sortOrder } = body;
    if (!name) return NextResponse.json({ success: false, error: 'name required' }, { status: 400 });
    const folder = await db.watchlistFolder.create({
      data: { name, color: color || '#6366f1', sortOrder: sortOrder || 0 },
    });
    return NextResponse.json({ success: true, folder });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// PUT /api/watchlist/folders — move stock to folder
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { stockSymbol, folderId } = body;
    if (!stockSymbol) return NextResponse.json({ success: false, error: 'stockSymbol required' }, { status: 400 });
    await db.watchlistStock.update({
      where: { symbol: stockSymbol.toUpperCase() },
      data: { folderId: folderId || null },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}

// DELETE /api/watchlist/folders?id=xxx
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
    // Move stocks out of folder before deleting
    await db.watchlistStock.updateMany({ where: { folderId: id }, data: { folderId: null } });
    await db.watchlistFolder.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}