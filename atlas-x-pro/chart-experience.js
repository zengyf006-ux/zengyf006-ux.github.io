(() => {
  'use strict';
  if (window.AtlasChartExperience) return;

  const INTERVAL_MS = Object.freeze({
    '1m': 60_000, '3m': 180_000, '5m': 300_000, '15m': 900_000,
    '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000,
    '4h': 14_400_000, '6h': 21_600_000, '12h': 43_200_000,
    '1d': 86_400_000, '1w': 604_800_000,
  });

  let selection = null;
  let pointerClear = null;

  function intervalMs(interval) {
    const value = INTERVAL_MS[interval];
    if (!value) throw new RangeError(`Unsupported chart interval: ${interval}`);
    return value;
  }

  function finite(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function emaSeries(candles, period) {
    if (!Array.isArray(candles) || !candles.length) return [];
    const multiplier = 2 / (period + 1);
    const result = [];
    let previous = finite(candles[0]?.close);
    candles.forEach((candle, index) => {
      const close = finite(candle?.close, previous);
      previous = index === 0 ? close : close * multiplier + previous * (1 - multiplier);
      result.push(previous);
    });
    return result;
  }

  function metrics(candles, index) {
    if (!Array.isArray(candles) || !candles.length) return null;
    const safeIndex = Math.max(0, Math.min(candles.length - 1, Math.trunc(Number(index) || 0)));
    const candle = candles[safeIndex];
    if (!candle) return null;
    const open = finite(candle.open);
    const high = finite(candle.high);
    const low = finite(candle.low);
    const close = finite(candle.close);
    const changeAmount = close - open;
    const denominator = Math.max(Math.abs(open), Number.EPSILON);
    const changePercent = changeAmount / denominator * 100;
    const amplitude = (high - low) / denominator * 100;
    const volume = Math.max(0, finite(candle.volume));
    const quoteVolume = Math.max(0, finite(candle.quoteVolume, volume * close));
    const ema10 = emaSeries(candles, 10)[safeIndex];
    const ema20 = emaSeries(candles, 20)[safeIndex];
    return {
      index: safeIndex,
      candle,
      time: finite(candle.time),
      closeTime: finite(candle.closeTime),
      open,
      high,
      low,
      close,
      changeAmount,
      changePercent,
      amplitude,
      volume,
      quoteVolume,
      trades: Math.max(0, Math.trunc(finite(candle.trades))),
      ema10,
      ema20,
      closed: candle.closed !== false,
      provider: String(candle.provider || ''),
    };
  }

  function notify(type, reason) {
    const detail = { type, reason, selection: selection ? { ...selection } : null, at: Date.now() };
    window.dispatchEvent(new CustomEvent('atlas:chart-selection', { detail }));
    return detail.selection;
  }

  function select(index, reason = 'pointer') {
    const nextIndex = Math.trunc(Number(index));
    if (!Number.isFinite(nextIndex) || nextIndex < 0) return clear('invalid-index');
    if (pointerClear && pointerClear.index === nextIndex && Date.now() - pointerClear.at < 450) {
      pointerClear = null;
      selection = null;
      notify('clear', 'same-candle');
      return null;
    }
    pointerClear = null;
    if (selection?.index === nextIndex && selection?.locked) return clear('same-candle');
    selection = { index: nextIndex, reason, locked: true, selectedAt: Date.now() };
    notify('select', reason);
    return { ...selection };
  }

  function preview(index, reason = 'hover') {
    const nextIndex = Math.trunc(Number(index));
    if (!Number.isFinite(nextIndex) || nextIndex < 0 || selection?.locked) return getSelection();
    selection = { index: nextIndex, reason, locked: false, selectedAt: Date.now() };
    notify('preview', reason);
    return { ...selection };
  }

  function clear(reason = 'clear') {
    if (!selection) return null;
    if (reason === 'drag-start') pointerClear = { index: selection.index, at: Date.now() };
    else pointerClear = null;
    selection = null;
    notify('clear', reason);
    return null;
  }

  function getSelection() {
    return selection ? { ...selection } : null;
  }

  function countdown(candle, interval, at = Date.now()) {
    const step = intervalMs(interval);
    const start = finite(candle?.time);
    const explicitClose = finite(candle?.closeTime);
    const closeTime = explicitClose > start ? explicitClose : start + step - 1;
    const remainingMs = Math.max(0, closeTime - finite(at));
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = value => String(value).padStart(2, '0');
    const text = hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    return { remainingMs, closeTime, text, expired: remainingMs <= 0 };
  }

  function extrema(candles) {
    if (!Array.isArray(candles) || !candles.length) return { high: null, low: null };
    let high = null;
    let low = null;
    candles.forEach((candle, index) => {
      const highValue = finite(candle?.high, Number.NEGATIVE_INFINITY);
      const lowValue = finite(candle?.low, Number.POSITIVE_INFINITY);
      if (!high || highValue > high.value) high = { index, value: highValue, candle };
      if (!low || lowValue < low.value) low = { index, value: lowValue, candle };
    });
    return {
      high: high && Number.isFinite(high.value) ? high : null,
      low: low && Number.isFinite(low.value) ? low : null,
    };
  }

  window.AtlasChartExperience = Object.freeze({
    intervalMs,
    metrics,
    select,
    preview,
    clear,
    getSelection,
    countdown,
    extrema,
    emaSeries,
  });
  document.documentElement.dataset.chartExperience = 'ready';
})();
