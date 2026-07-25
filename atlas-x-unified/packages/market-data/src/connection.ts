import type { DomainError, MarketConnection } from '@atlas-x/contracts';
import { SCHEMA_VERSION } from '@atlas-x/contracts';

export type MarketConnectionEvent =
  | { readonly type: 'cacheLoaded'; readonly provider: string; readonly cacheTime: string }
  | { readonly type: 'subscribed'; readonly provider: string }
  | { readonly type: 'message'; readonly provider: string; readonly latencyMs: number; readonly delayedAfterMs: number }
  | { readonly type: 'sequenceGap'; readonly provider: string; readonly expected: number; readonly actual: number }
  | { readonly type: 'stale'; readonly provider: string; readonly ageMs: number }
  | { readonly type: 'socketClosed'; readonly provider: string; readonly retryAt: string }
  | { readonly type: 'offline' }
  | {
      readonly type: 'degraded';
      readonly code: DomainError['code'];
      readonly message: string;
      readonly provider: string;
      readonly details?: Record<string, unknown>;
    }
  | {
      readonly type: 'fatal';
      readonly code: DomainError['code'];
      readonly message: string;
      readonly provider?: string;
      readonly retryable?: boolean;
    };

function error(
  code: DomainError['code'],
  message: string,
  details?: Record<string, unknown>,
  retryable = true,
): DomainError {
  return {
    schemaVersion: SCHEMA_VERSION,
    code,
    message,
    retryable,
    ...(details === undefined ? {} : { details }),
  };
}

export function initialMarketConnection(now: string): MarketConnection {
  return {
    schemaVersion: SCHEMA_VERSION,
    state: 'initializing',
    source: { truthfulness: 'unknown', reason: 'initializing' },
    updatedAt: now,
  };
}

export function reduceMarketConnection(
  current: MarketConnection,
  event: MarketConnectionEvent,
  now: string,
): MarketConnection {
  switch (event.type) {
    case 'cacheLoaded':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'cached',
        source: {
          truthfulness: 'cachedReal',
          provider: event.provider,
          cacheTime: event.cacheTime,
        },
        updatedAt: now,
      };
    case 'subscribed':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'live',
        source: { truthfulness: 'real', provider: event.provider },
        updatedAt: now,
        latencyMs: 0,
        retryAt: null,
        error: null,
      };
    case 'message':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: event.latencyMs > event.delayedAfterMs ? 'delayed' : 'live',
        source: { truthfulness: 'real', provider: event.provider },
        updatedAt: now,
        latencyMs: event.latencyMs,
        retryAt: null,
        error: null,
      };
    case 'sequenceGap':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'degraded',
        source: { truthfulness: 'real', provider: event.provider },
        updatedAt: now,
        error: error('MARKET_DEGRADED', 'Market sequence gap detected', {
          expected: event.expected,
          actual: event.actual,
        }),
      };
    case 'stale':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'stale',
        source: current.source.truthfulness === 'real'
          ? current.source
          : { truthfulness: 'unknown', provider: event.provider, reason: 'stale' },
        updatedAt: now,
        error: error('MARKET_STALE', 'Market data is stale', { ageMs: event.ageMs }),
      };
    case 'socketClosed':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'reconnecting',
        source: { truthfulness: 'unknown', provider: event.provider, reason: 'socketClosed' },
        updatedAt: now,
        retryAt: event.retryAt,
        error: error('MARKET_OFFLINE', 'Market connection closed; reconnect scheduled'),
      };
    case 'offline':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'offline',
        source: { truthfulness: 'unknown', reason: 'offline' },
        updatedAt: now,
        error: error('MARKET_OFFLINE', 'Network is offline'),
      };
    case 'degraded':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'degraded',
        source: current.source.truthfulness === 'real'
          ? current.source
          : { truthfulness: 'real', provider: event.provider },
        updatedAt: now,
        error: error(event.code, event.message, event.details, true),
      };
    case 'fatal':
      return {
        schemaVersion: SCHEMA_VERSION,
        state: 'error',
        source: {
          truthfulness: 'unknown',
          ...(event.provider === undefined ? {} : { provider: event.provider }),
          reason: event.code,
        },
        updatedAt: now,
        error: error(event.code, event.message, undefined, event.retryable ?? false),
      };
  }
}

export function reconnectDelay(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new Error('Reconnect attempt must be a non-negative integer');
  }
  return Math.min(500 * (2 ** attempt), 30_000);
}
