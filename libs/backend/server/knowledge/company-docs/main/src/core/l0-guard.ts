import type { L0DirectivePattern } from "./l0-guard.types.js";

/**
 * Forbidden L0 system-mechanic directives.
 *
 * L1 company docs and L2 tenant docs personalise voice/identity only; the
 * platform mechanics (managed mode, Obot MCP gateway routing, per-entitlement
 * skill pulls, the effective-contract loop, workspace pinning) live exclusively
 * in the OpenCrane-owned, boot-restamped L0 files (`AGENTS.md`/`TOOLS.md`).
 * Letting company/tenant prose redefine these would be a (futile, since L0 is
 * re-stamped and the IAM planes are the real boundary) attempt to change core
 * behaviour — so the publish path and the reconciler reject content asserting them.
 */
const _L0_DIRECTIVE_PATTERNS: L0DirectivePattern[] = [
  { label: "managed-mode", pattern: /\bmanaged\s+mode\b/i },
  { label: "obot-gateway", pattern: /\bobot\b/i },
  { label: "mcp-gateway-routing", pattern: /\bmcp\s+(?:gateway|server|route|routing)\b/i },
  { label: "feat-skill-registry", pattern: /\bskill[-\s]?registry\b/i },
  { label: "effective-contract", pattern: /\beffective[-\s]?contract\b/i },
  { label: "skip-bootstrap", pattern: /\bskipBootstrap\b/i },
  { label: "opencrane-env", pattern: /\bOPENCRANE_[A-Z_]+\b/i },
  { label: "workspace-path", pattern: /\/data\/openclaw\b/i },
  { label: "platform-l0-file", pattern: /\b(?:AGENTS|TOOLS)\.md\b/ },
];

/**
 * Find every L0 system-mechanic directive a document tries to assert.
 *
 * @param content - The candidate document content.
 * @returns The labels of all matched forbidden directives (empty when clean).
 */
export function _FindL0Directives(content: string): string[]
{
  return _L0_DIRECTIVE_PATTERNS
    .filter(function _matches(entry) { return entry.pattern.test(content); })
    .map(function _label(entry) { return entry.label; });
}

/**
 * Assert that a document carries no L0 system-mechanic directives.
 *
 * Used by the company-doc publish path (P4C.3) and as the reconciler sandbox
 * guard (P4C.4) so an agent-proposed merge can never smuggle L0 directives into
 * L1/L2.
 *
 * @param content - The candidate document content.
 * @throws Error listing the matched directives when the content is not clean.
 */
export function _AssertNoL0Directives(content: string): void
{
  const matched = _FindL0Directives(content);
  if (matched.length > 0)
  {
    throw new Error(`document carries forbidden L0 system-mechanic directives: ${matched.join(", ")}`);
  }
}
