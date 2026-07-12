import { useMemo } from 'react';
import type { PublicCandleInterval } from '@atlas-x/market-data';
import { buildCandleGeometry } from './candle-chart.js';
import { usePublicCandles } from './useCandles.js';

interface CandlePanelProps {
  readonly symbol: string;
  readonly interval: PublicCandleInterval;
  readonly last: string;
}

function sourceTone(truthfulness: ReturnType<typeof usePublicCandles>['truthfulness']): 'positive' | 'warning' | 'negative' {
  if (truthfulness === 'real') return 'positive';
  if (truthfulness === 'unknown') return 'negative';
  return 'warning';
}

export function CandlePanel({ symbol, interval, last }: CandlePanelProps) {
  const state = usePublicCandles(symbol, interval);
  const geometry = useMemo(() => buildCandleGeometry(state.candles), [state.candles]);
  const tone = sourceTone(state.truthfulness);

  return (
    <section className="chart" aria-label={`${symbol} ${interval} K线图 · ${state.label}`}>
      <span className={`chart-source-note tone-${tone}`} title={state.detail}>
        {state.loading ? `${state.label} · 更新中` : state.label}
      </span>
      <div className="chart-grid" aria-hidden="true" />
      <div className="candle-plot" aria-hidden="true">
        {geometry.map((candle) => (
          <i className={`candle-column ${candle.direction}`} key={candle.id}>
            <span className="candle-wick" style={{ top: candle.wickTop, height: candle.wickHeight }} />
            <span className="candle-body" style={{ top: candle.bodyTop, height: candle.bodyHeight }} />
          </i>
        ))}
      </div>
      <div className="price-line"><span>{last}</span></div>
      <div className="chart-runtime-detail">
        <span>{state.detail}</span>
        {state.error === null ? null : <strong role="status">{state.error}</strong>}
      </div>
    </section>
  );
}
