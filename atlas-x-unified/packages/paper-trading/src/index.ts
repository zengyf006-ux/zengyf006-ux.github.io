import type { AccountSnapshot, AppSnapshot, DomainError, Fill, Order, OrderDraft } from '@atlas-x/contracts';

export type PaperTradingEvent =
  | { readonly type: 'accountInitialized'; readonly eventId: string; readonly account: AccountSnapshot }
  | { readonly type: 'orderSubmitted'; readonly eventId: string; readonly order: Order }
  | { readonly type: 'orderCanceled'; readonly eventId: string; readonly order: Order }
  | { readonly type: 'fillRecorded'; readonly eventId: string; readonly fill: Fill }
  | { readonly type: 'accountReset'; readonly eventId: string; readonly account: AccountSnapshot };

export type PaperTradingCommand =
  | { readonly type: 'submitOrder'; readonly commandId: string; readonly draft: OrderDraft }
  | { readonly type: 'cancelOrder'; readonly commandId: string; readonly orderId: string }
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
  clear(confirmationToken: string): Promise<void>;
}
