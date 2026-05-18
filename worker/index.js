const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const SAVVY_BASE = 'https://api.savvytrader.com';

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function corsJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function proxySavvy(request, url) {
  const target = SAVVY_BASE + url.pathname + url.search;
  const init = {
    method: request.method,
    headers: {},
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: 'follow',
  };
  const auth = request.headers.get('Authorization');
  if (auth) init.headers['Authorization'] = auth;
  const ct = request.headers.get('Content-Type');
  if (ct) init.headers['Content-Type'] = ct;

  try {
    const upstream = await fetch(target, init);
    return withCors(upstream);
  } catch (err) {
    return corsJson({ error: 'Upstream fetch failed', detail: String(err) }, 502);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (url.pathname === '/claude') {
      return corsJson({ error: 'Not implemented yet' }, 501);
    }
    return proxySavvy(request, url);
  },
};
