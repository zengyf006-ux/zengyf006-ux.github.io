import type { components, paths } from './generated/contracts.js';

export type ApiPaths = paths;
export type ContractSchemas = components['schemas'];
export type ContractDecimalString = ContractSchemas['DecimalString'];
export type Truthfulness = ContractSchemas['Truthfulness'];
export type DataSource = ContractSchemas['DataSource'];
export type EventMetadata = ContractSchemas['EventMetadata'];
export type MarketSnapshot = ContractSchemas['MarketSnapshot'];
export type Candle = ContractSchemas['Candle'];
export type OrderBookSnapshot = ContractSchemas['OrderBookSnapshot'];
export type AccountAsset = ContractSchemas['AccountAsset'];
export type OrderDraft = ContractSchemas['OrderDraft'];
export type Order = ContractSchemas['Order'];
export type Fill = ContractSchemas['Fill'];
export type ErrorObject = ContractSchemas['ErrorObject'];
