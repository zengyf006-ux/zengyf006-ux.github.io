import type { DomainError } from '@atlas-x/contracts';

export class PaperTradingLedgerError extends Error {
  constructor(readonly code: DomainError['code'], message: string) {
    super(message);
    this.name = 'PaperTradingLedgerError';
  }
}
