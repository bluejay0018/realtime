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

const CLAUDE_PROMPT = `You are an investment analyst helping a user interpret posts from stock portfolio managers.

For the FIRST user message (which contains the post itself), respond in 3-4 sentences max:
(1) state what action was taken or what the key thesis point is,
(2) classify it as one of: New Position / Add / Trim / Full Exit / Thesis Update / Market Commentary,
(3) flag any notable risk, contrarian signal, or urgency worth knowing.

For any FOLLOW-UP question from the user, answer directly and concisely, drawing on the post and your investment knowledge. Use plain prose (no bullet/numbered list) unless the user asks for structure.

Always be direct — no filler, no hedging, no "I am an AI" disclaimers.`;

async function handleClaude(request) {
  if (request.method !== 'POST') {
    return corsJson({ error: 'Method not allowed' }, 405);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return corsJson({ error: 'Invalid JSON' }, 400);
  }
  const { post, apiKey, messages } = body || {};
  if (!apiKey) {
    return corsJson({ error: 'Missing apiKey' }, 400);
  }
  if (!post && (!Array.isArray(messages) || messages.length === 0)) {
    return corsJson({ error: 'Missing post or messages' }, 400);
  }

  // For initial analysis: send the post as a single user message.
  // For follow-ups: caller passes the full conversation history.
  const chatMessages = Array.isArray(messages) && messages.length > 0
    ? messages
    : [{ role: 'user', content: post }];

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: CLAUDE_PROMPT,
        messages: chatMessages,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return corsJson({ error: data.error?.message || 'Anthropic API error', status: upstream.status }, upstream.status);
    }
    const analysis = data.content?.[0]?.text ?? '';
    return corsJson({ analysis });
  } catch (err) {
    return corsJson({ error: 'Claude call failed', detail: String(err) }, 502);
  }
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    if (url.pathname === '/claude') {
      return handleClaude(request);
    }
    return proxySavvy(request, url);
  },
};
