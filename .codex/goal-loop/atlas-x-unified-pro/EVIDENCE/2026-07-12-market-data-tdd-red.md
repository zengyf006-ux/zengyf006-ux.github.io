# Market data TDD red evidence

The G3 suite was written before implementation and initially failed because the Coinbase public adapter, parser, connection reducer, sequence tracker, truthful cache conversion, fixture port, stale/offline handling and reconnect policy did not exist. Self-review added two further failing cases: a forward public-feed sequence gap remained live, and retained offline memory data remained incorrectly labeled `real`. The implementation must satisfy all cases without weakening them.
