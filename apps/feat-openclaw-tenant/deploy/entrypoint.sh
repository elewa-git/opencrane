#!/bin/bash
set -euo pipefail

STATE_DIR="${OPENCLAW_STATE_DIR:-/data/openclaw}"
# Persistent workspace dir — must match agents.defaults.workspace in openclaw.json.
WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$STATE_DIR/workspace}"
SECRETS_DIR="${OPENCLAW_SECRETS_DIR:-/data/secrets}"
CONFIG_SOURCE="${OPENCRANE_CONFIG_SOURCE_PATH:-/config/openclaw.json}"
RUNTIME_CONTRACT_PATH="${OPENCRANE_RUNTIME_CONTRACT_PATH:-/config/opencrane-managed-runtime.json}"
# Writable copy of the contract — the polling loop writes here; entrypoint reads from here.
RUNTIME_CONTRACT_WRITABLE="${OPENCRANE_RUNTIME_CONTRACT_WRITABLE:-/tmp/opencrane-managed-runtime.json}"
SKILLS_DIR="$STATE_DIR/agents/main/skills"
# Control-plane re-pull configuration (injected by operator into every tenant Deployment).
OPENCRANE_CONTROL_PLANE_URL="${OPENCRANE_CONTROL_PLANE_URL:-}"
OPENCRANE_CONTRACT_TOKEN_PATH="${OPENCRANE_CONTRACT_TOKEN_PATH:-/var/run/opencrane/tokens/opencrane-server.token}"
OPENCLAW_TENANT_NAME="${OPENCLAW_TENANT_NAME:-}"
# Poll interval in seconds for the background contract re-pull loop.
CONTRACT_POLL_INTERVAL="${OPENCRANE_CONTRACT_POLL_INTERVAL:-30}"
# MCP policy from AccessPolicy (policy-level enforcement via runtime contract)
OPENCRANE_ALLOWED_MCP_SERVERS="${OPENCRANE_ALLOWED_MCP_SERVERS:-}"
OPENCRANE_DENIED_MCP_SERVERS="${OPENCRANE_DENIED_MCP_SERVERS:-}"
OPENCRANE_MCP_POLICY_ENFORCED="${OPENCRANE_MCP_POLICY_ENFORCED:-false}"
# Skill-registry delivery: pull entitled skill bundles by digest from the in-cluster
# feat-skill-registry, authenticating with the audience-bound projected SA token.
OPENCRANE_SKILL_REGISTRY_URL="${OPENCRANE_SKILL_REGISTRY_URL:-}"
OPENCRANE_SKILL_REGISTRY_TOKEN_PATH="${OPENCRANE_SKILL_REGISTRY_TOKEN_PATH:-/var/run/opencrane/tokens/feat-skill-registry.token}"
# Mandatory platform backends (decided, not optional). Org memory is Cognee; model routing is the
# LiteLLM proxy. The workspace docs state these as facts, so a pod that boots without them is
# MISCONFIGURED — the preflight below surfaces that loudly instead of letting the runtime silently
# degrade to workspace-only memory or a keyless model fallback.
OPENCRANE_MEMORY_BACKEND="${OPENCRANE_MEMORY_BACKEND:-}"
COGNEE_ENDPOINT="${COGNEE_ENDPOINT:-}"
LITELLM_ENDPOINT="${LITELLM_ENDPOINT:-}"

function _load_mcp_policy()
{
  local policy_env
  # Prefer writable refreshed copy; fall back to ConfigMap-mounted original.
  local contract_file="$RUNTIME_CONTRACT_WRITABLE"
  if [ ! -f "$contract_file" ]; then
    contract_file="$RUNTIME_CONTRACT_PATH"
  fi

  if [ ! -f "$contract_file" ]; then
    return 0
  fi

  if ! policy_env=$(node - "$contract_file" <<'EOF'
const fs = require("node:fs");

const contractPath = process.argv[2];
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const policy = contract?.policy?.mcpServers;
const allow = Array.isArray(policy?.allow) ? policy.allow.join(",") : "";
const deny = Array.isArray(policy?.deny) ? policy.deny.join(",") : "";
const enforced = contract?.capabilities?.mcpPolicyEnforced === true || policy !== undefined;

process.stdout.write(`OPENCRANE_ALLOWED_MCP_SERVERS=${allow}\n`);
process.stdout.write(`OPENCRANE_DENIED_MCP_SERVERS=${deny}\n`);
process.stdout.write(`OPENCRANE_MCP_POLICY_ENFORCED=${enforced ? "true" : "false"}\n`);
EOF
  ); then
    echo "[opencrane] Failed to parse managed runtime contract at $RUNTIME_CONTRACT_PATH; continuing without MCP policy enforcement" >&2
    return 0
  fi

  while IFS='=' read -r key value; do
    case "$key" in
      OPENCRANE_ALLOWED_MCP_SERVERS)
        OPENCRANE_ALLOWED_MCP_SERVERS="$value"
        ;;
      OPENCRANE_DENIED_MCP_SERVERS)
        OPENCRANE_DENIED_MCP_SERVERS="$value"
        ;;
      OPENCRANE_MCP_POLICY_ENFORCED)
        OPENCRANE_MCP_POLICY_ENFORCED="$value"
        ;;
    esac
  done <<< "$policy_env"
}

function _apply_workspace_docs()
{
  local contract_file="$1"

  if [ ! -f "$contract_file" ]; then
    return 0
  fi

  # Write the contract-derived TOOLS.md (L1 workspace doc) when the control plane
  # supplies one. Node writes the file directly (no shell capture) so the exact
  # bytes — including the trailing newline — survive, and exits non-zero when the
  # contract carries no doc so any existing TOOLS.md is left untouched.
  if node - "$contract_file" "$WORKSPACE_DIR/TOOLS.md" <<'EOF'
const fs = require("node:fs");
const [, , contractPath, outPath] = process.argv;
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const doc = contract?.workspace?.["TOOLS.md"];
if (typeof doc !== "string") { process.exit(3); }
fs.writeFileSync(outPath, doc);
EOF
  then
    echo "[opencrane] Applied contract-derived TOOLS.md to workspace" >&2
  fi

  # Apply version-gated tenant-editable L2 docs (managedDocs, P4C.5). Unlike
  # TOOLS.md, these (e.g. SOUL.md) are edited live in the pod, so a doc is written
  # ONLY when its contract version exceeds the last applied version recorded in a
  # per-doc marker file — delivering an approved company reconciliation once while
  # preserving the tenant's between-bump edits. Node owns the compare+write+marker
  # so the exact bytes and the gating stay atomic.
  node - "$contract_file" "$WORKSPACE_DIR" <<'EOF'
const fs = require("node:fs");
const path = require("node:path");
const [, , contractPath, workspaceDir] = process.argv;
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const docs = Array.isArray(contract?.managedDocs) ? contract.managedDocs : [];
const markerDir = path.join(workspaceDir, ".opencrane", "doc-versions");
for (const doc of docs) {
  // Only accept a safe single-segment filename to keep writes inside the workspace.
  if (!doc || typeof doc.file !== "string" || typeof doc.content !== "string") { continue; }
  if (doc.file.includes("/") || doc.file.includes("..")) { continue; }
  const version = Number.isInteger(doc.version) ? doc.version : 0;
  const markerPath = path.join(markerDir, `${doc.file}.version`);
  let applied = -1;
  try { applied = parseInt(fs.readFileSync(markerPath, "utf8"), 10); } catch { applied = -1; }
  if (Number.isNaN(applied)) { applied = -1; }
  // Skip when the tenant already has this version (or newer) — preserves live edits.
  if (version <= applied) { continue; }
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, doc.file), doc.content);
  fs.writeFileSync(markerPath, String(version));
  process.stderr.write(`[opencrane] Delivered managed doc ${doc.file} v${version} to workspace\n`);
}
EOF
}

function _pull_entitled_skills()
{
  local contract_file="$1"

  # Need a registry URL, a readable projected token, and a contract to do anything.
  # On a cold boot the bootstrap contract has skills.entitled=[], so this is a no-op
  # until the first opencrane-ui poll lands the live contract (mirrors TOOLS.md).
  if [ -z "$OPENCRANE_SKILL_REGISTRY_URL" ] || [ ! -f "$contract_file" ] || [ ! -r "$OPENCRANE_SKILL_REGISTRY_TOKEN_PATH" ]; then
    return 0
  fi

  # Node owns the fetch+write so JSON parsing, the Bearer call, and the exact bytes
  # stay in one place. Entitlement is already enforced by the registry + opencrane-ui
  # (a non-entitled digest 404s) — group-based entitlement is the sole skill-authorization surface.
  node - "$contract_file" "$OPENCRANE_SKILL_REGISTRY_URL" "$OPENCRANE_SKILL_REGISTRY_TOKEN_PATH" "$SKILLS_DIR" <<'EOF' || true
const fs = require("node:fs");
const path = require("node:path");

const [, , contractPath, registryUrl, tokenPath, skillsDir] = process.argv;

let contract;
try { contract = JSON.parse(fs.readFileSync(contractPath, "utf8")); } catch { process.exit(0); }

const entitled = Array.isArray(contract?.skills?.entitled) ? contract.skills.entitled : [];
if (entitled.length === 0) { process.exit(0); }

let token;
try { token = fs.readFileSync(tokenPath, "utf8").trim(); } catch { process.exit(0); }
if (!token) { process.exit(0); }

const base = registryUrl.replace(/\/+$/, "");

async function _pull()
{
  for (const skill of entitled)
  {
    // Tolerate both the enriched object shape {id,name,digest} and a legacy bare-id string.
    const name = typeof skill === "string" ? skill : skill?.name;
    const digest = typeof skill === "string" ? null : skill?.digest;
    if (!name || !digest) { continue; }
    // Keep the on-disk name a single safe path segment so a write can never escape the skills dir.
    if (name.includes("/") || name.includes("..")) { continue; }

    let res;
    try
    {
      res = await fetch(`${base}/bundles/${encodeURIComponent(digest)}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    }
    catch (err)
    {
      process.stderr.write(`[opencrane] skill '${name}' fetch failed: ${err && err.message ? err.message : "error"}\n`);
      continue;
    }

    if (!res.ok)
    {
      // 404 = not entitled / not found (existence-hiding at the registry); other codes are transient.
      process.stderr.write(`[opencrane] skill '${name}' not delivered (status ${res.status})\n`);
      continue;
    }

    const body = await res.text();
    try
    {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), body);
    }
    catch (err)
    {
      // A write failure (permissions, disk full) must surface and must not abort the
      // remaining entitled skills — log and move on to the next bundle.
      process.stderr.write(`[opencrane] skill '${name}' write failed: ${err && err.message ? err.message : "error"}\n`);
      continue;
    }
    process.stderr.write(`[opencrane] Delivered skill '${name}' (${digest}) to workspace\n`);
  }
}

_pull().catch(() => process.exit(0));
EOF
}

# Fingerprint the CONTRACT fields whose change a hot-reload actually propagates to the
# running agent: the workspace docs (consumed by _apply_workspace_docs) and the entitled
# skills (consumed by _pull_entitled_skills). openclaw.json's mcp.servers are static —
# rendered once at boot — so a contract delta touching neither docs nor skills would
# re-spawn the stdio MCP servers for nothing, and every needless re-spawn is a fresh
# chance to hit `MCP error -32000: Connection closed`. The poll loop reloads only when
# this fingerprint changes. Emits a sha256 hex digest (or a sentinel that forces a reload
# when the contract is missing/unparseable, so we fail safe towards reloading).
function _reload_fingerprint()
{
  local contract_file="$1"

  if [ ! -f "$contract_file" ]; then
    echo "NO_CONTRACT"
    return 0
  fi

  node - "$contract_file" <<'EOF'
const fs = require("node:fs");
const crypto = require("node:crypto");
try {
  const c = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const relevant = {
    workspace: c && c.workspace !== undefined ? c.workspace : null,
    managedDocs: c && Array.isArray(c.managedDocs) ? c.managedDocs : [],
    skills: c && c.skills && Array.isArray(c.skills.entitled) ? c.skills.entitled : [],
  };
  process.stdout.write(crypto.createHash("sha256").update(JSON.stringify(relevant)).digest("hex"));
} catch {
  process.stdout.write("PARSE_ERROR");
}
EOF
}

# Trigger OpenClaw's hot-reload of mcp.*/agents/models/tools.
#
# OpenClaw reloads by WATCHING its config file (openclaw.json); SIGHUP is NOT a
# documented reload trigger, so the previous `kill -HUP` was a no-op. We atomically
# rewrite the config in place (same bytes, new mtime) so the file-watcher fires.
# Atomic via tmp+rename so the watcher never observes a partial/empty file.
function _trigger_openclaw_reload()
{
  local config_file="$STATE_DIR/openclaw.json"

  if [ ! -f "$config_file" ]; then
    return 0
  fi

  local tmp_path="${config_file}.reload.tmp"
  if cp "$config_file" "$tmp_path" 2>/dev/null && mv "$tmp_path" "$config_file" 2>/dev/null; then
    echo "[opencrane] Rewrote openclaw.json in place to trigger config hot-reload" >&2
  else
    rm -f "$tmp_path" 2>/dev/null || true
    echo "[opencrane] Failed to rewrite openclaw.json; reload not triggered" >&2
  fi
}

function _contract_poll_loop()
{
  local tenant_name="$1"
  local control_plane_url="$2"
  local token_path="$3"
  local writable_path="$4"
  local interval="$5"

  while true; do
    sleep "$interval"

    # Skip poll if token file is not readable yet (projected tokens populate asynchronously).
    if [ ! -r "$token_path" ]; then
      continue
    fi

    local token
    token=$(cat "$token_path" 2>/dev/null) || continue

    local url="${control_plane_url}/api/internal/contract/${tenant_name}"
    local tmp_path="${writable_path}.tmp"

    if curl -sf -m 10 \
        -H "Authorization: Bearer ${token}" \
        -H "Accept: application/json" \
        -o "$tmp_path" \
        "$url"; then
      # Compare checksums — only update and reload if the contract actually changed.
      local new_sum old_sum
      new_sum=$(sha256sum "$tmp_path" 2>/dev/null | cut -d' ' -f1)
      old_sum=$(sha256sum "$writable_path" 2>/dev/null | cut -d' ' -f1)

      if [ "$new_sum" != "$old_sum" ]; then
        # Fingerprint the reload-relevant fields BEFORE overwriting the old contract, so a
        # docs/skills change (which a reload must propagate) is distinguishable from a bare
        # metadata/model-catalog delta (which must NOT churn the stdio MCP servers).
        # Distinct sentinels on failure so a fingerprint error never aborts the poll loop
        # (set -e) and always falls through to a reload (fail safe).
        local new_fp old_fp
        old_fp=$(_reload_fingerprint "$writable_path") || old_fp="FP_ERR_OLD"
        new_fp=$(_reload_fingerprint "$tmp_path") || new_fp="FP_ERR_NEW"

        mv "$tmp_path" "$writable_path"
        echo "[opencrane] Contract updated (sha256: ${new_sum})" >&2

        # Re-render contract-derived workspace docs (TOOLS.md) and pull newly-entitled skill
        # bundles. Both are idempotent, so running them on every contract change is cheap and
        # keeps the on-disk files current. Additive: a de-entitled skill stops being advertised
        # in TOOLS.md and 404s at the registry, but its on-disk copy is left in place (pruning
        # de-entitled skills is a separate follow-up).
        _apply_workspace_docs "$writable_path"
        _pull_entitled_skills "$writable_path"

        # Only trigger the file-watch reload when a reload would actually change what the
        # agent sees. A no-op openclaw.json rewrite still makes OpenClaw re-read its config and
        # re-init plugins for nothing, so skip it when workspace docs + skills are unchanged.
        if [ "$new_fp" != "$old_fp" ]; then
          echo "[opencrane] Reload-relevant fields (workspace docs/skills) changed; triggering hot-reload" >&2
          _trigger_openclaw_reload
        else
          echo "[opencrane] Contract change is not reload-relevant; skipping reload" >&2
        fi
      else
        rm -f "$tmp_path"
      fi
    else
      rm -f "$tmp_path"
    fi
  done
}

# Warn loudly when a mandatory platform backend is missing. These are settled platform
# decisions (org memory = Cognee, model routing = LiteLLM), so their absence is a
# misconfiguration, not a supported mode. Warn rather than hard-exit so a partially-provisioned
# pod can still boot for diagnosis, but make the gap impossible to miss in the logs.
function _preflight_platform_deps()
{
  if [ "$OPENCRANE_MEMORY_BACKEND" != "cognee" ] || [ -z "$COGNEE_ENDPOINT" ]; then
    echo "[opencrane] WARNING: org memory is not wired — expected OPENCRANE_MEMORY_BACKEND=cognee and COGNEE_ENDPOINT set (got backend='${OPENCRANE_MEMORY_BACKEND:-unset}', endpoint='${COGNEE_ENDPOINT:-unset}'). Cognee is the platform memory engine; the agent will have no org memory until this is fixed." >&2
  else
    echo "[opencrane] Org memory backend: Cognee at ${COGNEE_ENDPOINT}" >&2
  fi

  if [ -z "$LITELLM_ENDPOINT" ]; then
    echo "[opencrane] WARNING: model routing is not wired — LITELLM_ENDPOINT is unset. LiteLLM is the platform model proxy; model calls will fail until this is fixed." >&2
  else
    echo "[opencrane] Model routing: LiteLLM proxy at ${LITELLM_ENDPOINT}" >&2
  fi
}

function _main()
{
  _preflight_platform_deps
  _load_mcp_policy

  # Ensure GCS-backed directory structure
  mkdir -p "$STATE_DIR/agents/main/agent" "$SKILLS_DIR" \
           "$STATE_DIR/sessions" "$STATE_DIR/uploads" "$STATE_DIR/knowledge" \
           "$WORKSPACE_DIR"

  # Ensure pod-local secrets dir (emptyDir, Memory-backed)
  mkdir -p "$SECRETS_DIR"

  # Ensure temporary writable paths exist when the root filesystem is read-only.
  mkdir -p /tmp/opencrane-home /tmp/npm-cache

  # Always apply the operator-managed config on boot — the configmap is the
  # authoritative source for platform settings (auth, port, bind, MCP servers).
  # The mounted file is the fully platform-rendered config.
  # Skipping this copy was the original design intent (to "preserve customisations")
  # but it caused operator config updates (e.g. auth-mode changes) to be silently
  # ignored on pod restart when the state-volume file already existed.
  if [ -f "$CONFIG_SOURCE" ]; then
    cp -f "$CONFIG_SOURCE" "$STATE_DIR/openclaw.json"
    echo "[opencrane] Applied operator config from configmap"
  fi

  # L0 workspace files — platform-managed, re-stamped on every boot so operator edits
  # are always applied.  Tenant edits to these files are intentionally reverted.
  for _l0_file in AGENTS.md TOOLS.md; do
    if [ -f "/config/${_l0_file}" ]; then
      cp -f "/config/${_l0_file}" "$WORKSPACE_DIR/${_l0_file}"
    fi
  done
  echo "[opencrane] Workspace L0 files applied (AGENTS.md, TOOLS.md)"

  # L2 workspace files — seeded from *.seed templates only when the target file does
  # not yet exist.  Once present, they are tenant-owned and preserved across restarts.
  for _seed_file in SOUL.md IDENTITY.md USER.md; do
    if [ ! -f "$WORKSPACE_DIR/${_seed_file}" ] && [ -f "/config/${_seed_file}.seed" ]; then
      cp "/config/${_seed_file}.seed" "$WORKSPACE_DIR/${_seed_file}"
      echo "[opencrane] Seeded workspace file: ${_seed_file}"
    fi
  done

  # Copy the initial contract to the writable path so the polling loop can update it.
  if [ -f "$RUNTIME_CONTRACT_PATH" ] && [ ! -f "$RUNTIME_CONTRACT_WRITABLE" ]; then
    cp "$RUNTIME_CONTRACT_PATH" "$RUNTIME_CONTRACT_WRITABLE"
  fi

  # Apply contract-derived workspace docs at boot, AFTER L0 stamping above. The
  # operator-mounted bootstrap contract carries no workspace docs today, so this is
  # a no-op on a cold start and the static L0 TOOLS.md stands; the opencrane-ui
  # contract (which DOES include workspace docs) lands on the first poll below,
  # refreshing TOOLS.md within one poll interval. The call is kept so a future
  # contract that embeds workspace docs is applied immediately. Prefer the writable
  # copy; fall back to the ConfigMap-mounted original.
  if [ -f "$RUNTIME_CONTRACT_WRITABLE" ]; then
    _apply_workspace_docs "$RUNTIME_CONTRACT_WRITABLE"
    _pull_entitled_skills "$RUNTIME_CONTRACT_WRITABLE"
  else
    _apply_workspace_docs "$RUNTIME_CONTRACT_PATH"
    _pull_entitled_skills "$RUNTIME_CONTRACT_PATH"
  fi

  echo "[opencrane] Starting OpenClaw gateway"

  # Start OpenClaw as a background process (not exec) so the polling loop can run
  # alongside it and trigger a config-file reload when the contract changes.
  openclaw gateway run --bind lan --port "${OPENCLAW_GATEWAY_PORT:-18789}" &
  OPENCLAW_PID=$!

  # Start the background contract re-pull loop when the opencrane-ui URL is set.
  if [ -n "$OPENCRANE_CONTROL_PLANE_URL" ] && [ -n "$OPENCLAW_TENANT_NAME" ]; then
    _contract_poll_loop \
      "$OPENCLAW_TENANT_NAME" \
      "$OPENCRANE_CONTROL_PLANE_URL" \
      "$OPENCRANE_CONTRACT_TOKEN_PATH" \
      "$RUNTIME_CONTRACT_WRITABLE" \
      "$CONTRACT_POLL_INTERVAL" &
    echo "[opencrane] Contract re-pull loop started (interval: ${CONTRACT_POLL_INTERVAL}s)"
  fi

  # Wait for OpenClaw to exit and propagate its exit code.
  wait $OPENCLAW_PID
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  _main "$@"
fi
