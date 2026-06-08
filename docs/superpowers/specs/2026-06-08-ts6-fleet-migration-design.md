# TypeScript 6 Fleet Migration — Capability Design

**Date:** 2026-06-08
**Status:** Approved (design)
**Scope owner:** WYRE MCP fleet

## Objective

Establish a *proven, reusable capability* to migrate the WYRE MCP server fleet
(~45 TypeScript repos) to TypeScript 6 — validated on two canaries that cover both
tsconfig dialects, baked into the scaffolding skills, and encoded as an executable
runbook + tracker.

**This effort deliberately stops before the fleet-wide fan-out.** TypeScript 6.0 is
brand new; we prove the recipe and build the tooling now, and pull the trigger
across all repos later (the dry-run triage in "Future fan-out" is the recommended
first step of that push).

## Background — why this is needed

TypeScript 6.0 stopped auto-including `@types/node`'s global declarations. Repos whose
`tsconfig.json` relies on implicit `@types/*` inclusion lose `process`, `fetch`,
`Response`, `Request`, `Headers`, `URL`, and `URLSearchParams`, so `tsc` fails with
`Cannot find name '<global>'`. This was first hit on `itglue-mcp` while triaging
Dependabot PR #33 (typescript 5.9.3 → 6.0.3), where TS6 was deferred and a Dependabot
`ignore` for `typescript` semver-major was added so the PR would not keep reopening.

**Confirmed fix (spike on `itglue-mcp`):** adding `"types": ["node"]` to
`compilerOptions` restores all the missing globals under TS6. Verified with
`lib: ["ES2022"]` only — **no `DOM`/`WebWorker` lib entry is required**, because
`@types/node` declares the web-standard globals (`fetch`/`Response`/`URL`/…) that
`worker.ts` uses.

## In scope / out of scope

**In scope:** ~45 TypeScript `*-mcp` repos plus `mcp-gateway` / `mcpgw-cli`.

**Out of scope (JavaScript repos — no TS to bump):** `datto-bcdr-mcp`,
`datto-saas-protection-mcp`, `kaseya-bms-mcp`, `kaseya-vsa-mcp`, `spanning-mcp`,
`unitrends-mcp`.

**Out of scope for this effort:** the fleet-wide fan-out (only the two canaries are
migrated now).

## Fleet is not uniform

Sampling the fleet found at least two tsconfig dialects, so the migration is **not** a
one-line sed across identical repos. The codemod and canaries must cover both:

| Dialect | Shape | Examples |
|---------|-------|----------|
| A — NodeNext + explicit `lib` | `module/moduleResolution: NodeNext`, `lib: ["ES2022"]`, no `types` | itglue, halopsa, mcp-gateway; autotask is a CJS/ES2020 variant |
| B — bundler, no lib/types | `module: ESNext`, `moduleResolution: bundler`, no `lib`, no `types` | huntress, rootly |

TS versions also vary across the fleet (5.3 – 5.9), so the migration normalizes them.

## The per-repo fix (recipe)

1. Ensure `compilerOptions.types` includes `"node"` (create the array if absent — this
   is the dialect-agnostic part).
2. Bump `typescript` → `^6.0.x` (devDep); bump `@types/node` to current major if stale.
3. Run `build` + `test` + `lint` + `typecheck`. Hand-fix any *additional* TS6
   breakages (majors carry more than the globals change — this is per-repo and is why
   we canary rather than blind-fan-out).
4. Remove the Dependabot `typescript` semver-major `ignore` from `.github/dependabot.yml`
   once the repo is on TS6 (so future TS minors/patches flow normally).

## Deliverables (this effort)

1. **Two canary PRs — merged & green:**
   - `itglue-mcp` (Dialect A; has `worker.ts`, exercises web globals).
   - `huntress-mcp` (Dialect B; `bundler` resolution, no `lib`/`types`).
   Each must pass build + test + lint + typecheck locally **and** in CI (including the
   `assert` eval job) before merge.
2. **`ts6-fleet-migration` skill** (authored via skill-creator): houses the codemod
   script, the subagent dispatch pattern, the per-repo verify checklist, and the
   dialect notes — the durable, executable home for the capability.
3. **Codemod script** (in the skill): a dependency-free Node script that is idempotent
   and dialect-aware — parses `tsconfig.json`, ensures `types` includes `"node"`,
   updates `package.json` `typescript`/`@types/node`, and touches nothing else.
   Re-runnable safely; used by both the canaries and the eventual fan-out.
4. **Taskmaster tracker** seeded with every in-scope repo (status pending/done/blocked)
   so the eventual fan-out is trackable.
5. **Updated scaffolding skills** (`mcp-vendor-scaffolding`, `mcp-server-fleet-ci-template`):
   TS pin → `^6.0.0` and canonical tsconfig gains `types: ["node"]`, so new vendors are
   born TS6-ready.

## Subagent dispatch pattern (documented, not executed now)

For the future fan-out, one repo per subagent:
clone/worktree → run codemod → `npm i` → build/test/lint/typecheck → on green, open a
`build(deps-dev): adopt TypeScript 6` PR and check off the tracker; on failure, capture
the error class and mark the repo **blocked** for hand-fixing. Encoded in the skill so
the later push is mechanical.

## Verification & rollback

- Canaries: green locally and in CI before merge.
- Merge mechanics mirror the Dependabot cleanup (`main` requires one code-owner review,
  `enforce_admins: false`). Admin-merge or tee-up for review — operator's choice at
  merge time.
- Rollback = revert the single per-repo PR; the codemod change is self-contained.

## Risks

- **Per-repo TS6 breakages beyond globals.** The globals fix is confirmed; stricter TS6
  checks may surface additional type errors in individual repos. Mitigated by
  canary-first + no blind fan-out.
- **`worker.ts` / Cloudflare repos.** Spike showed `types: ["node"]` covers the
  web-standard globals; still verify per repo since worker entries vary.
- **TS 6.0 maturity.** It is brand new. The capability is built now; broad adoption is
  intentionally deferred.

## Future fan-out (not part of this effort)

Recommended first step of the eventual push: run the codemod in `--dry-run` across all
in-scope repos and `tsc` each, classifying *green* vs *needs-hand-fixing* to produce a
fan-out cost report before committing. Then dispatch subagents per the pattern above,
driven by the Taskmaster tracker.
