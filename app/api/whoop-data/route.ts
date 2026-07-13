// Proxies WHOOP data-API reads — the WHOOP API blocks direct browser calls,
// so the frontend hits this same-origin endpoint with its bearer token.
// Note: WHOOP moved most endpoints to v2, but /cycle still needs v1.
// Usage: GET /api/whoop-data?path=/recovery&limit=1

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 });
  }
  const params = req.nextUrl.searchParams;
  const path = params.get('path') || '';
  if (!path.startsWith('/')) {
    return NextResponse.json({ error: 'path required' }, { status: 400 });
  }
  const fwd = new URLSearchParams();
  params.forEach((v, k) => {
    if (k !== 'path') fwd.set(k, v);
  });
  const qs = fwd.toString();
  const base = path.startsWith('/cycle')
    ? 'https://api.prod.whoop.com/developer/v1'
    : 'https://api.prod.whoop.com/developer/v2';
  try {
    const r = await fetch(base + path + (qs ? `?${qs}` : ''), {
      headers: { Authorization: auth, Accept: 'application/json' },
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `proxy fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
