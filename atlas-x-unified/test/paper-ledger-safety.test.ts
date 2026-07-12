import { describe, expect, it } from 'vitest';
import {
  PaperTradingLedgerError,
  RESET_PAPER_ACCOUNT_CONFIRMATION,
  createInitialLedgerState,
} from '@atlas-x/paper-trading';
import { buyLimitDraft as buyLimit, createPaperLedger as ledger } from './helpers/paper-ledger.js';

describe('idempotency and reset safety', () => {
  it('returns the current state without duplicate events for a duplicate command id', async () => {
    const { engine, store } = await ledger();
    const command = { type: 'submitOrder', commandId: 'same', draft: buyLimit, referencePrice: '100' } as const;
    await engine.execute(command);
    const count = (await store.readAll()).length;
    await engine.execute(command);
    expect(await store.readAll()).toHaveLength(count);
    expect((await engine.snapshot()).orders).toHaveLength(1);
  });

  it('requires the exact reset confirmation and reinitializes atomically', async () => {
    const { engine, store } = await ledger();
    await engine.execute({ type: 'submitOrder', commandId: 'submit-1', draft: buyLimit, referencePrice: '100' });
    const rejected = await engine.execute({ type: 'resetAccount', commandId: 'reset-bad', confirmationToken: 'reset' });
    expect(rejected).toMatchObject({ ok: false, error: { code: 'ORDER_INVALID' } });
    expect((await engine.snapshot()).orders).toHaveLength(1);

    await engine.execute({
      type: 'resetAccount', commandId: 'reset-good', confirmationToken: RESET_PAPER_ACCOUNT_CONFIRMATION,
    });
    const snapshot = await engine.snapshot();
    expect(snapshot.orders).toHaveLength(0);
    expect(snapshot.fills).toHaveLength(0);
    expect(snapshot.account.availableCash).toBe('1000');
    expect((await store.readAll()).at(-1)?.type).toBe('accountReset');
  });

  it('throws a stable exception only for programmer-invalid direct fill commands', async () => {
    const { engine } = await ledger();
    await expect(engine.execute({
      type: 'recordFill', commandId: 'missing-fill', orderId: 'missing', price: '1', quantity: '1',
    })).resolves.toMatchObject({ ok: false, error: { code: 'ORDER_NOT_FOUND' } });
    expect(() => createInitialLedgerState()).not.toThrow();
    expect(new PaperTradingLedgerError('ORDER_INVALID', 'x').code).toBe('ORDER_INVALID');
  });
});
