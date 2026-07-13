// Vercel serverless function — exchanges an OAuth code (or refresh token) for
// a WHOOP access token. Must run server-side: the WHOOP token endpoint needs
// the client secret, which must never reach the browser.
//
// Env vars required (set in Vercel project settings):
//   WHOOP_CLIENT_ID
//   WHOOP_CLIENT_SECRET

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET not configured on the server' });
  }

  const { grant_type, code, redirect_uri, refresh_token } = req.body || {};
  const params = new URLSearchParams();

  if (grant_type === 'refresh_token') {
    if (!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', refresh_token);
    params.set('scope', 'offline');
  } else {
    if (!code || !redirect_uri) return res.status(400).json({ error: 'Missing code or redirect_uri' });
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirect_uri);
  }
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);

  try {
    const whoopRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await whoopRes.json();
    return res.status(whoopRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'WHOOP token request failed', detail: String(err) });
  }
}
