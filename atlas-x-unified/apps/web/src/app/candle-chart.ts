import type { Candle } from '@atlas-x/contracts';
import { decimalString, parseDecimal } from '@atlas-x/domain';

export interface CandleGeometry {
  readonly id: string;
  readonly direction: 'up' | 'down' | 'flat';
  readonly wickTop: string;
  readonly wickHeight: string;
  readonly bodyTop: string;
  readonly bodyHeight: string;
}

function percent(value: ReturnType<typeof parseDecimal>): string {
  return `${decimalString(value.toDecimalPlaces(4))}%`;
}

export function buildCandleGeometry(candles: readonly Candle[], maximum = 60): readonly CandleGeometry[] {
  const visible = candles.slice(-maximum);
  const first = visible[0];
  if (first === undefined) return [];

  const high = visible.reduce(
    (current, candle) => parseDecimal(candle.high).greaterThan(current) ? parseDecimal(candle.high) : current,
    parseDecimal(first.high),
  );
  const low = visible.reduce(
    (current, candle) => parseDecimal(candle.low).lessThan(current) ? parseDecimal(candle.low) : current,
    parseDecimal(first.low),
  );
  const range = high.minus(low);
  if (!range.greaterThan(0)) return [];

  const y = (price: string) => high.minus(parseDecimal(price)).dividedBy(range).times(100);
  return visible.map((candle) => {
    const open = parseDecimal(candle.open);
    const close = parseDecimal(candle.close);
    const upperBody = open.greaterThan(close) ? candle.open : candle.close;
    const lowerBody = open.lessThan(close) ? candle.open : candle.close;
    const wickTop = y(candle.high);
    const wickBottom = y(candle.low);
    const bodyTop = y(upperBody);
    const bodyBottom = y(lowerBody);
    const rawBodyHeight = bodyBottom.minus(bodyTop);
    const bodyHeight = rawBodyHeight.lessThan('0.6') ? parseDecimal('0.6') : rawBodyHeight;
    return {
      id: candle.metadata.id,
      direction: close.greaterThan(open) ? 'up' : close.lessThan(open) ? 'down' : 'flat',
      wickTop: percent(wickTop),
      wickHeight: percent(wickBottom.minus(wickTop)),
      bodyTop: percent(bodyTop),
      bodyHeight: percent(bodyHeight),
    };
  });
}
