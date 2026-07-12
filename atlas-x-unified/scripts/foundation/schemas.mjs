import {
  DECIMAL_FORMAT, SCHEMA_VERSION, decimal, identifier, nonNegative, nullable,
  object, positive, ref, timestamp,
} from './schema-helpers.mjs';

const eventFields = {
  schemaVersion: ref('SchemaVersion'),
  id: identifier,
  source: ref('DataSource'),
  sequence: { type: 'integer', minimum: 0 },
  serverTime: timestamp,
  receivedAt: timestamp,
};

export const schemas = {
  SchemaVersion: { type: 'string', const: SCHEMA_VERSION, examples: [SCHEMA_VERSION] },
  DecimalString: {
    type: 'string',
    format: DECIMAL_FORMAT,
    pattern: '^(?:0|-?(?:0\\.\\d*[1-9]|[1-9]\\d*(?:\\.\\d*[1-9])?))$',
    description: 'Canonical decimal string with at most 34 significant digits; JSON numbers and exponent notation are forbidden.',
  },
  NonNegativeDecimalString: {
    type: 'string', format: DECIMAL_FORMAT,
    pattern: '^(?:0|0\\.\\d*[1-9]|[1-9]\\d*(?:\\.\\d*[1-9])?)$',
  },
  PositiveDecimalString: {
    type: 'string', format: DECIMAL_FORMAT,
    pattern: '^(?:0\\.\\d*[1-9]|[1-9]\\d*(?:\\.\\d*[1-9])?)$',
  },
  Truthfulness: { type: 'string', enum: ['unknown', 'cachedReal', 'real', 'simulated', 'fixture'] },
  UnknownDataSource: object(['truthfulness'], {
    truthfulness: { const: 'unknown' }, provider: identifier, reason: identifier,
  }),
  CachedRealDataSource: object(['truthfulness', 'provider', 'cacheTime'], {
    truthfulness: { const: 'cachedReal' }, provider: identifier, cacheTime: timestamp,
  }),
  RealDataSource: object(['truthfulness', 'provider'], {
    truthfulness: { const: 'real' }, provider: identifier,
  }),
  SimulatedDataSource: object(['truthfulness', 'provider'], {
    truthfulness: { const: 'simulated' }, provider: identifier, scenario: identifier,
  }),
  FixtureDataSource: object(['truthfulness', 'fixtureId'], {
    truthfulness: { const: 'fixture' }, fixtureId: identifier, provider: identifier,
  }),
  DataSource: {
    oneOf: ['Unknown', 'CachedReal', 'Real', 'Simulated', 'Fixture'].map((name) => ref(`${name}DataSource`)),
    discriminator: { propertyName: 'truthfulness' },
  },
  EventMetadata: object(Object.keys(eventFields), eventFields),
  Symbol: { type: 'string', pattern: '^[A-Z0-9]+-[A-Z0-9]+$' },
  MarketConnectionState: {
    type: 'string',
    enum: ['initializing', 'cached', 'live', 'delayed', 'reconnecting', 'stale', 'offline', 'degraded', 'error'],
  },
  MarketConnection: object(['schemaVersion', 'state', 'source', 'updatedAt'], {
    schemaVersion: ref('SchemaVersion'), state: ref('MarketConnectionState'), source: ref('DataSource'),
    updatedAt: timestamp, latencyMs: { type: 'integer', minimum: 0 }, retryAt: nullable(timestamp),
    error: nullable(ref('DomainError')),
  }),
  Ticker: object([
    'metadata', 'symbol', 'bid', 'ask', 'last', 'open24h', 'high24h', 'low24h',
    'baseVolume24h', 'quoteVolume24h',
  ], {
    metadata: ref('EventMetadata'), symbol: ref('Symbol'), bid: positive, ask: positive, last: positive,
    open24h: positive, high24h: positive, low24h: positive,
    baseVolume24h: nonNegative, quoteVolume24h: nonNegative,
  }),
  Trade: object(['metadata', 'tradeId', 'symbol', 'side', 'price', 'quantity', 'quoteAmount'], {
    metadata: ref('EventMetadata'), tradeId: identifier, symbol: ref('Symbol'),
    side: { type: 'string', enum: ['buy', 'sell'] }, price: positive, quantity: positive, quoteAmount: positive,
  }),
  CandleInterval: { type: 'string', enum: ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w'] },
  Candle: object([
    'metadata', 'symbol', 'interval', 'openTime', 'closeTime', 'open', 'high', 'low', 'close',
    'volume', 'quoteVolume', 'closed',
  ], {
    metadata: ref('EventMetadata'), symbol: ref('Symbol'), interval: ref('CandleInterval'),
    openTime: timestamp, closeTime: timestamp, open: positive, high: positive, low: positive,
    close: positive, volume: nonNegative, quoteVolume: nonNegative, closed: { type: 'boolean' },
  }),
  OrderBookLevel: object(['price', 'quantity'], { price: positive, quantity: positive }),
  OrderBookSnapshot: object(['metadata', 'symbol', 'tickSize', 'bids', 'asks'], {
    metadata: ref('EventMetadata'), symbol: ref('Symbol'), tickSize: positive,
    bids: { type: 'array', items: ref('OrderBookLevel') },
    asks: { type: 'array', items: ref('OrderBookLevel') },
  }),
  MarketSnapshot: object(['metadata', 'symbol', 'bid', 'ask', 'last', 'baseVolume', 'quoteVolume'], {
    metadata: ref('EventMetadata'), symbol: ref('Symbol'), bid: positive, ask: positive, last: positive,
    baseVolume: nonNegative, quoteVolume: nonNegative,
  }),
  MarketEventEnvelope: object(['schemaVersion', 'eventType', 'metadata', 'payload'], {
    schemaVersion: ref('SchemaVersion'),
    eventType: { type: 'string', enum: ['ticker', 'trade', 'candle', 'orderBook'] },
    metadata: ref('EventMetadata'),
    payload: { oneOf: [ref('Ticker'), ref('Trade'), ref('Candle'), ref('OrderBookSnapshot')] },
  }),
  AccountAsset: object(['metadata', 'accountId', 'asset', 'available', 'locked', 'total'], {
    metadata: ref('EventMetadata'), accountId: identifier, asset: { type: 'string', pattern: '^[A-Z0-9]+$' },
    available: nonNegative, locked: nonNegative, total: nonNegative,
  }),
  Position: object([
    'schemaVersion', 'positionId', 'symbol', 'side', 'quantity', 'averageEntryPrice', 'marketPrice',
    'marketValue', 'realizedPnl', 'unrealizedPnl', 'updatedAt',
  ], {
    schemaVersion: ref('SchemaVersion'), positionId: identifier, symbol: ref('Symbol'), side: { const: 'long' },
    quantity: nonNegative, averageEntryPrice: nullable(positive), marketPrice: nullable(positive),
    marketValue: nonNegative, realizedPnl: decimal, unrealizedPnl: nullable(decimal), updatedAt: timestamp,
  }),
  Reservation: object([
    'schemaVersion', 'reservationId', 'accountId', 'asset', 'amount', 'reason', 'referenceId', 'createdAt',
  ], {
    schemaVersion: ref('SchemaVersion'), reservationId: identifier, accountId: identifier,
    asset: { type: 'string', pattern: '^[A-Z0-9]+$' }, amount: positive,
    reason: { type: 'string', enum: ['order', 'fee', 'settlement'] }, referenceId: identifier, createdAt: timestamp,
  }),
  AccountSnapshot: object([
    'metadata', 'accountId', 'baseCurrency', 'equity', 'availableCash', 'assets', 'positions', 'reservations',
  ], {
    metadata: ref('EventMetadata'), accountId: identifier,
    baseCurrency: { type: 'string', pattern: '^[A-Z0-9]+$' }, equity: nonNegative, availableCash: nonNegative,
    assets: { type: 'array', items: ref('AccountAsset') }, positions: { type: 'array', items: ref('Position') },
    reservations: { type: 'array', items: ref('Reservation') },
  }),
  OrderSide: { type: 'string', enum: ['buy', 'sell'] },
  OrderType: { type: 'string', enum: ['market', 'limit', 'stopMarket', 'stopLimit'] },
  OrderStatus: {
    type: 'string',
    enum: ['draft', 'validating', 'reviewRequired', 'submitting', 'received', 'accepted', 'pending',
      'waitingTrigger', 'partiallyFilled', 'filled', 'canceled', 'expired', 'rejected', 'failed'],
  },
  OrderIntent: object(['schemaVersion', 'intentId', 'symbol', 'side', 'type', 'inputMode', 'inputValue', 'createdAt'], {
    schemaVersion: ref('SchemaVersion'), intentId: identifier, symbol: ref('Symbol'), side: ref('OrderSide'),
    type: ref('OrderType'), inputMode: { type: 'string', enum: ['quantity', 'amount', 'percentage'] },
    inputValue: positive, limitPrice: positive, stopPrice: positive, createdAt: timestamp,
  }),
  OrderEstimate: object([
    'schemaVersion', 'requestedQuantity', 'filledQuantity', 'unfilledQuantity', 'grossAmount', 'fee',
    'coverageRate', 'requiredBalance', 'availableBalance', 'insufficientBalance', 'depthInsufficient',
  ], {
    schemaVersion: ref('SchemaVersion'), requestedQuantity: positive, filledQuantity: nonNegative,
    unfilledQuantity: nonNegative, grossAmount: nonNegative, vwap: nullable(positive),
    referencePrice: nullable(positive), slippageRate: nullable(decimal), fee: nonNegative,
    coverageRate: nonNegative, requiredBalance: nonNegative, availableBalance: nonNegative,
    insufficientBalance: { type: 'boolean' }, depthInsufficient: { type: 'boolean' },
    warnings: { type: 'array', items: ref('DomainError') },
  }),
  OrderValidation: object(['schemaVersion', 'valid', 'reviewRequired', 'errors', 'warnings'], {
    schemaVersion: ref('SchemaVersion'), valid: { type: 'boolean' }, reviewRequired: { type: 'boolean' },
    errors: { type: 'array', items: ref('DomainError') }, warnings: { type: 'array', items: ref('DomainError') },
  }),
  RiskAssessment: object([
    'schemaVersion', 'equity', 'availableCash', 'riskBudget', 'stopDistance', 'unitRisk', 'quantityByRisk',
    'quantityByBalance', 'suggestedQuantity', 'notional', 'entryFee', 'exitFeeAtStop', 'totalCapital',
    'riskAmount', 'bindingConstraint',
  ], {
    schemaVersion: ref('SchemaVersion'), equity: nonNegative, availableCash: nonNegative,
    riskBudget: nonNegative, stopDistance: positive, unitRisk: positive, quantityByRisk: nonNegative,
    quantityByBalance: nonNegative, suggestedQuantity: nonNegative, notional: nonNegative,
    entryFee: nonNegative, exitFeeAtStop: nonNegative, totalCapital: nonNegative, riskAmount: nonNegative,
    targetPrice: nullable(positive), rewardAmount: nullable(nonNegative), rewardRiskRatio: nullable(nonNegative),
    bindingConstraint: { type: 'string', enum: ['risk', 'balance'] },
    warnings: { type: 'array', items: ref('DomainError') },
  }),
  Strategy: object(['schemaVersion', 'strategyId', 'name', 'enabled', 'symbols', 'riskRate', 'createdAt', 'updatedAt'], {
    schemaVersion: ref('SchemaVersion'), strategyId: identifier, name: identifier, enabled: { type: 'boolean' },
    symbols: { type: 'array', items: ref('Symbol'), uniqueItems: true }, riskRate: positive,
    createdAt: timestamp, updatedAt: timestamp,
  }),
  AlertRule: object(['schemaVersion', 'alertId', 'symbol', 'condition', 'threshold', 'enabled', 'createdAt'], {
    schemaVersion: ref('SchemaVersion'), alertId: identifier, symbol: ref('Symbol'),
    condition: { type: 'string', enum: ['priceAbove', 'priceBelow', 'changeAbove', 'changeBelow', 'connectionState'] },
    threshold: decimal, enabled: { type: 'boolean' }, createdAt: timestamp,
  }),
  DomainErrorCode: {
    type: 'string',
    enum: ['DECIMAL_INVALID', 'SCHEMA_VERSION_UNSUPPORTED', 'DATA_SOURCE_INVALID', 'MARKET_OFFLINE',
      'MARKET_STALE', 'MARKET_DEGRADED', 'ORDER_INVALID', 'ORDER_INSUFFICIENT_BALANCE',
      'ORDER_INSUFFICIENT_DEPTH', 'ORDER_NOT_FOUND', 'ORDER_ALREADY_FINAL', 'RISK_INVALID_INPUT',
      'RISK_INVALID_STOP', 'RISK_INVALID_TARGET', 'RISK_INSUFFICIENT_EQUITY', 'STORAGE_FAILURE',
      'INTERNAL_FAILURE'],
  },
  DomainError: object(['schemaVersion', 'code', 'message'], {
    schemaVersion: ref('SchemaVersion'), code: ref('DomainErrorCode'), message: identifier,
    field: identifier, retryable: { type: 'boolean' }, details: { type: 'object', additionalProperties: true },
  }),
  ErrorObject: ref('DomainError'),
  AuditEvent: object(['metadata', 'auditId', 'action', 'entityType', 'entityId', 'outcome'], {
    metadata: ref('EventMetadata'), auditId: identifier, action: identifier, entityType: identifier,
    entityId: identifier, outcome: { type: 'string', enum: ['success', 'rejected', 'failed'] },
    error: nullable(ref('DomainError')),
  }),
  AppSnapshot: object([
    'schemaVersion', 'capturedAt', 'marketConnection', 'markets', 'account', 'orders', 'fills', 'strategies', 'alerts',
  ], {
    schemaVersion: ref('SchemaVersion'), capturedAt: timestamp, marketConnection: ref('MarketConnection'),
    markets: { type: 'array', items: ref('Ticker') }, account: ref('AccountSnapshot'),
    orders: { type: 'array', items: ref('Order') }, fills: { type: 'array', items: ref('Fill') },
    strategies: { type: 'array', items: ref('Strategy') }, alerts: { type: 'array', items: ref('AlertRule') },
  }),
};

const orderBase = {
  schemaVersion: ref('SchemaVersion'), clientOrderId: identifier, symbol: ref('Symbol'),
  side: ref('OrderSide'), quantity: positive, createdAt: timestamp,
};
const drafts = [
  ['MarketOrderDraft', 'market', {}],
  ['LimitOrderDraft', 'limit', { price: positive }],
  ['StopMarketOrderDraft', 'stopMarket', { stopPrice: positive }],
  ['StopLimitOrderDraft', 'stopLimit', { price: positive, stopPrice: positive }],
];
for (const [name, type, extras] of drafts) {
  schemas[name] = object([...Object.keys(orderBase), 'type', ...Object.keys(extras)], {
    ...orderBase, type: { const: type }, ...extras,
  });
}
schemas.OrderDraft = {
  oneOf: ['MarketOrderDraft', 'LimitOrderDraft', 'StopMarketOrderDraft', 'StopLimitOrderDraft'].map(ref),
  discriminator: { propertyName: 'type' },
};
schemas.Order = object([
  'metadata', 'orderId', 'draft', 'status', 'filledQuantity', 'remainingQuantity', 'feePaid', 'updatedAt',
], {
  metadata: ref('EventMetadata'), orderId: identifier, draft: ref('OrderDraft'), status: ref('OrderStatus'),
  filledQuantity: nonNegative, remainingQuantity: nonNegative, averageFillPrice: nullable(positive),
  feePaid: nonNegative, updatedAt: timestamp, failure: nullable(ref('DomainError')),
});
schemas.Fill = object([
  'metadata', 'fillId', 'orderId', 'symbol', 'side', 'price', 'quantity', 'quoteAmount', 'fee', 'feeAsset',
], {
  metadata: ref('EventMetadata'), fillId: identifier, orderId: identifier, symbol: ref('Symbol'),
  side: ref('OrderSide'), price: positive, quantity: positive, quoteAmount: positive, fee: nonNegative,
  feeAsset: { type: 'string', pattern: '^[A-Z0-9]+$' },
});
