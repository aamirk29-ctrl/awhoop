// WHOOP OAuth redirect target. WHOOP sends the browser here with ?code=...,
// we exchange it server-side (client secret never reaches the browser), then
// 302 to the dashboard's expanded Stack panel with tokens in the URL fragment
// (fragments never travel to any server on subsequent requests).
//
// Env vars (Vercel project settings): WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET,
// WHOOP_REDIRECT_URI — the redirect URI registered at developer.whoop.com
// must equal this route's deployed URL, e.g. https://<site>/api/whoop-callback

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const err = params.get('error');
  if (err) return new NextResponse(`WHOOP auth error: ${err}`, { status: 400 });
  const code = params.get('code');
  if (!code) return new NextResponse('Missing code parameter.', { status: 400 });

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return new NextResponse('Server not configured (missing WHOOP_* env vars).', { status: 500 });
  }

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await tokenRes.text();
    if (!tokenRes.ok) {
      return new NextResponse(`WHOOP token exchange failed: ${text}`, { status: 500 });
    }
    let json: { access_token?: string; refresh_token?: string; expires_in?: number };
    try {
      json = JSON.parse(text);
    } catch {
      return new NextResponse(`Non-JSON: ${text}`, { status: 500 });
    }
    const hash = new URLSearchParams({
      whoop_access: json.access_token || '',
      whoop_refresh: json.refresh_token || '',
      whoop_expires: String(Date.now() + (json.expires_in || 3600) * 1000),
    }).toString();
    return NextResponse.redirect(new URL(`/?p=stack#${hash}`, req.nextUrl.origin), 302);
  } catch (e) {
    return new NextResponse(`Unexpected: ${e instanceof Error ? e.message : String(e)}`, {
      status: 500,
    });
  }
}
