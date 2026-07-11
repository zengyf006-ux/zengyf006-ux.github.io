# Order Execution Audit Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only order and execution audit center that projects existing core orders, fills, OCO orders, and exit strategies into traceable lifecycle, fee, and slippage records across desktop and mobile.

**Architecture:** A new `order-execution-audit.js` module reads the existing local ledgers and generates normalized records on demand. It stores only bounded canceled-order snapshots and UI preferences in `atlasX.pro.executionAudit.v1`; it never writes account cash, positions, orders, history, OCO orders, or exit strategies. A dedicated account tab and detail panel keep high-density audit information out of the main trading workspace.

**Tech Stack:** Vanilla JavaScript, CSS, localStorage projections, MutationObserver, Playwright browser acceptance tests, GitHub Actions.

## Global Constraints

- Do not change real-money boundaries or request exchange credentials.
- Do not create a second balance, position, order, or fill ledger.
- Do not invent slippage when a valid reference price is absent.
- Preserve all existing order, position, reservation, OCO, exit strategy, alert, market data, and mobile tests.
- Validate 390×844, 430×932, 1440×900, and 1920×1080.
- Keep the pull request draft and do not replace the live legacy site until deployment verification is complete.

---

### Task 1: Add failing audit acceptance test

**Files:**
- Create: `qa/atlas-x-pro/order-execution-audit.mjs`
- Modify: `.github/workflows/atlas-x-pro-qa.yml`

**Interfaces:**
- Consumes: existing localStorage ledgers.
- Produces: expected `window.AtlasExecutionAudit`, `html[data-execution-audit="ready"]`, audit account tab, record list, detail panel, and report JSON.

- [ ] Write a Playwright test that seeds one active core order, two fills with and without reference prices, one terminal OCO order, one terminal trailing stop, and one position.
- [ ] Verify the test fails because the audit module and UI do not exist.
- [ ] Add the test to the four-viewport workflow and artifact upload list.
- [ ] Commit the red test.

### Task 2: Implement normalized projection and cost calculations

**Files:**
- Create: `atlas-x-pro/order-execution-audit.js`

**Interfaces:**
- Consumes: `atlasX.pro.v1`, `atlasX.pro.advancedOrders.v1`, `atlasX.pro.exitStrategies.v1`, `atlasX.pro.executionAudit.v1`.
- Produces: `window.AtlasExecutionAudit.getRecords()`, `openRecord(id)`, `refresh()`, `archiveCanceledOrder(order)`.

- [ ] Normalize active orders, fills, OCO records, exit strategies, and canceled snapshots.
- [ ] Calculate adverse slippage bps for buy and sell records only when reference price is valid.
- [ ] Calculate gross notional, fee, slippage cost, and total execution cost.
- [ ] Build lifecycle timeline nodes from existing timestamps and statuses.
- [ ] Bound canceled snapshots to 80 records and UI state to a fixed schema.
- [ ] Confirm the module never writes any source ledger.

### Task 3: Add desktop and mobile audit UI

**Files:**
- Create: `atlas-x-pro/order-execution-audit.css`
- Modify: `atlas-x-pro/bootstrap.js`

**Interfaces:**
- Consumes: normalized records from Task 2.
- Produces: account tab `data-account-tab="audit"`, view `data-account-view="audit"`, summary cards, filters, audit rows, detail panel, and row entry actions.

- [ ] Mount the audit tab after the history tab.
- [ ] Mount the audit view inside the account workspace.
- [ ] Add summary, filters, record list, and detail markup.
- [ ] Add audit entry buttons to position, order, and history rows through MutationObserver without modifying core render functions.
- [ ] On mobile, switch to account view before opening a record and use full-width scrollable cards.
- [ ] Load CSS and JS from bootstrap after reservation and workspace modules.

### Task 4: Capture core canceled-order snapshots

**Files:**
- Modify: `atlas-x-pro/order-execution-audit.js`

**Interfaces:**
- Consumes: capture-phase clicks on `[data-cancel-order]` and the pre-cancel core order.
- Produces: bounded read-only `canceled_order` audit snapshot.

- [ ] Capture the exact source order before the core handler removes it.
- [ ] Store only fields required for audit display.
- [ ] Confirm the snapshot cannot affect balances, reservations, risk, or performance analytics.
- [ ] Verify the canceled record appears after the source order disappears.

### Task 5: Complete four-viewport verification and visual review

**Files:**
- Modify as required only to fix root causes.

**Interfaces:**
- Consumes: full acceptance workflow and screenshot artifacts.
- Produces: four green jobs and readable screenshots.

- [ ] Run the audit test and confirm all behavior checks pass.
- [ ] Run the complete four-viewport acceptance workflow.
- [ ] Inspect desktop and mobile audit screenshots for hierarchy, clipping, readability, and touch targets.
- [ ] Do not loosen financial, lifecycle, overflow, or error assertions.

### Task 6: Update persistent project state and deploy safely

**Files:**
- Modify: `atlas-x-pro/PROJECT-STATE.md`
- Modify deployment metadata or branch only after green verification.

**Interfaces:**
- Consumes: verified commit SHA, workflow run IDs, screenshot review, repository Pages configuration.
- Produces: persistent handoff and reachable deployment URL.

- [ ] Record start/end SHAs, files, tests, visual status, known risks, and next priority.
- [ ] Determine the current Pages source and compare the feature branch against `main`.
- [ ] Deploy without deleting or replacing the legacy root site; publish ATLAS X Pro at its own path.
- [ ] Verify the deployed URL loads the professional terminal and not a 404 or old build.
- [ ] Keep rollback possible by retaining the pre-deployment main SHA.
