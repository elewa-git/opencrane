# TASK-CODEX-REGROUP — finish the server-domain regroup (→ Codex)

Mission. Complete the physical regroup of `libs/backend/server/*` into six capability groups,
started on branch `feat/phase-d-server-domain-groups` (based on `feat/phase-d-reintegrate-d4-readmes`,
PR #303 — merge that first or keep this stacked on it). The taxonomy was approved by Jente.

## Target taxonomy (final)

| Group | Domains |
|---|---|
| `iam/` | identity, membership, authorization, policies, grants, groups, access-tokens, audit |
| `agents/` | agent-services, skills, artifacts, channel-targets |
| `gateways/` | mcp, integrations, providers, model-routing |
| `knowledge/` | retrieval, company-docs |
| `tenancy/` | tenants, cluster-tenants, projection, contract, connections |
| `reporting/` | metrics, spend, awareness |

`api-spec` stays top-level (it aggregates every group; placing it inside one would misstate
dependency direction). Layout: `libs/backend/server/<group>/<domain>/main`. Import alias:
`@opencrane/backend/server/<group>/<domain>`. Nx project names (`backend-server-<domain>`) and
eslint scope tags are UNCHANGED.

## Already done (last commit on the branch)

- All 26 `git mv`s into group dirs.
- Per-package config depth fixes (+1 `../`) for all 26: `project.json` (sourceRoot, both `cwd`s,
  `$schema`), `tsconfig.json` `extends`, `vitest.config.ts` (both root-relative refs).
- Alias renames (root `tsconfig.json` key+path AND all import sites) for **iam/*** and **agents/***
  only. (`channel-targets` never had an alias — see gap-fix below.)
- Script path fixes: `scripts/phase-a-forbidden-references.sh` (identity, connections),
  `scripts/integration-authority-negative-tests.sh` (agent-services, integrations).
- The branch also folds PR #300's rich per-domain READMEs (add/add conflicts resolved in its favour);
  #300 is superseded once this merges.

## Remaining work

1. **Alias rewrites for the 14 remaining domains** (gateways/knowledge/tenancy/reporting tables
   above): in root `tsconfig.json` (alias key + `./libs/...` path) and every import site
   (`grep -rl --include="*.ts" --include="*.json" "@opencrane/backend/server/<d>"` excluding
   node_modules/dist, then sed `@opencrane/backend/server/<d>` → `.../<group>/<d>`). Substring
   safety holds as-is (`server/tenants` cannot match `server/cluster-tenants`).
2. **Gap-fix `channel-targets`** (flagged in its README): add tsconfig alias
   `@opencrane/backend/server/agents/channel-targets` → its `main/src/index.ts`, and an eslint
   depConstraint row `scope:channel-targets` → `["scope:authorization", "scope:membership",
   "scope:channel-targets", "scope:shared"]` — verify the exact needed tag set from its imports
   before committing.
3. **Group READMEs (6)** at `libs/backend/server/<group>/README.md`: the group's shared concern,
   member table with one-liners (lift from each domain README's opening), and the inter-group
   dependency rule. Baseline rule to state (verify against eslint constraints + actual imports):
   everything may depend on `iam`; `agents`/`gateways`/`knowledge` never depend on each other;
   `tenancy` is the blue-leaning group (most dies at replacement); `reporting` reads others, feeds none.
4. **Rewrite `libs/backend/server/README.md`** as the six-group map (replace the current flat
   Phase-D-authorities list; keep the pointer to `../agents/personal/` and `../README.md`).
5. **Domain README closing links**: every `<domain>/main/README.md` ends with
   `See [\`../../README.md\`](../../README.md) for the control-plane capability map.` After the move
   `../../` resolves to the GROUP dir — correct target, stale wording. Change wording to
   "for the <group> capability group" (or equivalent) in the moved domains' READMEs.
6. **`libs/frontend/README.md` (new)** — docs-level mirror, approved by Jente: brief statement that
   frontend keeps its technical layering (elements/features/state) and a mapping table of frontend
   packages → server capability groups: tools+mcp/adapter+provider-key/adapter → gateways;
   customer-admin+tenant/adapter+settings/adapter → tenancy; metrics → reporting;
   conversation+state/conversation/* → personal agents (blue-era, dies at replacement);
   welcome/onboarding/core/platform → cross-cutting. Note the `state/gateways` naming collision
   (DI composition root, unrelated to the gateways group).
7. **Docs path references** `libs/backend/server/<d>` → grouped, in: `docs/agents/app-specific.md`,
   `docs/agents/cluster-architecture.md`, `docs/agents/apps/opencrane.md`,
   `docs/agents/app-source-allowlist.json` (if it lists lib paths), `docs/agents/prisma.md`,
   `libs/backend/README.md`, and any `website/**` hits (`git grep -l "libs/backend/server/" website docs`).
   Leave historical records (docs/briefs, docs/research, CHANGELOG, plan-done) untouched.
8. **Validation gate** (all must pass):
   - `npx nx show projects | grep backend-server | wc -l` — still 27.
   - `npx nx run-many -t lint --projects=tag:layer:backend` (tsc per package).
   - `npx nx run-many -t test --projects=tag:layer:backend` (vitest; also proves vitest-config depth fixes).
   - `apps/opencrane` lint+test (imports all groups).
   - `bash scripts/agent-style-check.sh`, `bash scripts/phase-a-forbidden-references.sh`,
     `bash scripts/integration-authority-negative-tests.sh`,
     `bash scripts/phase-d-agent-namespace-negative-tests.sh`, `bash scripts/phase-b-topology.sh`.
   - `git grep -n "@opencrane/backend/server/" -- apps libs | grep -vE "server/(iam|agents|gateways|knowledge|tenancy|reporting|api-spec)/"`
     → must return nothing.
9. **Finish**: delete this file in the final commit; push; open PR
   `feat/phase-d-server-domain-groups` → `feat/phase-d-reintegrate-d4-readmes` (or retarget to
   `own-personal-ai-agent-setup` if #303 has merged); close #300 as superseded with a comment.

## Traps hit already — do not repeat

- The interactive shell here is **zsh**: `set -- $m` does NOT word-split. Run migration loops via
  `bash script.sh`, never inline.
- `grep -rl` returns exit 1 on zero matches → under `set -euo pipefail` it kills the script
  (this is exactly how run 1 died at channel-targets). Guard with `|| true`.
- A parallel worktree holds `feat/phase-d-reintegrate-d4-readmes` at
  `.codex/worktrees/reintegrate-d4-readmes`; this branch lives in
  `.claude/worktrees/phase-d-docs-standard-6d1698`. Verify which checkout you are editing before
  committing (`git rev-parse --show-toplevel`).
