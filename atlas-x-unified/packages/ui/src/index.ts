import type { Truthfulness } from '@atlas-x/contracts';

export type UiDensity = 'compact' | 'comfortable';
export type UiColorScheme = 'light' | 'dark' | 'system';

export interface TruthfulnessPresentation {
  readonly label: string;
  readonly description: string;
  readonly requiresWarning: boolean;
}

export const TRUTHFULNESS_PRESENTATION: Readonly<Record<Truthfulness, TruthfulnessPresentation>> = {
  unknown: { label: '来源未知', description: '无法确认数据真实性', requiresWarning: true },
  cachedReal: { label: '真实缓存', description: '来自真实市场但可能已过期', requiresWarning: true },
  real: { label: '实时真实', description: '来自已标识的公共行情源', requiresWarning: false },
  simulated: { label: '模拟', description: '仅用于模拟交易与演练', requiresWarning: true },
  fixture: { label: '测试数据', description: '确定性测试夹具，不代表市场', requiresWarning: true },
};
