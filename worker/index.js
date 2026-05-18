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

const CLAUDE_PROMPT = `You are an investment advisor helping a user decide whether to act on posts from stock portfolio managers they follow. The user sees the manager's trade or commentary and wants YOUR recommendation on what THEY should do.

For the FIRST user message (which contains the post payload), respond in EXACTLY this format with the **bold labels** preserved:

**Recommendation:** BUY | HOLD | SELL | WATCH | SKIP

**Why:** 2-3 sentences explaining the rationale — what the manager did or argued, whether the thesis is compelling, and whether the user should follow.

**Key risk:** 1-2 sentences flagging the most important downside, contrarian signal, or what could invalidate this view.

**Manager's action:** One short phrase (e.g. "Added to TSLA position", "Trimmed NVDA", "Bullish commentary on semis").

Guidelines for the recommendation:
- BUY: strong thesis, favorable setup — user should consider taking the same position
- HOLD: thesis is sound but already in position, or entry isn't urgent right now
- SELL: thesis is broken, clear exit signal, or risk outweighs reward
- WATCH: interesting but needs more data; track but don't act yet
- SKIP: low conviction or not actionable

Be direct. Use plain language. No "consult a financial advisor" hedging. No "I am an AI" disclaimers. If it's pure commentary with no clear action, default to WATCH or SKIP.

For FOLLOW-UP questions from the user: answer directly and concisely in plain prose (no bullet/numbered list) unless the user asks for structure. You can still use **bold** for emphasis where helpful.`;

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

async function handleQuote(symbol) {
  if (!symbol || !/^[A-Za-z0-9.\-]+$/.test(symbol)) {
    return corsJson({ error: 'Invalid symbol' }, 400);
  }
  try {
    const upstream = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SavvyFeedBot/1.0)' } }
    );
    if (!upstream.ok) {
      return corsJson({ error: 'Yahoo error', status: upstream.status }, upstream.status);
    }
    const data = await upstream.json();
    const result = data?.chart?.result?.[0];
    if (!result) return corsJson({ error: 'No data for ' + symbol }, 404);
    const meta = result.meta || {};
    return corsJson({
      symbol: meta.symbol || symbol,
      price: meta.regularMarketPrice ?? null,
      currency: meta.currency ?? null,
      previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
      marketState: meta.marketState ?? null,
    });
  } catch (err) {
    return corsJson({ error: 'Quote fetch failed', detail: String(err) }, 502);
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
    if (url.pathname.startsWith('/quote/')) {
      const symbol = decodeURIComponent(url.pathname.slice('/quote/'.length));
      return handleQuote(symbol);
    }
    return proxySavvy(request, url);
  },
};
