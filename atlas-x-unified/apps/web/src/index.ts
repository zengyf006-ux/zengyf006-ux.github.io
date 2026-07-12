import type { MarketDataPort } from '@atlas-x/market-data';
import type { PaperTradingPort } from '@atlas-x/paper-trading';
import type { UiColorScheme, UiDensity } from '@atlas-x/ui';

export interface WebApplicationPreferences {
  readonly density: UiDensity;
  readonly colorScheme: UiColorScheme;
  readonly locale: 'zh-CN';
}

export interface WebApplicationDependencies {
  readonly marketData: MarketDataPort;
  readonly paperTrading: PaperTradingPort;
  readonly preferences: WebApplicationPreferences;
}

export function createWebApplicationDependencies(
  dependencies: WebApplicationDependencies,
): Readonly<WebApplicationDependencies> {
  return Object.freeze({ ...dependencies, preferences: Object.freeze({ ...dependencies.preferences }) });
}
