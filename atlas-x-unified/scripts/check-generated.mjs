import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDirectory = await mkdtemp(join(tmpdir(), 'atlas-x-contracts-'));
const temporaryOutput = join(tempDirectory, 'contracts.ts');
const expectedOutput = new URL('../src/generated/contracts.ts', import.meta.url);
const openApiInput = new URL('../openapi/atlas-x.openapi.yaml', import.meta.url);
const executable = new URL('../node_modules/.bin/openapi-typescript', import.meta.url);

try {
  const result = spawnSync(executable.pathname, [openApiInput.pathname, '--output', temporaryOutput], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exit(result.status ?? 1);
  }

  const [expected, generated] = await Promise.all([
    readFile(expectedOutput, 'utf8'),
    readFile(temporaryOutput, 'utf8'),
  ]);
  if (expected !== generated) {
    console.error('Generated contracts are stale. Run npm run generate:contracts and commit the result.');
    process.exit(1);
  }
  console.log('Generated contracts are synchronized.');
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}
