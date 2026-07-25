import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  checksumLines,
  validateQualityReport,
  walkFiles,
} from './final-evidence-lib.mjs';

const env = process.env;
const requiredEnv = [
  'ATLAS_HEAD_SHA',
  'ATLAS_BASE_SHA',
  'ATLAS_RUN_ID',
  'ATLAS_REPOSITORY',
  'ATLAS_PR_NUMBER',
  'ATLAS_BRANCH',
  'ATLAS_BASE_BRANCH',
  'ATLAS_EVENT_NAME',
];
for (const name of requiredEnv) {
  if (!env[name]) throw new Error(`Missing required environment variable ${name}`);
}

const head = env.ATLAS_HEAD_SHA;
if (!/^[0-9a-f]{40}$/.test(head)) throw new Error(`Invalid exact Head: ${head}`);

const root = process.cwd();
const webInput = path.resolve(env.ATLAS_WEB_DIR ?? 'ci-input/web');
const qualityInput = path.resolve(env.ATLAS_QUALITY_DIR ?? 'ci-input/quality');
const logsInput = path.resolve(env.ATLAS_LOGS_DIR ?? 'ci-input/logs');
const output = path.resolve(env.ATLAS_EVIDENCE_DIR ?? 'ci-evidence/final');
const qualityReportPath = path.join(qualityInput, 'ci-evidence', 'g7', 'quality-report.json');
const screenshotRoot = path.join(qualityInput, 'ci-evidence', 'g7');

const checkedOutHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (checkedOutHead !== head) {
  throw new Error(`Checkout ${checkedOutHead} does not match exact PR Head ${head}`);
}

const qualityReport = JSON.parse(await readFile(qualityReportPath, 'utf8'));
const quality = validateQualityReport(qualityReport, head);
for (const screenshot of quality.screenshots) {
  await readFile(path.join(screenshotRoot, screenshot.path));
}

for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.svg', 'icon-maskable.svg']) {
  await readFile(path.join(webInput, file));
}
const manifest = JSON.parse(await readFile(path.join(webInput, 'manifest.webmanifest'), 'utf8'));
if (manifest.name !== 'ATLAS X Unified Pro' || manifest.display !== 'standalone') {
  throw new Error('Production Web manifest does not identify the standalone ATLAS X application');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(webInput, path.join(output, 'web-build'), { recursive: true });
await cp(qualityInput, path.join(output, 'browser-quality'), { recursive: true });
await cp(logsInput, path.join(output, 'ci-logs'), { recursive: true });

const stateSource = path.join(root, '..', '.codex', 'goal-loop', 'atlas-x-unified-pro');
await cp(stateSource, path.join(output, 'goal-loop-state'), { recursive: true });

const sourceProof = path.join(output, 'source-proof');
await mkdir(sourceProof, { recursive: true });
for (const file of [
  'package.json',
  'package-lock.json',
  'requirements-e2e.txt',
  'apps/web/index.html',
  'apps/web/public/manifest.webmanifest',
  'apps/web/public/sw.js',
  'scripts/verify-pwa-build.mjs',
  'scripts/web-quality.py',
  'scripts/web-quality-safe.py',
  'scripts/build-final-evidence.mjs',
  'scripts/final-evidence-lib.mjs',
]) {
  const destination = path.join(sourceProof, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, file), destination);
}
await cp(
  path.join(root, '..', '.github', 'workflows', 'atlas-x-unified-verify.yml'),
  path.join(sourceProof, 'atlas-x-unified-verify.yml'),
);

const commit = execFileSync('git', ['show', '-s', '--format=fuller', head], { encoding: 'utf8' });
const diffStat = execFileSync('git', ['diff', '--stat', `${env.ATLAS_BASE_SHA}...${head}`], { encoding: 'utf8' });
await writeFile(path.join(output, 'EXACT-HEAD.txt'), `${head}\n`, 'utf8');
await writeFile(path.join(output, 'COMMIT.txt'), commit, 'utf8');
await writeFile(path.join(output, 'DIFF-STAT.txt'), diffStat, 'utf8');

const webFiles = await walkFiles(path.join(output, 'web-build'));
const qualityFiles = await walkFiles(path.join(output, 'browser-quality'));
const evidenceManifest = {
  schemaVersion: 'atlas.final-evidence.v1',
  generatedAt: new Date().toISOString(),
  repository: env.ATLAS_REPOSITORY,
  pullRequest: Number(env.ATLAS_PR_NUMBER),
  branch: env.ATLAS_BRANCH,
  baseBranch: env.ATLAS_BASE_BRANCH,
  baseSha: env.ATLAS_BASE_SHA,
  exactHead: head,
  checkedOutHead,
  workflow: {
    runId: Number(env.ATLAS_RUN_ID),
    eventName: env.ATLAS_EVENT_NAME,
  },
  productBoundary: {
    publicMarketData: 'read-only',
    trading: 'local paper ledger only',
    realFunds: false,
    productionDeployment: false,
    perpetualContracts: false,
  },
  verification: {
    quality,
    webManifest: {
      name: manifest.name,
      shortName: manifest.short_name,
      display: manifest.display,
      startUrl: manifest.start_url,
      scope: manifest.scope,
    },
    webFileCount: webFiles.length,
    qualityFileCount: qualityFiles.length,
  },
  reviewOrder: [
    'MANIFEST.json',
    'REVIEW.md',
    'CHECKSUMS.sha256',
    'browser-quality/ci-evidence/g7/quality-report.json',
    'browser-quality/ci-evidence/g7/screenshots/',
    'goal-loop-state/ACCEPTANCE.md',
    'web-build/',
  ],
};
await writeFile(path.join(output, 'MANIFEST.json'), `${JSON.stringify(evidenceManifest, null, 2)}\n`, 'utf8');

const review = `# ATLAS X Unified Pro — Independent Review Package\n\n## Exact identity\n\n- Repository: \`${env.ATLAS_REPOSITORY}\`\n- Draft PR: #${env.ATLAS_PR_NUMBER}\n- Branch: \`${env.ATLAS_BRANCH}\`\n- Base: \`${env.ATLAS_BASE_BRANCH}\` at \`${env.ATLAS_BASE_SHA}\`\n- Exact reviewed Head: \`${head}\`\n- Actions Run: \`${env.ATLAS_RUN_ID}\`\n\n## Review order\n\n1. Confirm \`EXACT-HEAD.txt\`, \`MANIFEST.json\` and \`CHECKSUMS.sha256\`.\n2. Read \`goal-loop-state/ACCEPTANCE.md\` for milestone evidence and explicit exclusions.\n3. Inspect \`browser-quality/ci-evidence/g7/quality-report.json\`. It must report the same exact Head and \`passed: true\`.\n4. Review all four screenshots under \`browser-quality/ci-evidence/g7/screenshots/\`.\n5. Inspect or serve \`web-build/\` as the production PWA output.\n6. Use \`source-proof/\` to audit the workflow, PWA policy and browser-quality gates.\n\n## Safety boundary\n\nThis package contains a read-only public-market Web/PWA and a local simulated trading ledger. It does not connect to a real brokerage account, submit real orders, move real funds, deploy production infrastructure or implement perpetual contracts. PR #${env.ATLAS_PR_NUMBER} must remain Draft and unmerged until a separate deployment permission decision.\n`;
await writeFile(path.join(output, 'REVIEW.md'), review, 'utf8');

const checksums = await checksumLines(output, new Set(['CHECKSUMS.sha256']));
await writeFile(path.join(output, 'CHECKSUMS.sha256'), `${checksums.join('\n')}\n`, 'utf8');

console.log(`[final-evidence] head=${head} webFiles=${webFiles.length} qualityFiles=${qualityFiles.length} checksums=${checksums.length}`);
