# Codex parallel tasks

These tasks are independent review/test work only. Use the existing `atlas-x-unified-pro` branch and Draft PR #15. Do not create branches or PRs, merge, deploy, modify `main`, PR #13, legacy `atlas-x-pro`, Supabase or gateways. Do not weaken tests.

## C1 — Web accessibility and keyboard review

Status: ready

- Inspect the current React terminal, mobile task switch, order form, confirmation dialog, mobile more sheet and reset flow.
- Add focused accessibility tests for labels, roles, keyboard reachability, focus visibility and disabled states.
- Report concrete defects in `.codex/goal-loop/atlas-x-unified-pro/EVIDENCE/`.
- Fix only clearly isolated accessibility defects.

## C2 — Playwright fixture-flow tests

Status: ready

- Add deterministic fixture E2E coverage for: open terminal, switch interval, switch mobile task pane, submit market paper buy, view asset/fill state, submit limit order, cancel it, and verify released balance.
- Use the four required viewports: 390x844, 430x932, 1440x900 and 1920x1080.
- Fixtures must remain visibly identified as fixture and must not satisfy public market smoke.

## C3 — PWA readiness audit

Status: ready

- Review the current Vite application for manifest, installability, offline shell, update flow, safe-area behavior and cache policy prerequisites.
- Do not implement service-worker caching of live or cached market payloads.
- Record a concrete implementation checklist; isolated manifest/icon tests may be added.

## C4 — Code quality audit

Status: ready

- Review the Web shell for duplicate state, rendering-side effects, stale closure risks, decimal misuse, unreachable pages, placeholder controls and mobile overflow risks.
- Do not redesign the product or replace package boundaries.
- Record findings with file/line evidence and tests where practical.
