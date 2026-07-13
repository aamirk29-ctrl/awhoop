// Vercel serverless function — proxies WHOOP data-API reads.
// The WHOOP API does not support direct browser calls, so the frontend hits
// this same-origin endpoint instead, passing its access token straight
// through in the Authorization header (no secret needed for reads).
//
// Usage: GET /api/whoop-data?path=recovery&limit=1

const ALLOWED_PATHS = new Set([
  'recovery',
  'cycle',
  'activity/sleep',
  'activity/workout',
  'user/profile/basic',
  'user/measurement/body',
]);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <access_token> header' });
  }

  const path = String(req.query.path || '');
  if (!ALLOWED_PATHS.has(path)) {
    return res.status(400).json({ error: 'Unsupported path' });
  }

  const qs = new URLSearchParams(req.query);
  qs.delete('path');
  const url = `https://api.prod.whoop.com/developer/v2/${path}${qs.toString() ? '?' + qs.toString() : ''}`;

  try {
    const whoopRes = await fetch(url, { headers: { Authorization: auth } });
    const data = await whoopRes.json();
    return res.status(whoopRes.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'WHOOP data request failed', detail: String(err) });
  }
}
