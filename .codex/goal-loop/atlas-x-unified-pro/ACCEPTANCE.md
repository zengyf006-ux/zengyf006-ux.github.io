# ATLAS X Unified Pro — Acceptance Ledger

## Parent acceptance

All implementation and evidence goals G0–G10 are complete. PR #15 must remain Draft and unmerged. G11 is a separate permission gate and is not authorized by technical completion.

## G1 foundation rework — accepted

Head `e874c3275f69e3f1e35ba763ae97250f983c05d5`, Run `29192009639`.

## G2 workspace boundaries — accepted

Head `51e9d1b754701e2b890de0ee572b6a359869a576`, Run `29192393389`.

## G3 market data — accepted

Head `6e1e98ead4e157311571a05d29445c344f6deafb`, Run `29193464887`.

- Deterministic fixture mode is separately identified and tested.
- Coinbase public parser and adapter produce real-source canonical events.
- Every cached/offline retained value is visibly `cachedReal`.
- Connection states, sequence degradation, reconnect, stale/offline recovery and independent public smoke are tested.

## G4 paper ledger — accepted

Head `7a279fa0552924b990f64bd61cc876baace0bf40`, Run `29195070635`.

- Deterministic event replay and exact initial/available/locked/total balances.
- market, limit, stopMarket and stopLimit lifecycle.
- Quote/base reservations, cancellation release, partial and full fills.
- Exact fees, weighted position cost, realized/unrealized PnL and equity.
- Stable command/event idempotency and sequence-gap rejection.
- IndexedDB cross-instance reload, storage failure mapping and confirmation-gated reset.
- All paper data is explicitly `simulated`; real public smoke remains separate.

## G5 Web product — accepted

Head `822c8cc06c5e6a4b7fbae81d65d628f86ea0f6d6`, Run `29199915453`.

- React/Vite production build, strict workspace typechecks, generated drift, audit and public market smoke passed.
- 24 Vitest files / 164 tests passed without weakening or skipping tests.
- All four paper order types and quantity/amount/percentage input modes use decimal-safe shared domain logic.
- Terminal, markets, watchlist, assets, orders, fills, alerts, settings, data health and help are reachable on desktop and mobile.
- One event-sourced account is shared across routes and persists in IndexedDB where available.
- Coinbase ticker, order book, trades and read-only K lines render with explicit provider and truthfulness labels.
- K lines use decimal-safe geometry, request latency, truthful real-cache retention and immediate online/offline recovery.
- Web Artifact `8262077478`, digest `sha256:692f16eea83aa70678f50fc56fd26e9ee3d9199f6bc221b7276ebab0f12db3cd`.
- CI diagnostics `8262077374`, digest `sha256:e9ebcac2e5273f762a8fadca87a57fb6e7d16d2e69d20faddf9785a3aa5cb398`.

## G6 PWA — accepted

Head `1ac0bb07ef94010712569237846a9fe52592140b`, Run `29200295123`.

- Standalone manifest, stable identity, normal and maskable icons are present in production output.
- Versioned same-origin shell caches only eligible GET navigation/static resources.
- Authorization, cookie, API, auth, order, account and cross-origin market requests are excluded.
- Offline, recovered, install-available and update-ready states are explicit.
- Updates wait for user action; controller replacement reloads only after `安全更新`.
- 25 Vitest files / 168 tests, strict typecheck, production build, PWA gate, audit and public smoke passed.
- Web Artifact `8262186843`, digest `sha256:cc0f4465e1c853430e82cc3531d5a81f761c06c7035a403c0565f4b91041b7de`.
- CI diagnostics `8262186688`, digest `sha256:13b1610de9b3e1b6501829ca657b4517ff49c5b09e63988148f5f08c31512df7`.

## G7 quality gates — accepted

Head `3cf2c80aee74337c5571154b6e1c392bf765b563`, Run `29201636493`.

- Existing unit, contract, vector, state, ledger, persistence and reconnect coverage remained intact.
- Browser E2E submitted a paper buy, observed shared state and restored the exact position after IndexedDB-backed reload.
- Production service worker controlled the preview, rendered offline and surfaced recovery.
- No unnamed controls, unlabeled inputs, duplicate IDs, missing alternatives or unnamed accessibility-tree controls.
- Keyboard traversal reached 18 unique controls with visible focus.
- Performance stayed under deterministic budgets.
- Four viewports passed without horizontal overflow: 1440×900, 1024×768, 768×1024 and 390×844.
- Browser quality Artifact `8262563434`, digest `sha256:8be42c52637dca17f633a499e675ed6f68ef925b0541ac225e69e3cf9e2a9e25`.
- Web Artifact `8262557566`, digest `sha256:c7e254c003e840416975b878b216646629cf9b9fd8a70eac11fb25a49f5f95c9`.
- CI diagnostics `8262557472`, digest `sha256:5bc9762d657a0dd4e0c9fd1ee14904bca9ba45c19765159ea1873d256dc14873`.

## G8 visual iteration 1 — accepted

Head `dbf2b24d6db2ff0364aa85dc76a63adb6e237448`, Run `29201931971`.

- Exact G7 screenshots drove a chart-led desktop workspace, dedicated market rail and full-height paper ticket.
- Laptop preserves chart and ticket in the first viewport; tablet/mobile use explicit task panes.
- Noto CJK produces readable Chinese screenshot evidence.
- All functional, accessibility, persistence, recovery, performance and four-viewport gates remained green.
- Browser quality Artifact `8262648834`, digest `sha256:5b1f7eaea508c6e569d2d94f094f6033455c002f8e147658cc6ed03c8fc0b7c9`.
- Web Artifact `8262641527`, digest `sha256:971ef1aaabf938c488e9552ad6b88cc3217f9bb6f042437630fe2be4ed3681e4`.
- CI diagnostics `8262641291`, digest `sha256:51ccf168f97eab55fae4c0fdec3c653264b2a29f6fa58d8a7a97563ad7f75771`.

## G9 visual iteration 2 — accepted

Head `2643b59313af011fe5e08afbab0171c24fa0cab4`, Run `29202179426`.

- Duplicated desktop source emphasis was removed without hiding runtime, chart, panel or data-health truthfulness.
- Desktop/laptop ticket whitespace now states the local-paper/no-real-funds boundary.
- Mobile runtime, header, task switch and bottom navigation were compressed and corrected.
- All 25 Vitest files / 168 tests and every browser quality gate passed.
- Final-polish performance: FCP `296 ms`, load `115.1 ms`, transfer `104,362 B`, JS `96,878 B`, CSS `6,154 B`, DOM `256`, CLS `0.000438`, long tasks `186 ms`.
- Browser quality Artifact `8262716202`, digest `sha256:f54b7953b45a6d8d41891177e447257d243e76f92a71b50921d0fd57950d93e7`.
- Web Artifact `8262709536`, digest `sha256:77fbb5dfef4685a1d1b0c2b9f93c63476630e3bc3d08445b013ac6566aa26665`.
- CI diagnostics `8262709441`, digest `sha256:f91ec7c2a2a6bba5ce52d3e244e994e411f2a97e508f1fa699934c56a1340a17`.

## G10 final exact-Head evidence — accepted

Implementation/evidence Head `beb641e63ee006e3683544185cbdd71edc0b228e`, Run `29202495984`.

- All jobs explicitly checked out and confirmed the exact PR Head rather than a synthetic merge ref.
- 26 Vitest files / 171 tests, generated drift, strict TypeScript, production build, PWA gate, audit and independent live Coinbase smoke passed.
- Browser quality validated paper-flow E2E, reload persistence, offline shell/recovery, accessibility tree, keyboard focus, performance budgets and four readable CJK viewports against the same exact Head.
- The final-evidence job validated the exact Head, quality report, screenshots, production PWA files and goal-loop state; it generated a machine-readable manifest, review instructions and 58 SHA-256 checksum entries.
- Package self-check confirmed `exactHead` equals `checkedOutHead`; all package checksums verified locally.
- Final browser performance: FCP `308 ms`, load `106.8 ms`, transfer `103,632 B`, JS `96,878 B`, CSS `6,154 B`, DOM `256`, CLS `0.0004443`, long tasks `84 ms`.
- Independent review Artifact `8262801676`, digest `sha256:9f6603ab5d9a160ea707aa82aac007cbff47f7bc74c22501a83f83da0a438f23`.
- Browser quality Artifact `8262799335`, digest `sha256:8efe85eb40cbadc1c88fe07ff1e794740f1a4fab51802545fdb61e0c1cb35ce5`.
- Production Web Artifact `8262792751`, digest `sha256:0be856e70b58879b9301fc70e55052f21f2d121042cc072dad60eebebe78d988`.
- CI diagnostics Artifact `8262792562`, digest `sha256:d22e4ce43f4e2e95481cbf2ee70ac4c69637309213f64ba876b407de486b31cc`.
- Draft PR title/body now accurately describe the Unified Web/PWA scope, evidence and safety boundary.

This state-only completion commit is itself revalidated by the exact-Head workflow. GitHub’s latest successful run and PR Head are authoritative if they supersede the implementation/evidence Head recorded above.

## G11 deployment permission gate — not authorized

- PR #15 remains Draft, open and unmerged.
- No merge, production deployment, real account connection, real order, real-fund movement, gateway/Supabase change or perpetual-contract work is authorized.
- G11 may move only after an explicit user instruction that identifies the permitted action and target.
