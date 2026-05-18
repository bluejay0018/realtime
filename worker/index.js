const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body = null, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }
    return corsResponse(JSON.stringify({ ok: true, path: new URL(request.url).pathname }), 200, {
      'Content-Type': 'application/json',
    });
  },
};
