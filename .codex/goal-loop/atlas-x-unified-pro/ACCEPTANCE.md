# ATLAS X Unified Pro — Acceptance Ledger

## Parent acceptance

Final review requires all completion conditions on an exact Head while PR #15 remains Draft and unmerged.

## G1 foundation rework — accepted

Head `e874c3275f69e3f1e35ba763ae97250f983c05d5`, Run `29192009639`.

## G2 workspace boundaries — accepted

Head `51e9d1b754701e2b890de0ee572b6a359869a576`, Run `29192393389`.

## G3 market data — accepted

Head `6e1e98ead4e157311571a05d29445c344f6deafb`, Run `29193464887`.

- Deterministic fixture mode is separately identified and tested.
- Coinbase public parser and adapter produce real-source canonical events.
- Every cached/offline retained value is visibly `cachedReal`.
- Complete connection states, sequence degradation, reconnect, stale/offline recovery and public smoke are tested.

## G4 paper ledger — accepted

Head `7a279fa0552924b990f64bd61cc876baace0bf40`, Run `29195070635`.

- Deterministic event replay and exact initial/available/locked/total balances.
- market, limit, stopMarket and stopLimit lifecycle.
- Quote/base reservations, cancellation release, partial and full fills.
- Exact fees, weighted position cost, realized/unrealized PnL and equity.
- Stable command/event idempotency and sequence-gap rejection.
- IndexedDB cross-instance reload, storage failure mapping and confirmation-gated reset.
- All paper data is explicitly `simulated`; real public smoke remains separate and passed.

## G5 Web product — accepted

Exact verified implementation Head `822c8cc06c5e6a4b7fbae81d65d628f86ea0f6d6`, Run `29199915453`.

- React/Vite production build, all strict workspace typechecks, generated drift, audit and public market smoke passed.
- 24 Vitest files / 164 tests passed without weakening or skipping tests.
- Market, limit, stopMarket and stopLimit paper order drafts are available.
- Quantity, amount and percentage inputs use shared decimal-safe domain logic.
- Terminal, markets, watchlist, assets, current orders, fills, alerts, settings, data-health and help are reachable on desktop and mobile.
- One shared event-sourced paper account uses IndexedDB where available and truthfully reports memory fallback.
- Mobile uses explicit chart/book/order/trades task panes instead of an unbounded vertical terminal.
- Coinbase ticker, order book, trades and read-only K lines are rendered with explicit provider and truthfulness labels.
- Public K lines use exact decimal geometry, show request latency, retain only real values in IndexedDB, relabel offline retention as `cachedReal`, and fall back to visibly labeled fixture data when no real cache exists.
- Browser online/offline events trigger immediate K-line recovery/fallback; duplicate refreshes are suppressed.
- Web build Artifact ID `8262077478`, digest `sha256:692f16eea83aa70678f50fc56fd26e9ee3d9199f6bc221b7276ebab0f12db3cd`.
- CI diagnostics Artifact ID `8262077374`, digest `sha256:e9ebcac2e5273f762a8fadca87a57fb6e7d16d2e69d20faddf9785a3aa5cb398`.

The remaining E2E, accessibility, performance and four-viewport gates belong to G7. Screenshot-led product redesign belongs to G8 and G9; those requirements were not silently treated as G5 evidence.

## G6 PWA — accepted

Exact verified implementation Head `1ac0bb07ef94010712569237846a9fe52592140b`, Run `29200295123`.

- Standalone manifest, stable application identity, normal and maskable SVG icons are present in the production build.
- A versioned same-origin application-shell service worker caches only GET navigation and static assets.
- Authorization/cookie/API/auth/order/account requests and cross-origin Coinbase traffic are excluded from service-worker caching.
- Offline, recovered, install-available and update-ready states are explicit in the rendered product.
- Updates remain waiting until the user chooses `安全更新`; controller replacement reloads only after that explicit request.
- Production artifact verification confirms manifest linkage, shell files, compiled registration code and user-approved activation.
- 25 Vitest files / 168 tests, strict typecheck, production build, PWA artifact gate, audit and public smoke passed.
- Web build Artifact ID `8262186843`, digest `sha256:cc0f4465e1c853430e82cc3531d5a81f761c06c7035a403c0565f4b91041b7de`.
- CI diagnostics Artifact ID `8262186688`, digest `sha256:13b1610de9b3e1b6501829ca657b4517ff49c5b09e63988148f5f08c31512df7`.

## G7 quality gates — accepted

Exact verified implementation Head `3cf2c80aee74337c5571154b6e1c392bf765b563`, Run `29201636493`.

- All 25 Vitest files / 168 tests, generated drift, strict workspace typechecks, production build, PWA artifact gate, audit and independent Coinbase public smoke passed.
- Browser E2E submitted a paper buy, observed the position across pages and restored the exact position after a full IndexedDB-backed reload.
- The production service worker controlled the preview, rendered the application shell while offline and surfaced recovery after network restoration.
- Accessibility checks found no unnamed visible controls, unlabeled inputs, duplicate IDs, missing image alternatives or unnamed interactive accessibility-tree nodes.
- Keyboard traversal reached 18 unique controls and every sampled stop had a visible focus indicator.
- Performance evidence: FCP `532 ms`, load event `295.1 ms`, transfer `102,575 B`, JavaScript `96,879 B`, CSS `4,366 B`, DOM `256`, CLS `0.000527`, long tasks `300 ms`; all remained below deterministic budgets.
- Four screenshot viewports passed without horizontal overflow: 1440×900, 1024×768, 768×1024 and 390×844.
- Console errors and unhandled page errors were both zero.
- Browser quality Artifact ID `8262563434`, digest `sha256:8be42c52637dca17f633a499e675ed6f68ef925b0541ac225e69e3cf9e2a9e25`.
- Web build Artifact ID `8262557566`, digest `sha256:c7e254c003e840416975b878b216646629cf9b9fd8a70eac11fb25a49f5f95c9`.
- CI diagnostics Artifact ID `8262557472`, digest `sha256:5bc9762d657a0dd4e0c9fd1ee14904bca9ba45c19765159ea1873d256dc14873`.

## G8 visual iteration 1 — accepted

Exact verified implementation Head `dbf2b24d6db2ff0364aa85dc76a63adb6e237448`, Run `29201931971`.

- The exact G7 screenshots were used to restructure the terminal rather than treating a passing functional gate as visual completion.
- Desktop now presents a chart-led primary workspace, a dedicated order-book/trades rail and a persistent full-height paper ticket.
- Laptop keeps chart and ticket in the first viewport; order book and trades continue below without horizontal overflow.
- Tablet and mobile expose explicit chart/book/order/trades task panes, and the browser gate verifies that the order pane remains reachable before returning to the chart screenshot.
- Noto CJK is installed in the screenshot job, producing readable Chinese evidence instead of missing-glyph boxes.
- All 25 Vitest files / 168 tests, strict typechecks, production build, PWA gate, audit, live public smoke, paper-flow E2E, reload persistence, offline recovery, accessibility, keyboard and four-viewports remained green.
- Performance evidence improved or stayed far under budget: FCP `412 ms`, load `119.9 ms`, transfer `103,062 B`, JavaScript `96,879 B`, CSS `5,583 B`, DOM `256`, CLS `0.000781`, long tasks `175 ms`.
- Four readable screenshots passed without horizontal overflow at 1440×900, 1024×768, 768×1024 and 390×844; console and page errors remained zero.
- Browser quality Artifact ID `8262648834`, digest `sha256:5b1f7eaea508c6e569d2d94f094f6033455c002f8e147658cc6ed03c8fc0b7c9`.
- Web build Artifact ID `8262641527`, digest `sha256:971ef1aaabf938c488e9552ad6b88cc3217f9bb6f042437630fe2be4ed3681e4`.
- CI diagnostics Artifact ID `8262641291`, digest `sha256:51ccf168f97eab55fae4c0fdec3c653264b2a29f6fa58d8a7a97563ad7f75771`.

## G9 visual iteration 2 — accepted

Exact verified implementation Head `2643b59313af011fe5e08afbab0171c24fa0cab4`, Run `29202179426`.

- The exact G8 screenshots were used to remove duplicated desktop source badges while preserving the global runtime state, chart source label, panel source labels and data-health route.
- Desktop and laptop ticket whitespace now ends with an explicit local-paper-ledger and no-real-funds boundary instead of decorative empty space.
- Mobile runtime, top bar, task switch and bottom navigation were compressed; the prior oversized `更多` control was corrected by restoring an explicit two-column mobile header grid.
- Desktop center-rail density and hover affordances were refined without changing any market or paper-trading behavior.
- All 25 Vitest files / 168 tests, strict typechecks, production build, PWA gate, audit, live public smoke, paper-flow E2E, reload persistence, offline recovery, accessibility, keyboard and four-viewports passed.
- Performance evidence remained far under budget: FCP `296 ms`, load `115.1 ms`, transfer `104,362 B`, JavaScript `96,878 B`, CSS `6,154 B`, DOM `256`, CLS `0.000438`, long tasks `186 ms`.
- Four final polish screenshots passed without horizontal overflow at 1440×900, 1024×768, 768×1024 and 390×844; console and page errors were zero.
- Browser quality Artifact ID `8262716202`, digest `sha256:f54b7953b45a6d8d41891177e447257d243e76f92a71b50921d0fd57950d93e7`.
- Web build Artifact ID `8262709536`, digest `sha256:77fbb5dfef4685a1d1b0c2b9f93c63476630e3bc3d08445b013ac6566aa26665`.
- CI diagnostics Artifact ID `8262709441`, digest `sha256:f91ec7c2a2a6bba5ce52d3e244e994e411f2a97e508f1fa699934c56a1340a17`.

## G10 final evidence — running

Required before acceptance:

- All workflow jobs must checkout and verify the exact PR Head rather than a synthetic merge ref.
- Build a machine-readable evidence manifest that validates the exact Head, production PWA build, browser report, screenshots, checksums and goal-loop state.
- Publish one independent-review Artifact containing the final build, browser evidence, state files and review instructions.
- Update the stale Draft PR title/body to the actual unified Web/PWA scope while keeping it Draft and unmerged.
