import type { Fill, Order, Reservation } from '@atlas-x/contracts';
import { decimalString, parseDecimal, SCHEMA_VERSION } from '@atlas-x/domain';
import {
  availableBase,
  baseAsset,
  availableCash,
  isFinalOrder,
  orderAverageFill,
  paperDomainError,
  paperMetadata,
  parsePaperDecimal,
  positionAfterBuy,
  positionAfterSell,
  reservePriceForDraft,
} from './accounting.js';
import { PaperTradingLedgerError } from './errors.js';
import { applyPaperTradingEvent, createInitialLedgerState, replayPaperTradingEvents } from './reducer.js';
import { createPaperAccountSnapshot, createPaperAppSnapshot } from './snapshot.js';
import type {
  PaperOrderRecord,
  PaperPositionRecord,
  PaperTradingCommand,
  PaperTradingEvent,
  PaperTradingLedgerOptions,
  PaperTradingLedgerState,
  PaperTradingResult,
} from './types.js';

export const RESET_PAPER_ACCOUNT_CONFIRMATION = 'RESET ATLAS X PAPER ACCOUNT';

export class PaperTradingLedger {
  private readonly options: PaperTradingLedgerOptions;
  private current = createInitialLedgerState();

  constructor(options: PaperTradingLedgerOptions) {
    parsePaperDecimal(options.initialCash, 'initial cash');
    const feeRate = parsePaperDecimal(options.feeRate, 'fee rate');
    if (feeRate.greaterThan(1)) throw new PaperTradingLedgerError('ORDER_INVALID', 'Invalid fee rate');
    this.options = options;
  }

  async initialize(commandId = 'initialize'): Promise<void> {
    try {
      const events = await this.options.store.readAll();
      if (events.length > 0) {
        this.current = replayPaperTradingEvents(events);
        return;
      }
      const time = this.options.now();
      const event: PaperTradingEvent = {
        type: 'accountInitialized',
        eventId: this.options.id(),
        commandId,
        sequence: 1,
        occurredAt: time,
        accountId: this.options.accountId,
        baseCurrency: this.options.baseCurrency,
        initialCash: decimalString(parseDecimal(this.options.initialCash)),
      };
      await this.options.store.append([event]);
      this.current = applyPaperTradingEvent(this.current, event);
    } catch (caught) {
      if (caught instanceof PaperTradingLedgerError) throw caught;
      throw new PaperTradingLedgerError('STORAGE_FAILURE', 'Unable to initialize paper account storage');
    }
  }

  state(): PaperTradingLedgerState {
    return structuredClone(this.current);
  }

  async execute(command: PaperTradingCommand): Promise<PaperTradingResult> {
    try {
      if (!this.current.initialized) await this.initialize();
      if (this.current.processedCommandIds.includes(command.commandId)) {
        return { ok: true, account: createPaperAccountSnapshot(this.current, this.options) };
      }

      switch (command.type) {
        case 'submitOrder': return await this.submit(command);
        case 'recordFill': return await this.fill(command);
        case 'cancelOrder': return await this.cancel(command.commandId, command.orderId);
        case 'markPrice': return await this.mark(command.commandId, command.symbol, command.price);
        case 'resetAccount': return await this.reset(command.commandId, command.confirmationToken);
      }
    } catch (caught) {
      if (caught instanceof PaperTradingLedgerError) {
        return { ok: false, error: paperDomainError(caught.code, caught.message) };
      }
      return { ok: false, error: paperDomainError('INTERNAL_FAILURE', 'Unexpected paper trading failure') };
    }
  }

  async snapshot(): Promise<import('@atlas-x/contracts').AppSnapshot> {
    return createPaperAppSnapshot(this.current, this.options);
  }

  private async append(event: PaperTradingEvent): Promise<void> {
    const next = applyPaperTradingEvent(this.current, event);
    try {
      await this.options.store.append([event]);
      this.current = next;
    } catch {
      throw new PaperTradingLedgerError('STORAGE_FAILURE', 'Unable to persist paper trading event');
    }
  }

  private nextEvent(commandId: string) {
    return {
      eventId: this.options.id(),
      commandId,
      sequence: this.current.lastSequence + 1,
      occurredAt: this.options.now(),
    };
  }

  private async submit(command: Extract<PaperTradingCommand, { type: 'submitOrder' }>): Promise<PaperTradingResult> {
    if (command.draft.schemaVersion !== SCHEMA_VERSION) {
      throw new PaperTradingLedgerError('SCHEMA_VERSION_UNSUPPORTED', 'Unsupported schema version');
    }
    const quantity = parsePaperDecimal(command.draft.quantity, 'order quantity', false);
    const reference = parsePaperDecimal(command.referencePrice, 'reference price', false);
    const price = parsePaperDecimal(reservePriceForDraft(command.draft, decimalString(reference)), 'reserve price', false);
    const feeRate = parseDecimal(this.options.feeRate);
    const orderId = this.options.id();
    const eventCommon = this.nextEvent(command.commandId);
    const reservationId = this.options.id();
    const time = eventCommon.occurredAt;
    let reservation: Reservation;

    if (command.draft.side === 'buy') {
      const required = quantity.times(price).times(parseDecimal('1').plus(feeRate));
      if (required.greaterThan(availableCash(this.current))) {
        throw new PaperTradingLedgerError('ORDER_INSUFFICIENT_BALANCE', 'Insufficient quote balance');
      }
      reservation = {
        schemaVersion: SCHEMA_VERSION,
        reservationId,
        accountId: this.options.accountId,
        asset: this.options.baseCurrency,
        amount: decimalString(required),
        reason: 'order',
        referenceId: orderId,
        createdAt: time,
      };
    } else {
      if (quantity.greaterThan(availableBase(this.current, command.draft.symbol))) {
        throw new PaperTradingLedgerError('ORDER_INSUFFICIENT_BALANCE', 'Insufficient base balance');
      }
      reservation = {
        schemaVersion: SCHEMA_VERSION,
        reservationId,
        accountId: this.options.accountId,
        asset: baseAsset(command.draft.symbol),
        amount: decimalString(quantity),
        reason: 'order',
        referenceId: orderId,
        createdAt: time,
      };
    }

    const order: Order = {
      metadata: paperMetadata(`order-${orderId}`, eventCommon.sequence, time),
      orderId,
      draft: command.draft,
      status: command.draft.type === 'stopMarket' || command.draft.type === 'stopLimit' ? 'waitingTrigger' : 'pending',
      filledQuantity: '0',
      remainingQuantity: decimalString(quantity),
      averageFillPrice: null,
      feePaid: '0',
      updatedAt: time,
      failure: null,
    };
    const record: PaperOrderRecord = {
      order,
      reservationId,
      reservePrice: decimalString(price),
      feeRate: decimalString(feeRate),
    };
    const event: PaperTradingEvent = { type: 'orderSubmitted', ...eventCommon, record, reservation };
    await this.append(event);
    return { ok: true, account: createPaperAccountSnapshot(this.current, this.options), order };
  }

  private async fill(command: Extract<PaperTradingCommand, { type: 'recordFill' }>): Promise<PaperTradingResult> {
    const existing = this.current.orders[command.orderId];
    if (existing === undefined) throw new PaperTradingLedgerError('ORDER_NOT_FOUND', 'Order not found');
    if (isFinalOrder(existing.order.status)) throw new PaperTradingLedgerError('ORDER_ALREADY_FINAL', 'Order is already final');
    if (existing.order.status === 'waitingTrigger') {
      throw new PaperTradingLedgerError('ORDER_INVALID', 'Stop order has not triggered');
    }
    const quantity = parsePaperDecimal(command.quantity, 'fill quantity', false);
    const price = parsePaperDecimal(command.price, 'fill price', false);
    if (existing.order.draft.type === 'limit' || existing.order.draft.type === 'stopLimit') {
      const limit = parseDecimal(existing.order.draft.price);
      const invalid = existing.order.draft.side === 'buy' ? price.greaterThan(limit) : price.lessThan(limit);
      if (invalid) throw new PaperTradingLedgerError('ORDER_INVALID', 'Fill price violates limit price');
    }
    const remaining = parseDecimal(existing.order.remainingQuantity);
    if (quantity.greaterThan(remaining)) throw new PaperTradingLedgerError('ORDER_INVALID', 'Fill exceeds remaining quantity');

    const eventCommon = this.nextEvent(command.commandId);
    const time = eventCommon.occurredAt;
    const gross = quantity.times(price);
    const fee = gross.times(parseDecimal(existing.feeRate));
    const filledTotal = parseDecimal(existing.order.filledQuantity).plus(quantity);
    const remainingAfter = remaining.minus(quantity);
    const feeTotal = parseDecimal(existing.order.feePaid).plus(fee);
    const order: Order = {
      ...existing.order,
      metadata: paperMetadata(`order-${existing.order.orderId}`, eventCommon.sequence, time),
      status: remainingAfter.isZero() ? 'filled' : 'partiallyFilled',
      filledQuantity: decimalString(filledTotal),
      remainingQuantity: decimalString(remainingAfter),
      averageFillPrice: orderAverageFill(existing.order, command.price, command.quantity),
      feePaid: decimalString(feeTotal),
      updatedAt: time,
    };
    const record: PaperOrderRecord = { ...existing, order };
    const previousPosition = this.current.positions[order.draft.symbol];
    let cashAfter;
    let positionAfter: PaperPositionRecord;
    if (order.draft.side === 'buy') {
      cashAfter = parseDecimal(this.current.cash).minus(gross).minus(fee);
      positionAfter = positionAfterBuy(
        previousPosition,
        order.draft.symbol,
        command.quantity,
        gross,
        fee,
        command.price,
        time,
      );
    } else {
      if (previousPosition === undefined || quantity.greaterThan(parseDecimal(previousPosition.quantity))) {
        throw new PaperTradingLedgerError('ORDER_INSUFFICIENT_BALANCE', 'Insufficient position quantity');
      }
      cashAfter = parseDecimal(this.current.cash).plus(gross).minus(fee);
      positionAfter = positionAfterSell(
        previousPosition,
        order.draft.symbol,
        command.quantity,
        gross,
        fee,
        command.price,
        time,
      );
    }
    if (cashAfter.isNegative()) throw new PaperTradingLedgerError('ORDER_INSUFFICIENT_BALANCE', 'Insufficient cash at fill');

    let reservationAfter: Reservation | null = null;
    if (!remainingAfter.isZero() && existing.reservationId !== null) {
      const previousReservation = this.current.reservations[existing.reservationId];
      if (previousReservation !== undefined) {
        const amount = order.draft.side === 'buy'
          ? remainingAfter.times(parseDecimal(existing.reservePrice)).times(parseDecimal('1').plus(parseDecimal(existing.feeRate)))
          : remainingAfter;
        reservationAfter = { ...previousReservation, amount: decimalString(amount) };
      }
    }

    const fill: Fill = {
      metadata: paperMetadata(`fill-${eventCommon.eventId}`, eventCommon.sequence, time),
      fillId: this.options.id(),
      orderId: order.orderId,
      symbol: order.draft.symbol,
      side: order.draft.side,
      price: decimalString(price),
      quantity: decimalString(quantity),
      quoteAmount: decimalString(gross),
      fee: decimalString(fee),
      feeAsset: this.options.baseCurrency,
    };
    const event: PaperTradingEvent = {
      type: 'fillRecorded',
      ...eventCommon,
      fill,
      record,
      cashAfter: decimalString(cashAfter),
      positionAfter,
      reservationAfter,
    };
    await this.append(event);
    return { ok: true, account: createPaperAccountSnapshot(this.current, this.options), order };
  }

  private async cancel(commandId: string, orderId: string): Promise<PaperTradingResult> {
    const existing = this.current.orders[orderId];
    if (existing === undefined) throw new PaperTradingLedgerError('ORDER_NOT_FOUND', 'Order not found');
    if (isFinalOrder(existing.order.status)) throw new PaperTradingLedgerError('ORDER_ALREADY_FINAL', 'Order is already final');
    const eventCommon = this.nextEvent(commandId);
    const order: Order = {
      ...existing.order,
      metadata: paperMetadata(`order-${orderId}`, eventCommon.sequence, eventCommon.occurredAt),
      status: 'canceled',
      updatedAt: eventCommon.occurredAt,
    };
    const record: PaperOrderRecord = { ...existing, order, reservationId: null };
    await this.append({
      type: 'orderCanceled',
      ...eventCommon,
      record,
      releasedReservationId: existing.reservationId,
    });
    return { ok: true, account: createPaperAccountSnapshot(this.current, this.options), order };
  }

  private async mark(commandId: string, symbol: string, priceValue: string): Promise<PaperTradingResult> {
    const price = parsePaperDecimal(priceValue, 'market price', false);
    const eventCommon = this.nextEvent(commandId);
    const triggeredOrders = Object.values(this.current.orders)
      .filter((record) => {
        const draft = record.order.draft;
        if (record.order.status !== 'waitingTrigger' || draft.symbol !== symbol
          || (draft.type !== 'stopMarket' && draft.type !== 'stopLimit')) return false;
        const stop = parseDecimal(draft.stopPrice);
        return draft.side === 'buy' ? price.greaterThanOrEqualTo(stop) : price.lessThanOrEqualTo(stop);
      })
      .map((record): PaperOrderRecord => ({
        ...record,
        order: {
          ...record.order,
          metadata: paperMetadata(`order-${record.order.orderId}`, eventCommon.sequence, eventCommon.occurredAt),
          status: 'pending',
          updatedAt: eventCommon.occurredAt,
        },
      }));
    await this.append({
      type: 'marketPriceMarked',
      ...eventCommon,
      symbol,
      price: decimalString(price),
      triggeredOrders,
    });
    return { ok: true, account: createPaperAccountSnapshot(this.current, this.options) };
  }

  private async reset(commandId: string, confirmationToken: string): Promise<PaperTradingResult> {
    if (confirmationToken !== RESET_PAPER_ACCOUNT_CONFIRMATION) {
      throw new PaperTradingLedgerError('ORDER_INVALID', 'Paper account reset confirmation is invalid');
    }
    const time = this.options.now();
    const event: PaperTradingEvent = {
      type: 'accountReset',
      eventId: this.options.id(),
      commandId,
      sequence: 1,
      occurredAt: time,
      accountId: this.options.accountId,
      baseCurrency: this.options.baseCurrency,
      initialCash: decimalString(parseDecimal(this.options.initialCash)),
    };
    try {
      await this.options.store.replaceAll([event]);
      this.current = replayPaperTradingEvents([event]);
    } catch {
      throw new PaperTradingLedgerError('STORAGE_FAILURE', 'Unable to reset paper account storage');
    }
    return { ok: true, account: createPaperAccountSnapshot(this.current, this.options) };
  }

}
