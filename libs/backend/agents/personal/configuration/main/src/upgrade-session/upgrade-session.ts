import { AgentConfigPatchKinds, CompiledToolDefinitionKinds, FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS, FirstPartyToolCapabilities, type CompiledFirstPartyToolDefinition, type RunInputSnapshot } from "@opencrane/contracts";
import { ___DigestCanonicalJson } from "@opencrane/util";

/** Frozen built-in semantics for an upgrade-session proposal. */
const _UPGRADE_SESSION_CAPABILITY = FIRST_PARTY_TOOL_CAPABILITY_CONTRACTS[FirstPartyToolCapabilities.UpgradeSession];

/**
 * JSON schema for the `upgrade_session` capability's arguments.
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
 * The built-in `upgrade_session` declaration for proposing a configuration change.
 *
 * A model selection may only save a proposal. The declaration's materialization rule requires a
 * later human review before any configuration change can become active. This descriptor is not
 * offered by production composition until admission persists first-party capability selection.
 */
export const UPGRADE_SESSION_TOOL: CompiledFirstPartyToolDefinition = {
	kind: CompiledToolDefinitionKinds.FirstParty,
	name: _UPGRADE_SESSION_CAPABILITY.name,
	modelName: _UPGRADE_SESSION_CAPABILITY.modelName,
	capability: FirstPartyToolCapabilities.UpgradeSession,
	capabilityRevision: _UPGRADE_SESSION_CAPABILITY.capabilityRevision,
	effect: _UPGRADE_SESSION_CAPABILITY.effect,
	materialization: _UPGRADE_SESSION_CAPABILITY.materialization,
	description: "Propose a personal-agent configuration change for a future session after the user reviews it.",
	parametersSchema: _UPGRADE_SESSION_PARAMETERS_SCHEMA,
	parametersSchemaDigest: ___DigestCanonicalJson(_UPGRADE_SESSION_PARAMETERS_SCHEMA),
};

/**
 * Returns whether a future admission owner has the immutable coordinates needed for this capability.
 *
 * Requires both a persona revision and a conversation: a proposal must name the persona whose
 * revision it freezes, and the conversation it came from, and neither can be invented later.
 *
 * @param snapshot - The run's immutable input snapshot.
 * @returns True when a persisted capability choice could bind both persona and conversation.
 * This check grants no permission and does not add the declaration to compiled input.
 */
export function __IsUpgradeSessionAvailable(snapshot: RunInputSnapshot): boolean
{
	return snapshot.personaRevisionId !== null && snapshot.conversationId !== null;
}
