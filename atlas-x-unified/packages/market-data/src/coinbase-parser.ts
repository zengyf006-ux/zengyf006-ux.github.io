import type {
  DataSource,
  DomainError,
  EventMetadata,
  MarketEventEnvelope,
  OrderBookSnapshot,
  Ticker,
  Trade,
} from '@atlas-x/contracts';
import { SCHEMA_VERSION } from '@atlas-x/contracts';
import { decimalString, multiplyDecimal, parseDecimal } from '@atlas-x/domain';

export const COINBASE_PUBLIC_FEED_URL = 'wss://ws-feed.exchange.coinbase.com';
export const COINBASE_PROVIDER = 'coinbase-exchange';

export function createCoinbaseSubscription(products: readonly string[]): {
  readonly type: 'subscribe';
  readonly product_ids: readonly string[];
  readonly channels: readonly ['heartbeat', 'ticker', 'matches', 'level2'];
} {
  if (products.length === 0 || products.some((product) => product.trim().length === 0)) {
    throw new Error('Coinbase subscription requires at least one product');
  }
  return {
    type: 'subscribe',
    product_ids: [...new Set(products)],
    channels: ['heartbeat', 'ticker', 'matches', 'level2'],
  };
}

export class MarketDataParseError extends Error {
  readonly code: DomainError['code'] = 'DATA_SOURCE_INVALID';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MarketDataParseError';
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label = 'payload'): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketDataParseError(`Invalid ${label}`);
  }
  return value as UnknownRecord;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new MarketDataParseError(`Invalid ${label}`);
  }
  return value;
}

function integerField(value: unknown, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new MarketDataParseError(`Invalid ${label}`);
  }
  return value as number;
}

function canonical(value: unknown, label: string, allowZero: boolean): string {
  try {
    const parsed = parseDecimal(value);
    if (allowZero ? parsed.isNegative() : !parsed.greaterThan(0)) throw new Error('out of range');
    return decimalString(parsed);
  } catch (cause) {
    throw new MarketDataParseError(`Invalid ${label}`, { cause });
  }
}

function realSource(): DataSource {
  return { truthfulness: 'real', provider: COINBASE_PROVIDER };
}

function metadata(
  kind: string,
  product: string,
  sequence: number,
  serverTime: string,
  receivedAt: string,
  suffix?: string,
): EventMetadata {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${COINBASE_PROVIDER}:${kind}:${product}:${suffix ?? String(sequence)}`,
    source: realSource(),
    sequence,
    serverTime,
    receivedAt,
  };
}

function envelope(
  eventType: MarketEventEnvelope['eventType'],
  eventMetadata: EventMetadata,
  payload: MarketEventEnvelope['payload'],
): MarketEventEnvelope {
  return { schemaVersion: SCHEMA_VERSION, eventType, metadata: eventMetadata, payload };
}

type OrderBookLevel = OrderBookSnapshot['bids'][number];
interface ProductBook {
  readonly bids: Map<string, string>;
  readonly asks: Map<string, string>;
}

export interface CoinbaseParserOptions {
  readonly tickSizes: Readonly<Record<string, string>>;
}

export interface CoinbaseParseResult {
  readonly events: readonly MarketEventEnvelope[];
  readonly productId?: string;
  readonly sequence?: number;
}

export class CoinbaseMarketParser {
  private readonly books = new Map<string, ProductBook>();

  constructor(private readonly options: CoinbaseParserOptions) {}

  parse(value: unknown, receivedAt: string): CoinbaseParseResult {
    const message = record(value);
    const type = stringField(message['type'], 'message type');
    switch (type) {
      case 'subscriptions':
      case 'heartbeat':
        return {
          events: [],
          ...(typeof message['product_id'] === 'string' ? { productId: message['product_id'] } : {}),
          ...(Number.isSafeInteger(message['sequence']) ? { sequence: message['sequence'] as number } : {}),
        };
      case 'ticker': return this.parseTicker(message, receivedAt);
      case 'match':
      case 'last_match': return this.parseTrade(message, receivedAt);
      case 'snapshot': return this.parseSnapshot(message, receivedAt);
      case 'l2update': return this.parseLevel2Update(message, receivedAt);
      default: return { events: [] };
    }
  }

  private parseTicker(message: UnknownRecord, receivedAt: string): CoinbaseParseResult {
    const product = stringField(message['product_id'], 'product_id');
    const sequence = integerField(message['sequence'], 'sequence');
    const serverTime = typeof message['time'] === 'string' ? message['time'] : receivedAt;
    const eventMetadata = metadata('ticker', product, sequence, serverTime, receivedAt);
    const last = canonical(message['price'], 'price', false);
    const volume = canonical(message['volume_24h'], 'volume_24h', true);
    const ticker: Ticker = {
      metadata: eventMetadata,
      symbol: product,
      bid: canonical(message['best_bid'], 'best_bid', false),
      ask: canonical(message['best_ask'], 'best_ask', false),
      last,
      open24h: canonical(message['open_24h'], 'open_24h', false),
      high24h: canonical(message['high_24h'], 'high_24h', false),
      low24h: canonical(message['low_24h'], 'low_24h', false),
      baseVolume24h: volume,
      quoteVolume24h: multiplyDecimal(last, volume),
    };
    return { events: [envelope('ticker', eventMetadata, ticker)], productId: product, sequence };
  }

  private parseTrade(message: UnknownRecord, receivedAt: string): CoinbaseParseResult {
    const product = stringField(message['product_id'], 'product_id');
    const sequence = integerField(message['sequence'], 'sequence');
    const tradeId = String(integerField(message['trade_id'], 'trade_id'));
    const side = stringField(message['side'], 'side');
    if (side !== 'buy' && side !== 'sell') throw new MarketDataParseError('Invalid side');
    const price = canonical(message['price'], 'price', false);
    const quantity = canonical(message['size'], 'size', false);
    const serverTime = typeof message['time'] === 'string' ? message['time'] : receivedAt;
    const eventMetadata = metadata('trade', product, sequence, serverTime, receivedAt, tradeId);
    const trade: Trade = {
      metadata: eventMetadata,
      tradeId,
      symbol: product,
      side,
      price,
      quantity,
      quoteAmount: multiplyDecimal(price, quantity),
    };
    return { events: [envelope('trade', eventMetadata, trade)], productId: product, sequence };
  }

  private parseSnapshot(message: UnknownRecord, receivedAt: string): CoinbaseParseResult {
    const product = stringField(message['product_id'], 'product_id');
    const book = this.book(product);
    book.bids.clear();
    book.asks.clear();
    this.loadLevels(book.bids, message['bids'], 'bids');
    this.loadLevels(book.asks, message['asks'], 'asks');
    return { events: [this.bookEvent(product, 0, receivedAt, receivedAt)], productId: product };
  }

  private parseLevel2Update(message: UnknownRecord, receivedAt: string): CoinbaseParseResult {
    const product = stringField(message['product_id'], 'product_id');
    const book = this.book(product);
    const changes = message['changes'];
    if (!Array.isArray(changes)) throw new MarketDataParseError('Invalid changes');
    for (const change of changes) {
      if (!Array.isArray(change) || change.length < 3) throw new MarketDataParseError('Invalid level2 change');
      const side = stringField(change[0], 'level2 side');
      const price = canonical(change[1], 'level2 price', false);
      const quantity = canonical(change[2], 'level2 quantity', true);
      const levels = side === 'buy' ? book.bids : side === 'sell' ? book.asks : null;
      if (levels === null) throw new MarketDataParseError('Invalid level2 side');
      if (quantity === '0') levels.delete(price);
      else levels.set(price, quantity);
    }
    const serverTime = typeof message['time'] === 'string' ? message['time'] : receivedAt;
    const sequence = Number.isSafeInteger(message['sequence']) ? message['sequence'] as number : 0;
    return {
      events: [this.bookEvent(product, sequence, serverTime, receivedAt)],
      productId: product,
      ...(sequence === 0 ? {} : { sequence }),
    };
  }

  private book(product: string): ProductBook {
    let book = this.books.get(product);
    if (book === undefined) {
      book = { bids: new Map(), asks: new Map() };
      this.books.set(product, book);
    }
    return book;
  }

  private loadLevels(target: Map<string, string>, value: unknown, label: string): void {
    if (!Array.isArray(value)) throw new MarketDataParseError(`Invalid ${label}`);
    for (const level of value) {
      if (!Array.isArray(level) || level.length < 2) throw new MarketDataParseError(`Invalid ${label} level`);
      const price = canonical(level[0], `${label} price`, false);
      const quantity = canonical(level[1], `${label} quantity`, false);
      target.set(price, quantity);
    }
  }

  private sortedLevels(levels: Map<string, string>, descending: boolean): OrderBookLevel[] {
    return [...levels.entries()]
      .sort(([left], [right]) => {
        const comparison = parseDecimal(left).comparedTo(parseDecimal(right));
        return descending ? -comparison : comparison;
      })
      .map(([price, quantity]) => ({ price, quantity }));
  }

  private bookEvent(product: string, sequence: number, serverTime: string, receivedAt: string): MarketEventEnvelope {
    const book = this.book(product);
    const eventMetadata = metadata('orderBook', product, sequence, serverTime, receivedAt);
    const tickSize = canonical(this.options.tickSizes[product] ?? '0.01', 'tick size', false);
    const snapshot: OrderBookSnapshot = {
      metadata: eventMetadata,
      symbol: product,
      tickSize,
      bids: this.sortedLevels(book.bids, true),
      asks: this.sortedLevels(book.asks, false),
    };
    return envelope('orderBook', eventMetadata, snapshot);
  }
}
