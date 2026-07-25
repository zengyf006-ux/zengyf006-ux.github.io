import type {
  AccountSnapshot,
  AppSnapshot,
  DomainError,
  Fill,
  Order,
  OrderDraft,
  Position,
  Reservation,
} from '@atlas-x/contracts';

export interface PaperOrderRecord {
  readonly order: Order;
  readonly reservationId: string | null;
  readonly reservePrice: string;
  readonly feeRate: string;
}

export interface PaperPositionRecord {
  readonly symbol: string;
  readonly quantity: string;
  readonly averageEntryPrice: string | null;
  readonly realizedPnl: string;
  readonly marketPrice: string | null;
  readonly updatedAt: string;
}

export interface PaperTradingLedgerState {
  readonly initialized: boolean;
  readonly accountId: string | null;
  readonly baseCurrency: string | null;
  readonly initialCash: string;
  readonly cash: string;
  readonly orders: Readonly<Record<string, PaperOrderRecord>>;
  readonly fills: readonly Fill[];
  readonly positions: Readonly<Record<string, PaperPositionRecord>>;
  readonly reservations: Readonly<Record<string, Reservation>>;
  readonly marketPrices: Readonly<Record<string, string>>;
  readonly appliedEventIds: readonly string[];
  readonly processedCommandIds: readonly string[];
  readonly lastSequence: number;
  readonly lastOccurredAt: string | null;
}

interface EventBase {
  readonly eventId: string;
  readonly commandId: string;
  readonly sequence: number;
  readonly occurredAt: string;
}

export type PaperTradingEvent =
  | (EventBase & {
      readonly type: 'accountInitialized';
      readonly accountId: string;
      readonly baseCurrency: string;
      readonly initialCash: string;
    })
  | (EventBase & {
      readonly type: 'orderSubmitted';
      readonly record: PaperOrderRecord;
      readonly reservation: Reservation;
    })
  | (EventBase & {
      readonly type: 'fillRecorded';
      readonly fill: Fill;
      readonly record: PaperOrderRecord;
      readonly cashAfter: string;
      readonly positionAfter: PaperPositionRecord;
      readonly reservationAfter: Reservation | null;
    })
  | (EventBase & {
      readonly type: 'orderCanceled';
      readonly record: PaperOrderRecord;
      readonly releasedReservationId: string | null;
    })
  | (EventBase & {
      readonly type: 'marketPriceMarked';
      readonly symbol: string;
      readonly price: string;
      readonly triggeredOrders: readonly PaperOrderRecord[];
    })
  | (EventBase & {
      readonly type: 'accountReset';
      readonly accountId: string;
      readonly baseCurrency: string;
      readonly initialCash: string;
    });

export type PaperTradingCommand =
  | {
      readonly type: 'submitOrder';
      readonly commandId: string;
      readonly draft: OrderDraft;
      readonly referencePrice: string;
    }
  | {
      readonly type: 'recordFill';
      readonly commandId: string;
      readonly orderId: string;
      readonly price: string;
      readonly quantity: string;
    }
  | { readonly type: 'cancelOrder'; readonly commandId: string; readonly orderId: string }
  | { readonly type: 'markPrice'; readonly commandId: string; readonly symbol: string; readonly price: string }
  | { readonly type: 'resetAccount'; readonly commandId: string; readonly confirmationToken: string };

export type PaperTradingResult =
  | { readonly ok: true; readonly account: AccountSnapshot; readonly order?: Order }
  | { readonly ok: false; readonly error: DomainError };

export interface PaperTradingPort {
  execute(command: PaperTradingCommand): Promise<PaperTradingResult>;
  snapshot(): Promise<AppSnapshot>;
}

export interface PaperTradingEventStore {
  append(events: readonly PaperTradingEvent[]): Promise<void>;
  readAll(): Promise<readonly PaperTradingEvent[]>;
  clear(): Promise<void>;
  replaceAll(events: readonly PaperTradingEvent[]): Promise<void>;
}

export interface PaperTradingLedgerOptions {
  readonly store: PaperTradingEventStore;
  readonly accountId: string;
  readonly baseCurrency: string;
  readonly initialCash: string;
  readonly feeRate: string;
  readonly now: () => string;
  readonly id: () => string;
}

export type { AccountSnapshot, AppSnapshot, DomainError, Fill, Order, OrderDraft, Position, Reservation };
