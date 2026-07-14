// Proxies USDA FoodData Central so the API key never reaches the browser.
//
//   GET /api/usda?q=chicken breast   -> /foods/search
//   GET /api/usda?fdcId=123456       -> /food/{fdcId} (full nutrient detail)
//
// Requires USDA_FDC_API_KEY (free: https://fdc.nal.usda.gov/api-key-signup).
// Returns 503 with `configured: false` when unset so the UI can say so plainly
// instead of failing with an opaque error.

import { NextRequest, NextResponse } from 'next/server';

const BASE = 'https://api.nal.usda.gov/fdc/v1';

export async function GET(req: NextRequest) {
  const key = process.env.USDA_FDC_API_KEY;
  if (!key) {
    return NextResponse.json(
      {
        configured: false,
        error:
          'USDA_FDC_API_KEY is not set. Get a free key at https://fdc.nal.usda.gov/api-key-signup and add it to .env.local (and your Vercel project settings).',
      },
      { status: 503 },
    );
  }

  const params = req.nextUrl.searchParams;
  const fdcId = params.get('fdcId');
  const q = params.get('q');

  let url: string;
  if (fdcId) {
    if (!/^\d+$/.test(fdcId)) {
      return NextResponse.json({ error: 'invalid fdcId' }, { status: 400 });
    }
    url = `${BASE}/food/${fdcId}?api_key=${encodeURIComponent(key)}`;
  } else if (q && q.trim()) {
    const search = new URLSearchParams({
      api_key: key,
      query: q.trim(),
      pageSize: params.get('pageSize') || '20',
      // Branded first would drown out whole foods; these cover both.
      dataType: 'Foundation,SR Legacy,Branded',
    });
    url = `${BASE}/foods/search?${search.toString()}`;
  } else {
    return NextResponse.json({ error: 'q or fdcId required' }, { status: 400 });
  }

  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `USDA fetch failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
