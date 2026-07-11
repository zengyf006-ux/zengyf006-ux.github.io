import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type ProviderName = "binance" | "okx" | "bybit";
type MarketRow = {
  symbol: string;
  provider: ProviderName;
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
  change: number;
  bid: number;
  ask: number;
  trades: number;
  serverTime: number;
};

const VERSION = "atlas.market.v1";
const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT",
];
const ALLOWED_ORIGINS = new Set([
  "https://zengyf006-ux.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);
const rateWindows = new Map<string, { startedAt: number; count: number }>();

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const positive = (value: unknown) => Math.max(0, number(value));

function cors(origin: string | null) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "accept, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function json(body: unknown, status: number, origin: string | null, cacheSeconds = 0) {
  const headers = cors(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", cacheSeconds > 0
    ? `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
    : "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

function routeFrom(url: URL) {
  const marker = "/atlas-market-gateway-markets";
  const index = url.pathname.indexOf(marker);
  if (index < 0) return "/markets";
  const suffix = url.pathname.slice(index + marker.length);
  return !suffix || suffix === "/" ? "/markets" : suffix;
}

function clientKey(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function allowed(request: Request) {
  const key = clientKey(request);
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= 60_000) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 90;
}

async function fetchJson(url: string, signal: AbortSignal, timeoutMs = 2600): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Upstream timeout", "TimeoutError")), timeoutMs);
  const relayAbort = () => controller.abort(signal.reason || new DOMException("Aborted", "AbortError"));
  if (signal.aborted) relayAbort();
  else signal.addEventListener("abort", relayAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "ATLAS-X-Market-Gateway/1.1" },
    });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", relayAbort);
  }
}

function requireComplete(rows: MarketRow[], provider: ProviderName) {
  if (rows.length !== SYMBOLS.length) throw new Error(`${provider} returned incomplete market set`);
  if (rows.some(row => !(row.price > 0) || !(row.bid > 0) || !(row.ask > 0) || row.ask < row.bid)) {
    throw new Error(`${provider} returned invalid price levels`);
  }
  return rows;
}

async function binance(signal: AbortSignal): Promise<MarketRow[]> {
  const payload = await fetchJson("https://api.binance.com/api/v3/ticker/24hr", signal);
  const selected = new Map((Array.isArray(payload) ? payload : []).map((row: any) => [String(row.symbol), row]));
  return requireComplete(SYMBOLS.map(symbol => {
    const row: any = selected.get(symbol) || {};
    const price = positive(row.lastPrice);
    const open = positive(row.openPrice);
    return {
      symbol, provider: "binance", price, open,
      high: positive(row.highPrice), low: positive(row.lowPrice),
      volume: positive(row.volume), quoteVolume: positive(row.quoteVolume),
      change: number(row.priceChangePercent, open ? (price - open) / open * 100 : 0),
      bid: positive(row.bidPrice), ask: positive(row.askPrice),
      trades: Math.max(0, Math.trunc(number(row.count))),
      serverTime: number(row.closeTime, Date.now()),
    };
  }), "binance");
}

async function okx(signal: AbortSignal): Promise<MarketRow[]> {
  const payload = await fetchJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT", signal);
  const selected = new Map((Array.isArray(payload?.data) ? payload.data : []).map((row: any) => [String(row.instId).replaceAll("-", ""), row]));
  return requireComplete(SYMBOLS.map(symbol => {
    const row: any = selected.get(symbol) || {};
    const price = positive(row.last);
    const open = positive(row.open24h);
    return {
      symbol, provider: "okx", price, open,
      high: positive(row.high24h), low: positive(row.low24h),
      volume: positive(row.vol24h), quoteVolume: positive(row.volCcy24h),
      change: open ? (price - open) / open * 100 : 0,
      bid: positive(row.bidPx), ask: positive(row.askPx), trades: 0,
      serverTime: number(row.ts, Date.now()),
    };
  }), "okx");
}

async function bybit(signal: AbortSignal): Promise<MarketRow[]> {
  const payload = await fetchJson("https://api.bybit.com/v5/market/tickers?category=spot", signal);
  const selected = new Map((Array.isArray(payload?.result?.list) ? payload.result.list : []).map((row: any) => [String(row.symbol), row]));
  return requireComplete(SYMBOLS.map(symbol => {
    const row: any = selected.get(symbol) || {};
    return {
      symbol, provider: "bybit",
      price: positive(row.lastPrice), open: positive(row.prevPrice24h),
      high: positive(row.highPrice24h), low: positive(row.lowPrice24h),
      volume: positive(row.volume24h), quoteVolume: positive(row.turnover24h),
      change: number(row.price24hPcnt) * 100,
      bid: positive(row.bid1Price), ask: positive(row.ask1Price), trades: 0,
      serverTime: number(payload?.time, Date.now()),
    };
  }), "bybit");
}

const providers: Array<[ProviderName, (signal: AbortSignal) => Promise<MarketRow[]>]> = [
  ["binance", binance], ["okx", okx], ["bybit", bybit],
];

async function loadMarkets(signal: AbortSignal) {
  const errors: string[] = [];
  for (const [name, load] of providers) {
    const startedAt = performance.now();
    try {
      const markets = await load(signal);
      return {
        version: VERSION,
        provider: name,
        serverTime: Date.now(),
        receivedAt: Date.now(),
        latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
        markets,
      };
    } catch (error) {
      errors.push(`${name}:${error instanceof Error ? error.name : "UpstreamError"}`);
    }
  }
  throw new Error(errors.join(","));
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ version: VERSION, error: { code: "ORIGIN_NOT_ALLOWED", message: "Origin is not allowed" } }, 403, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== "GET") return json({ version: VERSION, error: { code: "METHOD_NOT_ALLOWED", message: "Only GET is supported" } }, 405, origin);
  if (!allowed(request)) return json({ version: VERSION, error: { code: "RATE_LIMITED", message: "Too many requests" } }, 429, origin);

  const route = routeFrom(new URL(request.url));
  if (route === "/health") return json({ version: VERSION, status: "ok", serverTime: Date.now(), providers: providers.map(([name]) => name) }, 200, origin, 5);
  if (route !== "/markets") return json({ version: VERSION, error: { code: "NOT_FOUND", message: "Unknown route" } }, 404, origin);
  try {
    return json(await loadMarkets(request.signal), 200, origin, 2);
  } catch {
    return json({ version: VERSION, error: { code: "UPSTREAM_UNAVAILABLE", message: "Public market providers are temporarily unavailable" } }, 503, origin);
  }
});
