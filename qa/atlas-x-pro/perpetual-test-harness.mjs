import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

export class MemoryStorage {
  constructor(seed = {}) {
    this.map = new Map(Object.entries(seed));
  }
  get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.has(String(key)) ? this.map.get(String(key)) : null; }
  setItem(key, value) { this.map.set(String(key), String(value)); }
  removeItem(key) { this.map.delete(String(key)); }
  clear() { this.map.clear(); }
}

export function createContext(seed = {}) {
  const localStorage = new MemoryStorage(seed);
  const listeners = new Map();
  const context = {
    console,
    localStorage,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    performance,
    crypto: globalThis.crypto,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Error,
    TypeError,
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
    },
    document: {
      readyState: 'complete',
      documentElement: { dataset: {} },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    addEventListener(type, handler) {
      const bucket = listeners.get(type) || [];
      bucket.push(handler);
      listeners.set(type, bucket);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter(item => item !== handler));
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) || []) handler(event);
      return true;
    },
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  return context;
}

export async function loadRuntime(context, path) {
  let source;
  try {
    source = await fs.readFile(path, 'utf8');
  } catch (error) {
    assert.fail(`required runtime module is missing: ${path} (${error.code || error.message})`);
  }
  vm.runInContext(source, context, { filename: path });
  return context;
}

export async function loadPerpetualCore(context, modules = ['ledger', 'risk', 'orders']) {
  const paths = {
    ledger: 'atlas-x-pro/perpetual-ledger.js',
    risk: 'atlas-x-pro/perpetual-risk-engine.js',
    orders: 'atlas-x-pro/perpetual-order-engine.js',
  };
  for (const module of modules) await loadRuntime(context, paths[module]);
  return context;
}

export function approx(actual, expected, tolerance = 1e-8, label = 'value') {
  assert.ok(Number.isFinite(actual), `${label} must be finite, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
}
