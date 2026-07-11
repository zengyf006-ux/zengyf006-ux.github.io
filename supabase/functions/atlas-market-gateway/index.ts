import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  VERSION,
  INTERVAL_MS,
  OKX_INTERVAL,
  BYBIT_INTERVAL,
  normalizeSymbol,
  toOkxInstrument,
  normalizeBinanceCandles,
  normalizeOkxCandles,
  normalizeBybitCandles,
  normalizeBinanceSnapshot,
  normalizeOkxSnapshot,
  normalizeBybitSnapshot,
  validateCandleSpacing,
} from "./normalizers.mjs";

type ProviderName = "binance" | "okx" | "bybit";
type HealthState = {
  latency: number;
  failures: number;
  lastSuccessAt: number;
  lastFailureAt: number;
  lastError: string;
};
type ProviderAdapter = {
  name: ProviderName;
  candles(symbol: string, interval: string, limit: number, signal: AbortSignal): Promise<Record<string, unknown>[]>;
  snapshot(symbol: string, signal: AbortSignal): Promise<Record<string, unknown>>;
  markets(signal: AbortSignal): Promise<Record<string, unknown>[]>;
  probe(signal: AbortSignal): Promise<void>;
};

const ALLOWED_ORIGINS = new Set([
  "https://zengyf006-ux.github.io",
  "http://127.0.0.1:4173",
  "http://localhost:4173",
]);
const SYMBOLS = new Set([
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT",
]);
const INTERVALS = new Set(Object.keys(INTERVAL_MS));
const health = new Map<ProviderName, HealthState>();
const rateWindows = new Map<string, { windowStart: number; count: number }>();
let gatewaySequence = 1;

const initialHealth = (): HealthState => ({
  latency: 900,
  failures: 0,
  lastSuccessAt: 0,
  lastFailureAt: 0,
  lastError: "",
});
for (const name of ["binance", "okx", "bybit"] as ProviderName[]) health.set(name, initialHealth());

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const sleep = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  const abort = () => {
    clearTimeout(timer);
    reject(signal?.reason || new DOMException("Aborted", "AbortError"));
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
});

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, accept",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null, cacheSeconds = 0) {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (cacheSeconds > 0) headers.set("Cache-Control", `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(code: string, message: string, status: number, origin: string | null) {
  return jsonResponse({ version: VERSION, error: { code, message } }, status, origin);
}

function routeFrom(url: URL) {
  const explicit = url.searchParams.get("route");
  if (explicit) return `/${explicit.replace(/^\/+/, "")}`;
  const marker = "/atlas-market-gateway";
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex >= 0) {
    const suffix = url.pathname.slice(markerIndex + marker.length);
    return suffix && suffix !== "/" ? suffix : "/health";
  }
  const last = url.pathname.split("/").filter(Boolean).at(-1);
  return last && last !== "atlas-market-gateway" ? `/${last}` : "/health";
}

function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-real-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function allowRate(request: Request) {
  const key = clientIp(request);
  const now = Date.now();
  const current = rateWindows.get(key);
  if (!current || now - current.windowStart >= 60_000) {
    rateWindows.set(key, { windowStart: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 120;
}

function validatedSymbol(url: URL) {
  const symbol = normalizeSymbol(url.searchParams.get("symbol") || "BTCUSDT");
  return SYMBOLS.has(symbol) ? symbol : "";
}

function validatedInterval(url: URL) {
  const interval = String(url.searchParams.get("interval") || "15m");
  return INTERVALS.has(interval) ? interval : "";
}

function providerScore(name: ProviderName) {
  const state = health.get(name) || initialHealth();
  const recencyPenalty = state.lastFailureAt > state.lastSuccessAt ? 300 : 0;
  return state.failures * 1000 + state.latency + recencyPenalty;
}

function orderedProviders() {
  return [...providers].sort((a, b) => providerScore(a.name) - providerScore(b.name));
}

async function fetchJson(url: string, signal: AbortSignal, timeoutMs = 1600) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException("Upstream timeout", "TimeoutError")), timeoutMs);
  const relayAbort = () => controller.abort(signal.reason || new DOMException("Aborted", "AbortError"));
  if (signal.aborted) relayAbort();
  else signal.addEventListener("abort", relayAbort, { once: true });
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json", "User-Agent": "ATLAS-X-Market-Gateway/1.0" },
    });
    if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", relayAbort);
  }
}

async function measured<T>(name: ProviderName, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const value = await work();
    const previous = health.get(name) || initialHealth();
    health.set(name, {
      latency: Math.round(previous.latency * 0.35 + Math.max(1, performance.now() - started) * 0.65),
      failures: Math.max(0, previous.failures - 1),
      lastSuccessAt: Date.now(),
      lastFailureAt: previous.lastFailureAt,
      lastError: "",
    });
    return value;
  } catch (error) {
    const previous = health.get(name) || initialHealth();
    health.set(name, {
      ...previous,
      failures: Math.min(20, previous.failures + 1),
      lastFailureAt: Date.now(),
      lastError: error instanceof Error ? error.name : "UpstreamError",
    });
    throw error;
  }
}

const binance: ProviderAdapter = {
  name: "binance",
  async candles(symbol, interval, limit, signal) {
    return await measured("binance", async () => {
      const rows = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, signal);
      const candles = normalizeBinanceCandles(rows, interval);
      if (candles.length < 2 || !validateCandleSpacing(candles, interval)) throw new Error("Invalid Binance candles");
      return candles;
    });
  },
  async snapshot(symbol, signal) {
    return await measured("binance", async () => {
      const [ticker, book, trades] = await Promise.all([
        fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`, signal),
        fetchJson(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=20`, signal),
        fetchJson(`https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=30`, signal),
      ]);
      return normalizeBinanceSnapshot({ symbol, ticker, book, trades, receivedAt: Date.now() });
    });
  },
  async markets(signal) {
    return await measured("binance", async () => {
      const rows = await fetchJson("https://api.binance.com/api/v3/ticker/24hr", signal);
      const selected = new Map((Array.isArray(rows) ? rows : []).map((row: Record<string, unknown>) => [String(row.symbol), row]));
      return [...SYMBOLS].map(symbol => {
        const row = selected.get(symbol) as Record<string, unknown> | undefined;
        const price = number(row?.lastPrice);
        const open = number(row?.openPrice);
        return {
          symbol,
          provider: "binance",
          price,
          open,
          high: number(row?.highPrice),
          low: number(row?.lowPrice),
          volume: number(row?.volume),
          quoteVolume: number(row?.quoteVolume),
          change: number(row?.priceChangePercent, open ? ((price - open) / open) * 100 : 0),
          serverTime: number(row?.closeTime, Date.now()),
        };
      }).filter(row => row.price > 0);
    });
  },
  async probe(signal) {
    await measured("binance", async () => {
      await fetchJson("https://api.binance.com/api/v3/time", signal, 1200);
    });
  },
};

const okx: ProviderAdapter = {
  name: "okx",
  async candles(symbol, interval, limit, signal) {
    return await measured("okx", async () => {
      const instrument = toOkxInstrument(symbol);
      const bar = OKX_INTERVAL[interval as keyof typeof OKX_INTERVAL];
      const payload = await fetchJson(`https://www.okx.com/api/v5/market/candles?instId=${instrument}&bar=${bar}&limit=${limit}`, signal);
      const candles = normalizeOkxCandles(payload, interval);
      if (candles.length < 2 || !validateCandleSpacing(candles, interval)) throw new Error("Invalid OKX candles");
      return candles;
    });
  },
  async snapshot(symbol, signal) {
    return await measured("okx", async () => {
      const instrument = toOkxInstrument(symbol);
      const [ticker, book, trades] = await Promise.all([
        fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instrument}`, signal),
        fetchJson(`https://www.okx.com/api/v5/market/books?instId=${instrument}&sz=20`, signal),
        fetchJson(`https://www.okx.com/api/v5/market/trades?instId=${instrument}&limit=30`, signal),
      ]);
      return normalizeOkxSnapshot({ symbol, ticker, book, trades, receivedAt: Date.now() });
    });
  },
  async markets(signal) {
    return await measured("okx", async () => {
      const payload = await fetchJson("https://www.okx.com/api/v5/market/tickers?instType=SPOT", signal);
      const selected = new Map((Array.isArray(payload?.data) ? payload.data : []).map((row: Record<string, unknown>) => [String(row.instId).replace("-", ""), row]));
      return [...SYMBOLS].map(symbol => {
        const row = selected.get(symbol) as Record<string, unknown> | undefined;
        const price = number(row?.last);
        const open = number(row?.open24h);
        return {
          symbol,
          provider: "okx",
          price,
          open,
          high: number(row?.high24h),
          low: number(row?.low24h),
          volume: number(row?.vol24h),
          quoteVolume: number(row?.volCcy24h),
          change: open ? ((price - open) / open) * 100 : 0,
          serverTime: number(row?.ts, Date.now()),
        };
      }).filter(row => row.price > 0);
    });
  },
  async probe(signal) {
    await measured("okx", async () => {
      await fetchJson("https://www.okx.com/api/v5/public/time", signal, 1200);
    });
  },
};

const bybit: ProviderAdapter = {
  name: "bybit",
  async candles(symbol, interval, limit, signal) {
    return await measured("bybit", async () => {
      const value = BYBIT_INTERVAL[interval as keyof typeof BYBIT_INTERVAL];
      const payload = await fetchJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${value}&limit=${limit}`, signal);
      const candles = normalizeBybitCandles(payload, interval);
      if (candles.length < 2 || !validateCandleSpacing(candles, interval)) throw new Error("Invalid Bybit candles");
      return candles;
    });
  },
  async snapshot(symbol, signal) {
    return await measured("bybit", async () => {
      const [ticker, book, trades] = await Promise.all([
        fetchJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${symbol}`, signal),
        fetchJson(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=20`, signal),
        fetchJson(`https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=30`, signal),
      ]);
      return normalizeBybitSnapshot({ symbol, ticker, book, trades, receivedAt: Date.now() });
    });
  },
  async markets(signal) {
    return await measured("bybit", async () => {
      const payload = await fetchJson("https://api.bybit.com/v5/market/tickers?category=spot", signal);
      const selected = new Map((Array.isArray(payload?.result?.list) ? payload.result.list : []).map((row: Record<string, unknown>) => [String(row.symbol), row]));
      return [...SYMBOLS].map(symbol => {
        const row = selected.get(symbol) as Record<string, unknown> | undefined;
        const price = number(row?.lastPrice);
        const open = number(row?.prevPrice24h);
        return {
          symbol,
          provider: "bybit",
          price,
          open,
          high: number(row?.highPrice24h),
          low: number(row?.lowPrice24h),
          volume: number(row?.volume24h),
          quoteVolume: number(row?.turnover24h),
          change: number(row?.price24hPcnt) * 100,
          serverTime: number(payload?.time, Date.now()),
        };
      }).filter(row => row.price > 0);
    });
  },
  async probe(signal) {
    await measured("bybit", async () => {
      await fetchJson("https://api.bybit.com/v5/market/time", signal, 1200);
    });
  },
};

const providers: ProviderAdapter[] = [binance, okx, bybit];

async function withProvider<T>(operation: (provider: ProviderAdapter) => Promise<T>, preferred?: ProviderName) {
  const ordered = orderedProviders();
  if (preferred) ordered.sort((a, b) => Number(b.name === preferred) - Number(a.name === preferred));
  let lastError: unknown = new Error("No upstream provider available");
  for (const provider of ordered) {
    try {
      const value = await operation(provider);
      return { provider: provider.name, value };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function healthPayload(signal: AbortSignal) {
  await Promise.allSettled(orderedProviders().map(provider => provider.probe(signal)));
  return {
    version: VERSION,
    status: [...health.values()].some(item => item.lastSuccessAt > 0) ? "ok" : "degraded",
    serverTime: Date.now(),
    providers: Object.fromEntries([...health.entries()].map(([name, item]) => [name, {
      latencyMs: item.latency,
      failures: item.failures,
      lastSuccessAt: item.lastSuccessAt,
      lastFailureAt: item.lastFailureAt,
      status: item.lastSuccessAt >= item.lastFailureAt && item.lastSuccessAt > 0 ? "healthy" : "degraded",
    }])),
  };
}

function sseResponse(request: Request, url: URL, origin: string | null) {
  const symbol = validatedSymbol(url);
  const interval = validatedInterval(url);
  if (!symbol || !interval) return errorResponse("INVALID_ARGUMENT", "Unsupported symbol or interval", 400, origin);

  const encoder = new TextEncoder();
  const streamAbort = new AbortController();
  const abort = () => streamAbort.abort(new DOMException("Client disconnected", "AbortError"));
  request.signal.addEventListener("abort", abort, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let preferred: ProviderName | undefined;
      let lastCandleAt = 0;
      const startedAt = Date.now();
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", abort);
        try { controller.close(); } catch { /* already closed */ }
      };
      try {
        send("status", { version: VERSION, type: "status", state: "connecting", symbol, interval, serverTime: Date.now() });
        while (!streamAbort.signal.aborted && Date.now() - startedAt < 45_000) {
          const cycleStarted = Date.now();
          try {
            const result = await withProvider(provider => provider.snapshot(symbol, streamAbort.signal), preferred);
            preferred = result.provider;
            const snapshot = { ...result.value, interval, gatewaySequence: gatewaySequence++ };
            send("snapshot", snapshot);
            send("ticker", { version: VERSION, type: "ticker", symbol, interval, provider: preferred, serverTime: snapshot.serverTime, receivedAt: snapshot.receivedAt, sequence: snapshot.sequence, data: snapshot.ticker });
            send("book", { version: VERSION, type: "book", symbol, interval, provider: preferred, serverTime: snapshot.serverTime, receivedAt: snapshot.receivedAt, sequence: snapshot.sequence, data: snapshot.book });
            send("trades", { version: VERSION, type: "trades", symbol, interval, provider: preferred, serverTime: snapshot.serverTime, receivedAt: snapshot.receivedAt, sequence: snapshot.sequence, data: snapshot.trades });
            if (cycleStarted - lastCandleAt >= 2_400) {
              const candles = await providers.find(item => item.name === preferred)!.candles(symbol, interval, 2, streamAbort.signal);
              send("kline", { version: VERSION, type: "kline", symbol, interval, provider: preferred, serverTime: Date.now(), receivedAt: Date.now(), sequence: gatewaySequence++, data: candles.at(-1) });
              lastCandleAt = cycleStarted;
            }
            send("status", { version: VERSION, type: "status", state: "live", symbol, interval, provider: preferred, serverTime: Date.now() });
          } catch (error) {
            send("status", { version: VERSION, type: "status", state: "reconnecting", symbol, interval, provider: preferred || "", serverTime: Date.now(), error: error instanceof Error ? error.name : "UpstreamError" });
          }
          if (Date.now() - startedAt >= 45_000) break;
          await sleep(Math.max(100, 1_200 - (Date.now() - cycleStarted)), streamAbort.signal).catch(() => undefined);
        }
        if (!streamAbort.signal.aborted) send("heartbeat", { version: VERSION, type: "heartbeat", serverTime: Date.now() });
      } finally {
        close();
      }
    },
    cancel() {
      abort();
    },
  });

  const headers = corsHeaders(origin);
  headers.set("Content-Type", "text/event-stream; charset=utf-8");
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("Connection", "keep-alive");
  headers.set("X-Accel-Buffering", "no");
  return new Response(body, { status: 200, headers });
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return errorResponse("ORIGIN_NOT_ALLOWED", "Origin is not allowed", 403, null);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "GET") return errorResponse("METHOD_NOT_ALLOWED", "Only GET is supported", 405, origin);
  if (!allowRate(request)) return errorResponse("RATE_LIMITED", "Too many requests", 429, origin);

  const url = new URL(request.url);
  const route = routeFrom(url);
  try {
    if (route === "/health") {
      return jsonResponse(await healthPayload(request.signal), 200, origin, 5);
    }
    if (route === "/markets") {
      const result = await withProvider(provider => provider.markets(request.signal));
      return jsonResponse({ version: VERSION, provider: result.provider, serverTime: Date.now(), receivedAt: Date.now(), markets: result.value }, 200, origin, 2);
    }
    if (route === "/snapshot") {
      const symbol = validatedSymbol(url);
      if (!symbol) return errorResponse("INVALID_SYMBOL", "Unsupported symbol", 400, origin);
      const result = await withProvider(provider => provider.snapshot(symbol, request.signal));
      return jsonResponse(result.value, 200, origin);
    }
    if (route === "/candles") {
      const symbol = validatedSymbol(url);
      const interval = validatedInterval(url);
      const limit = clamp(Math.trunc(number(url.searchParams.get("limit"), 300)), 20, 500);
      if (!symbol || !interval) return errorResponse("INVALID_ARGUMENT", "Unsupported symbol or interval", 400, origin);
      const result = await withProvider(provider => provider.candles(symbol, interval, limit, request.signal));
      return jsonResponse({ version: VERSION, symbol, interval, provider: result.provider, serverTime: Date.now(), receivedAt: Date.now(), candles: result.value }, 200, origin, 2);
    }
    if (route === "/stream") return sseResponse(request, url, origin);
    return errorResponse("NOT_FOUND", "Unknown gateway route", 404, origin);
  } catch (error) {
    const code = request.signal.aborted ? "REQUEST_ABORTED" : "UPSTREAM_UNAVAILABLE";
    const message = request.signal.aborted ? "Request was aborted" : "Public market providers are temporarily unavailable";
    return errorResponse(code, message, request.signal.aborted ? 499 : 503, origin);
  }
});
