import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Candle } from '@atlas-x/contracts';
import { buildCandleGeometry } from '../apps/web/src/app/candle-chart.js';

const candle = (
  id: string,
  open: string,
  high: string,
  low: string,
  close: string,
  sequence: number,
): Candle => ({
  metadata: {
    schemaVersion: SCHEMA_VERSION,
    id,
    source: { truthfulness: 'fixture', fixtureId: 'chart-test' },
    sequence,
    serverTime: '2026-07-12T00:01:00.000Z',
    receivedAt: '2026-07-12T00:01:00.000Z',
  },
  symbol: 'BTC-USD',
  interval: '1m',
  openTime: '2026-07-12T00:00:00.000Z',
  closeTime: '2026-07-12T00:01:00.000Z',
  open,
  high,
  low,
  close,
  volume: '1',
  quoteVolume: close,
  closed: true,
});

describe('decimal-safe candle chart geometry', () => {
  it('maps exact financial strings to deterministic percentage geometry', () => {
    expect(buildCandleGeometry([
      candle('one', '100', '110', '90', '105', 1),
      candle('two', '110', '120', '80', '90', 2),
    ])).toEqual([
      {
        id: 'one',
        direction: 'up',
        wickTop: '25%',
        wickHeight: '50%',
        bodyTop: '37.5%',
        bodyHeight: '12.5%',
      },
      {
        id: 'two',
        direction: 'down',
        wickTop: '0%',
        wickHeight: '100%',
        bodyTop: '25%',
        bodyHeight: '50%',
      },
    ]);
  });

  it('uses a visible minimum body for flat candles and respects the maximum window', () => {
    const values = [
      candle('old', '100', '102', '98', '100', 1),
      candle('new', '100', '110', '90', '100', 2),
    ];
    const geometry = buildCandleGeometry(values, 1);
    expect(geometry).toHaveLength(1);
    expect(geometry[0]).toMatchObject({ id: 'new', direction: 'flat', bodyHeight: '0.6%' });
  });

  it('returns an empty geometry for missing or zero-range data', () => {
    expect(buildCandleGeometry([])).toEqual([]);
    expect(buildCandleGeometry([candle('flat', '100', '100', '100', '100', 1)])).toEqual([]);
  });
});
