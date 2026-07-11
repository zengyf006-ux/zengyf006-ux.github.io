import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createContext, loadPerpetualCore } from './perpetual-test-harness.mjs';

const STORE_KEY = 'atlasX.pro.perpetual.v1';
const BACKUP_KEY = 'atlasX.pro.perpetual.corruptBackup.v1';

const context = createContext({ [STORE_KEY]: '{broken-json' });
await loadPerpetualCore(context, ['ledger']);

assert.ok(context.AtlasPerpetualLedger, 'AtlasPerpetualLedger must be exposed');
let state = context.AtlasPerpetualLedger.getState();
assert.equal(state.version, 1);
assert.equal(state.account.walletBalance, 100000);
assert.equal(state.account.positionMode, 'one_way');
assert.deepEqual(Array.from(state.positions), []);
assert.deepEqual(Array.from(state.orders), []);
assert.equal(context.localStorage.getItem(BACKUP_KEY), '{broken-json', 'corrupt payload must be backed up');

const first = context.AtlasPerpetualLedger.transact('first', async draft => {
  await new Promise(resolve => setTimeout(resolve, 25));
  draft.account.realizedPnl += 10;
  draft.auditEvents.push({ id: context.AtlasPerpetualLedger.nextId('audit'), type: 'first' });
});
const second = context.AtlasPerpetualLedger.transact('second', draft => {
  draft.account.realizedPnl += 5;
  draft.auditEvents.push({ id: context.AtlasPerpetualLedger.nextId('audit'), type: 'second' });
});
await Promise.all([first, second]);

state = context.AtlasPerpetualLedger.getState();
assert.equal(state.account.realizedPnl, 15, 'serialized transactions must preserve both mutations');
assert.equal(state.auditEvents.length, 2);
assert.equal(new Set(state.auditEvents.map(item => item.id)).size, 2, 'audit ids must be unique');
assert.ok(state.auditEvents.every(item => typeof item.createdAt === 'number'), 'ledger normalizes audit timestamps');

const snapshot = JSON.stringify(state);
const returned = await context.AtlasPerpetualLedger.transact('no-op', () => {});
assert.equal(JSON.stringify(returned), snapshot, 'transaction returns committed state');

await fs.mkdir('qa-artifacts-pro', { recursive: true });
await fs.writeFile('qa-artifacts-pro/perpetual-ledger-report.json', JSON.stringify({ passed: true, state }, null, 2));
console.log('ATLAS X perpetual ledger checks passed');
