export type SequenceMode = 'contiguous' | 'monotonic';

export type SequenceObservation =
  | { readonly status: 'first' }
  | { readonly status: 'ok' }
  | { readonly status: 'gap'; readonly expected: number; readonly actual: number }
  | { readonly status: 'outOfOrder'; readonly previous: number; readonly actual: number };

export class SequenceTracker {
  private readonly previous = new Map<string, number>();

  observe(key: string, sequence: number, mode: SequenceMode): SequenceObservation {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error('Sequence must be a non-negative safe integer');
    }
    const previous = this.previous.get(key);
    if (previous === undefined) {
      this.previous.set(key, sequence);
      return { status: 'first' };
    }
    if (sequence <= previous) {
      return { status: 'outOfOrder', previous, actual: sequence };
    }
    this.previous.set(key, sequence);
    if (mode === 'contiguous' && sequence !== previous + 1) {
      return { status: 'gap', expected: previous + 1, actual: sequence };
    }
    return { status: 'ok' };
  }

  reset(key?: string): void {
    if (key === undefined) this.previous.clear();
    else this.previous.delete(key);
  }
}
