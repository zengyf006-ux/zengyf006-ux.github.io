# Foundation TDD red evidence

The first reconstructed foundation test run intentionally failed in `test/golden-vectors.test.ts` because the new fee-aware risk vectors had no implementation output yet. After implementing the expanded risk calculation, the vector expectations were generated from the exact decimal implementation. A later self-review rejected a temporary 47-test suite because it weakened the 63-test baseline; historical cases were restored and expanded before any implementation commit.
