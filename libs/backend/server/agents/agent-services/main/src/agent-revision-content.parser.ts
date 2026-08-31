import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentRevisionContent } from "@opencrane/models/agents";

/** Returns whether a value is a non-empty string. */
function _isNonEmptyString(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/** Parses the optional skill-reference array. */
function _parseSkills(raw: unknown): AgentRevisionContent["skills"] | null
{
	if (raw === undefined)
	{
		return [];
	}
	if (!Array.isArray(raw))
	{
		return null;
	}
	const skills = raw.map(function _skill(entry) { const item = entry as Record<string, unknown>; return _isNonEmptyString(item?.skillId) && _isNonEmptyString(item?.revisionId) ? { skillId: item.skillId, revisionId: item.revisionId } : null; });
	return skills.some(skill => skill === null) ? null : (skills as AgentRevisionContent["skills"]);
}

/** Parses the MCP tool revision identifiers selected in the administrator payload. */
function _parseMcpToolRevisionIds(raw: unknown): AgentRevisionContent["mcpToolRevisionIds"] | null
{
	if (raw === undefined)
	{
		return [];
	}
	if (!Array.isArray(raw))
	{
		return null;
	}
	const revisionIds = raw.map(function _RevisionId(value): string | null { return _isNonEmptyString(value) ? value : null; });
	return revisionIds.some(function _Missing(value): boolean { return value === null; }) ? null : revisionIds as string[];
}

/** Parses optional boundary attachments and rejects impossible personal descendant coverage. */
function _parseBoundaryAttachments(raw: unknown): AgentRevisionContent["boundaryAttachments"] | null
{
	if (raw === undefined)
	{
		return [];
	}
	if (!Array.isArray(raw))
	{
		return null;
	}
	const attachments = raw.map(function _attachment(entry)
	{
		const item = entry as Record<string, unknown>;
		if (!_isNonEmptyString(item?.boundaryId))
		{
			return null;
		}
		if (item.boundaryKind === RevisionBoundaryKinds.Personal && item.boundaryCoverage === RevisionBoundaryCoverages.Exact)
		{
			return { boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: item.boundaryId, boundaryCoverage: RevisionBoundaryCoverages.Exact };
		}
		if (item.boundaryKind === RevisionBoundaryKinds.Group && (item.boundaryCoverage === RevisionBoundaryCoverages.Exact || item.boundaryCoverage === RevisionBoundaryCoverages.Descendants))
		{
			return { boundaryKind: RevisionBoundaryKinds.Group, boundaryId: item.boundaryId, boundaryCoverage: item.boundaryCoverage };
		}
		return null;
	});
	return attachments.some(attachment => attachment === null) ? null : (attachments as AgentRevisionContent["boundaryAttachments"]);
}

/**
 * Turns an untrusted request body into agent revision content, or returns null.
 *
 * This is the only door between JSON off the wire and anything the runtime will execute, so it
 * accepts nothing it cannot fully check and never fills in a default for a malformed field. It
 * rejects a body whose `promptPolicyVersion` is not the compiler version this build ships, so a
 * revision authored against a different prompt compiler cannot be stored and later mis-compiled.
 *
 * Called by: the create and revise handlers in `agent-revision.router.ts`, both of which answer 400
 * `VALIDATION_ERROR` on null.
 *
 * @param raw - `req.body.content`, entirely untrusted.
 * @returns Content safe to hand to {@link __CreateManagedAgentService} / {@link __ReviseAgentRevision},
 *   or null when anything is missing, malformed, or of the wrong type. Null carries no detail on
 *   purpose — the response must not tell a caller which internal check tripped.
 */
export function _ParseAgentRevisionContent(raw: unknown): AgentRevisionContent | null
{
	// 1. Bound the top-level JSON object before inspecting any executable field.
	if (raw === null || typeof raw !== "object")
	{
		return null;
	}
	const body = raw as Record<string, unknown>;
	const budget = body.budget as Record<string, unknown> | undefined;

	// 2. Require the prompt-compiler version this build ships, plus a model id and all four budget numbers.
	if (body.promptPolicyVersion !== PROMPT_COMPILER_VERSION || !_isNonEmptyString(body.modelDefinitionId) || budget === undefined || typeof budget !== "object")
	{
		return null;
	}
	if (typeof budget.maxTurns !== "number" || typeof budget.maxTokens !== "number" || typeof budget.maxCostUsdMicros !== "number" || typeof budget.maxDurationMs !== "number")
	{
		return null;
	}
	const personaRevisionId = body.personaRevisionId === undefined || body.personaRevisionId === null ? null : body.personaRevisionId;
	if (personaRevisionId !== null && !_isNonEmptyString(personaRevisionId))
	{
		return null;
	}

	// 3. Parse the nested arrays. One malformed entry rejects the whole body — never a partial list.
	const skills = _parseSkills(body.skills);
	const mcpToolRevisionIds = _parseMcpToolRevisionIds(body.mcpToolRevisionIds);
	const boundaryAttachments = _parseBoundaryAttachments(body.boundaryAttachments);
	if (skills === null || mcpToolRevisionIds === null || boundaryAttachments === null)
	{
		return null;
	}

	// 4. Rebuild the value field by field, so nothing extra from the request body is carried through.
	return { promptPolicyVersion: body.promptPolicyVersion, personaRevisionId, modelDefinitionId: body.modelDefinitionId, budget: { maxTurns: budget.maxTurns, maxTokens: budget.maxTokens, maxCostUsdMicros: budget.maxCostUsdMicros, maxDurationMs: budget.maxDurationMs }, skills, mcpToolRevisionIds, boundaryAttachments };
}
