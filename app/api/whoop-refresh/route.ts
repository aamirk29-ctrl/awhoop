// Exchanges a refresh token for a new access token. Called from the frontend
// roughly hourly, so it lives apart from the one-shot callback handler.

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  let body: { refresh_token?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* fall through to validation */
  }
  const refresh = body.refresh_token;
  if (!refresh) return NextResponse.json({ error: 'refresh_token required' }, { status: 400 });

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'server not configured' }, { status: 500 });
  }

  try {
    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refresh,
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'offline',
    });
    const r = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const text = await r.text();
    if (!r.ok) return NextResponse.json({ error: `refresh failed: ${text}` }, { status: 500 });
    try {
      return NextResponse.json(JSON.parse(text));
    } catch {
      return NextResponse.json({ error: 'non-JSON' }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: `fetch error: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
