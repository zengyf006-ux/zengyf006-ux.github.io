import { PaperTradingLedgerError } from './errors.js';
import type { PaperTradingEvent, PaperTradingLedgerState } from './types.js';

export function createInitialLedgerState(): PaperTradingLedgerState {
  return {
    initialized: false,
    accountId: null,
    baseCurrency: null,
    initialCash: '0',
    cash: '0',
    orders: {},
    fills: [],
    positions: {},
    reservations: {},
    marketPrices: {},
    appliedEventIds: [],
    processedCommandIds: [],
    lastSequence: 0,
    lastOccurredAt: null,
  };
}

function withoutKey<T>(source: Readonly<Record<string, T>>, key: string): Readonly<Record<string, T>> {
  const output = { ...source };
  delete output[key];
  return output;
}

export function applyPaperTradingEvent(
  current: PaperTradingLedgerState,
  event: PaperTradingEvent,
): PaperTradingLedgerState {
  if (current.appliedEventIds.includes(event.eventId)) return current;
  if (event.sequence <= current.lastSequence) return current;

  const common = {
    appliedEventIds: [...current.appliedEventIds, event.eventId],
    processedCommandIds: current.processedCommandIds.includes(event.commandId)
      ? current.processedCommandIds
      : [...current.processedCommandIds, event.commandId],
    lastSequence: event.sequence,
    lastOccurredAt: event.occurredAt,
  } as const;

  switch (event.type) {
    case 'accountInitialized':
      return {
        ...createInitialLedgerState(),
        initialized: true,
        accountId: event.accountId,
        baseCurrency: event.baseCurrency,
        initialCash: event.initialCash,
        cash: event.initialCash,
        ...common,
      };
    case 'accountReset':
      return {
        ...createInitialLedgerState(),
        initialized: true,
        accountId: event.accountId,
        baseCurrency: event.baseCurrency,
        initialCash: event.initialCash,
        cash: event.initialCash,
        appliedEventIds: [...current.appliedEventIds, event.eventId],
        processedCommandIds: current.processedCommandIds.includes(event.commandId)
          ? current.processedCommandIds
          : [...current.processedCommandIds, event.commandId],
        lastSequence: event.sequence,
        lastOccurredAt: event.occurredAt,
      };
    case 'orderSubmitted':
      return {
        ...current,
        orders: { ...current.orders, [event.record.order.orderId]: event.record },
        reservations: { ...current.reservations, [event.reservation.reservationId]: event.reservation },
        ...common,
      };
    case 'fillRecorded': {
      const previousReservationId = current.orders[event.record.order.orderId]?.reservationId ?? null;
      const reservations = previousReservationId === null
        ? current.reservations
        : event.reservationAfter === null
          ? withoutKey(current.reservations, previousReservationId)
          : { ...current.reservations, [previousReservationId]: event.reservationAfter };
      return {
        ...current,
        cash: event.cashAfter,
        orders: { ...current.orders, [event.record.order.orderId]: event.record },
        fills: [...current.fills, event.fill],
        positions: { ...current.positions, [event.positionAfter.symbol]: event.positionAfter },
        reservations,
        marketPrices: { ...current.marketPrices, [event.positionAfter.symbol]: event.positionAfter.marketPrice ?? event.fill.price },
        ...common,
      };
    }
    case 'orderCanceled':
      return {
        ...current,
        orders: { ...current.orders, [event.record.order.orderId]: event.record },
        reservations: event.releasedReservationId === null
          ? current.reservations
          : withoutKey(current.reservations, event.releasedReservationId),
        ...common,
      };
    case 'marketPriceMarked': {
      const position = current.positions[event.symbol];
      const orders = { ...current.orders };
      for (const record of event.triggeredOrders) {
        orders[record.order.orderId] = record;
      }
      return {
        ...current,
        orders,
        marketPrices: { ...current.marketPrices, [event.symbol]: event.price },
        positions: position === undefined
          ? current.positions
          : {
              ...current.positions,
              [event.symbol]: { ...position, marketPrice: event.price, updatedAt: event.occurredAt },
            },
        ...common,
      };
    }
  }
}

export function replayPaperTradingEvents(events: readonly PaperTradingEvent[]): PaperTradingLedgerState {
  let state = createInitialLedgerState();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (state.appliedEventIds.includes(event.eventId)) continue;
    const expected = state.lastSequence + 1;
    if (event.sequence !== expected) {
      throw new PaperTradingLedgerError(
        'STORAGE_FAILURE',
        `Paper event sequence gap: expected ${expected}, received ${event.sequence}`,
      );
    }
    state = applyPaperTradingEvent(state, event);
  }
  return state;
}
