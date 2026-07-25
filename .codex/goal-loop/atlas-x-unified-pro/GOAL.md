# ATLAS X Unified Pro — Parent Goal

## Final outcome

Build and harden a production-quality, Chinese-first ATLAS X Web/PWA for real daily use with truthful public market data, deterministic paper trading, precise financial calculations, professional cross-device interaction, offline-safe PWA behavior, and auditable evidence on Draft PR #15.

## Non-negotiable boundaries

- Continue only on branch `atlas-x-unified-pro` and Draft PR #15.
- Never merge, modify `main`, deploy, place real orders, connect real funds, read/output secrets, use paid services, delete legacy business data, or modify production Supabase/gateway.
- `atlas-x-pro` and PR #13 are reference libraries only; do not patch or copy their architecture.
- Do not begin SwiftUI implementation before Web/PWA passes independent review and explicit user approval.
- Financial JSON boundaries use canonical decimal strings and the shared 34-significant-digit contract.
- Truthfulness (`unknown`, `cachedReal`, `real`, `simulated`, `fixture`) must remain explicit and non-interchangeable.

## Completion evidence

Completion requires all acceptance conditions in `ACCEPTANCE.md`, exact-Head GitHub Actions success, four-viewport screenshots, two visual review iterations, deployable build artifact, complete documentation, Draft PR retained, and no changes outside approved paths except the dedicated workflow and this goal-loop state.
