import type { PaperTradingEvent, PaperTradingEventStore } from './types.js';

export class MemoryPaperTradingEventStore implements PaperTradingEventStore {
  private events: PaperTradingEvent[] = [];

  async append(events: readonly PaperTradingEvent[]): Promise<void> {
    const ids = new Set(this.events.map((event) => event.eventId));
    for (const event of events) {
      if (ids.has(event.eventId)) continue;
      this.events.push(structuredClone(event));
      ids.add(event.eventId);
    }
    this.events.sort((left, right) => left.sequence - right.sequence);
  }

  async readAll(): Promise<readonly PaperTradingEvent[]> {
    return structuredClone(this.events);
  }

  async clear(): Promise<void> {
    this.events = [];
  }

  async replaceAll(events: readonly PaperTradingEvent[]): Promise<void> {
    this.events = structuredClone([...events]).sort((left, right) => left.sequence - right.sequence);
  }
}
