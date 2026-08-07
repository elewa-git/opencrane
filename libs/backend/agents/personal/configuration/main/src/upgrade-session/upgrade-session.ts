import { AgentConfigPatchKinds, type CompiledToolDefinition, type RunInputSnapshot } from "@opencrane/contracts";

/** Stable first-party revision, deliberately outside the MCP grant namespace. */
export const UPGRADE_SESSION_TOOL_REVISION = "opencrane:personal:upgrade_session:v1";

/** Always-callable tool that proposes, but never applies, a later personal configuration change. */
export const UPGRADE_SESSION_TOOL: CompiledToolDefinition = {
	name: "upgrade_session",
	toolRevisionId: UPGRADE_SESSION_TOOL_REVISION,
	description: "Propose a personal-agent configuration change for a future session after the user reviews it.",
	requiresApproval: false,
	parametersSchema: { oneOf: [{ type: "object", properties: { kind: { const: AgentConfigPatchKinds.PersonaRefresh } }, required: ["kind"], additionalProperties: false }, { type: "object", properties: { kind: { const: AgentConfigPatchKinds.ModelAlias }, modelAlias: { type: "string", minLength: 1, maxLength: 200, pattern: "\\S" } }, required: ["kind", "modelAlias"], additionalProperties: false }] },
};

/** Return whether an immutable snapshot is eligible for the built-in personal configuration tool. */
export function __IsUpgradeSessionAvailable(snapshot: RunInputSnapshot): boolean
{
	return snapshot.personaRevisionId !== null && snapshot.threadId !== null;
}
