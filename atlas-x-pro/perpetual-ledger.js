(() => {
  'use strict';

  if (window.__ATLAS_PERPETUAL_LEDGER__) return;
  window.__ATLAS_PERPETUAL_LEDGER__ = true;

  const STORE_KEY = 'atlasX.pro.perpetual.v1';
  const BACKUP_KEY = 'atlasX.pro.perpetual.corruptBackup.v1';
  const VERSION = 1;
  const MAX_AUDIT_EVENTS = 500;
  const MAX_FILLS = 500;
  const MAX_FUNDING_EVENTS = 240;
  const MAX_LIQUIDATION_EVENTS = 120;

  const finite = (value, fallback = 0) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const integer = (value, fallback = 1) => {
    const number = Math.floor(finite(value, fallback));
    return number > 0 ? number : fallback;
  };

  const clone = value => JSON.parse(JSON.stringify(value));

  const defaultState = () => ({
    version: VERSION,
    account: {
      walletBalance: 100000,
      realizedPnl: 0,
      feesPaid: 0,
      fundingPaid: 0,
      positionMode: 'one_way',
    },
    preferences: {
      marginModeBySymbol: {},
      leverageBySymbol: {},
      orderDefaults: {},
    },
    positions: [],
    orders: [],
    fills: [],
    fundingEvents: [],
    liquidationEvents: [],
    auditEvents: [],
    nextId: 1,
  });

  const normalizeAudit = item => {
    if (!item || typeof item !== 'object') return null;
    return {
      ...item,
      id: String(item.id || ''),
      type: String(item.type || 'event'),
      createdAt: finite(item.createdAt, Date.now()),
    };
  };

  const normalizeState = input => {
    const base = defaultState();
    const source = input && typeof input === 'object' ? input : {};
    const account = source.account && typeof source.account === 'object' ? source.account : {};
    const preferences = source.preferences && typeof source.preferences === 'object' ? source.preferences : {};

    return {
      version: VERSION,
      account: {
        walletBalance: finite(account.walletBalance, base.account.walletBalance),
        realizedPnl: finite(account.realizedPnl),
        feesPaid: Math.max(0, finite(account.feesPaid)),
        fundingPaid: finite(account.fundingPaid),
        positionMode: account.positionMode === 'hedge' ? 'hedge' : 'one_way',
      },
      preferences: {
        marginModeBySymbol: preferences.marginModeBySymbol && typeof preferences.marginModeBySymbol === 'object'
          ? { ...preferences.marginModeBySymbol }
          : {},
        leverageBySymbol: preferences.leverageBySymbol && typeof preferences.leverageBySymbol === 'object'
          ? { ...preferences.leverageBySymbol }
          : {},
        orderDefaults: preferences.orderDefaults && typeof preferences.orderDefaults === 'object'
          ? { ...preferences.orderDefaults }
          : {},
      },
      positions: Array.isArray(source.positions) ? source.positions.filter(Boolean).map(item => ({ ...item })) : [],
      orders: Array.isArray(source.orders) ? source.orders.filter(Boolean).map(item => ({ ...item })) : [],
      fills: Array.isArray(source.fills) ? source.fills.filter(Boolean).slice(0, MAX_FILLS).map(item => ({ ...item })) : [],
      fundingEvents: Array.isArray(source.fundingEvents)
        ? source.fundingEvents.filter(Boolean).slice(0, MAX_FUNDING_EVENTS).map(item => ({ ...item }))
        : [],
      liquidationEvents: Array.isArray(source.liquidationEvents)
        ? source.liquidationEvents.filter(Boolean).slice(0, MAX_LIQUIDATION_EVENTS).map(item => ({ ...item }))
        : [],
      auditEvents: Array.isArray(source.auditEvents)
        ? source.auditEvents.map(normalizeAudit).filter(Boolean).slice(0, MAX_AUDIT_EVENTS)
        : [],
      nextId: integer(source.nextId, 1),
    };
  };

  const readInitialState = () => {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultState();
    try {
      return normalizeState(JSON.parse(raw));
    } catch {
      try { localStorage.setItem(BACKUP_KEY, raw); } catch {}
      return defaultState();
    }
  };

  let state = readInitialState();
  let sequence = Math.max(1, integer(state.nextId, 1));
  let transactionQueue = Promise.resolve();

  const persist = () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  };

  const emit = (label, snapshot) => {
    try {
      window.dispatchEvent(new CustomEvent('atlas:perpetual-ledger', {
        detail: { label, state: snapshot },
      }));
    } catch {}
  };

  const nextId = (prefix = 'perp') => {
    const id = `${String(prefix || 'perp')}-${Date.now().toString(36)}-${sequence.toString(36)}`;
    sequence += 1;
    return id;
  };

  const transact = (label, mutator) => {
    if (typeof mutator !== 'function') return Promise.reject(new TypeError('mutator must be a function'));
    const execute = async () => {
      const draft = clone(state);
      await mutator(draft);
      draft.nextId = Math.max(integer(draft.nextId, 1), sequence);
      state = normalizeState(draft);
      sequence = Math.max(sequence, state.nextId);
      persist();
      const snapshot = clone(state);
      emit(String(label || 'transaction'), snapshot);
      return snapshot;
    };
    transactionQueue = transactionQueue.then(execute, execute);
    return transactionQueue;
  };

  const appendAudit = event => transact('append-audit', draft => {
    draft.auditEvents.unshift(normalizeAudit({
      ...event,
      id: event?.id || nextId('audit'),
      createdAt: finite(event?.createdAt, Date.now()),
    }));
    draft.auditEvents = draft.auditEvents.filter(Boolean).slice(0, MAX_AUDIT_EVENTS);
  });

  const reset = () => {
    const execute = async () => {
      state = defaultState();
      sequence = 1;
      persist();
      const snapshot = clone(state);
      emit('reset', snapshot);
      return snapshot;
    };
    transactionQueue = transactionQueue.then(execute, execute);
    return transactionQueue;
  };

  persist();

  window.AtlasPerpetualLedger = Object.freeze({
    STORE_KEY,
    BACKUP_KEY,
    VERSION,
    getState: () => clone(state),
    transact,
    reset,
    nextId,
    appendAudit,
  });

  document.documentElement.dataset.perpetualLedger = 'ready';
})();
