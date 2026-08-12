import { AgentConfigPatchKinds, type CompiledToolDefinition, type RunInputSnapshot } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

/** Stable first-party revision, deliberately outside the MCP grant namespace. */
export const UPGRADE_SESSION_TOOL_REVISION = "opencrane:personal:upgrade_session:v1";

/**
 * JSON schema for the `upgrade_session` tool's arguments, tied to the revision id above.
 *
 * Accepts exactly the two supported patch shapes and nothing else, so an agent cannot smuggle
 * extra fields into a proposal. Its digest is published with the tool as
 * `parametersSchemaDigest`, which is how a runtime detects that the accepted argument shape
 * changed.
 *
 * @see https://www.rfc-editor.org/rfc/rfc8785 — RFC 8785 (JSON Canonicalization Scheme), used
 * to digest this schema so the same schema always yields the same digest.
 */
const _UPGRADE_SESSION_PARAMETERS_SCHEMA = { oneOf: [{ type: "object", properties: { kind: { const: AgentConfigPatchKinds.PersonaRefresh } }, required: ["kind"], additionalProperties: false }, { type: "object", properties: { kind: { const: AgentConfigPatchKinds.ModelAlias }, modelAlias: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" } }, required: ["kind", "modelAlias"], additionalProperties: false }] } as const;

/**
 * The built-in `upgrade_session` tool an agent uses to propose a configuration change.
 *
 * Needs no approval because calling it applies nothing: it records a request the user reviews
 * later. `requiresApproval: false` is safe only for as long as that stays true.
 *
 * Used by: `production-runtime-dispatch.ts` in libs/backend/agents/execution/protocol, which
 * appends it to a run's compiled tools when {@link __IsUpgradeSessionAvailable} allows.
 */
export const UPGRADE_SESSION_TOOL: CompiledToolDefinition = {
	name: "upgrade_session",
	toolRevisionId: UPGRADE_SESSION_TOOL_REVISION,
	description: "Propose a personal-agent configuration change for a future session after the user reviews it.",
	requiresApproval: false,
	parametersSchema: _UPGRADE_SESSION_PARAMETERS_SCHEMA,
	parametersSchemaDigest: ___DigestCanonicalJson(_UPGRADE_SESSION_PARAMETERS_SCHEMA),
};

/**
 * Returns whether a run may be offered the `upgrade_session` tool.
 *
 * Requires both a persona revision and a conversation: a proposal must name the persona whose
 * revision it freezes, and the conversation it came from, and neither can be invented later.
 *
 * Called by: `production-runtime-dispatch.ts` in libs/backend/agents/execution/protocol.
 *
 * @param snapshot - The run's immutable input snapshot.
 * @returns True when the tool may be offered; false leaves the run's tools unchanged.
 */
export function __IsUpgradeSessionAvailable(snapshot: RunInputSnapshot): boolean
{
	return snapshot.personaRevisionId !== null && snapshot.conversationId !== null;
}
