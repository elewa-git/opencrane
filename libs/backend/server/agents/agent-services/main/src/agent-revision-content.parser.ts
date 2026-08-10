import { PROMPT_COMPILER_VERSION } from "@opencrane/contracts";
import { __AreReviewedIntegrationToolDefinitionsValid, type AgentRevisionContent, type ReviewedIntegrationToolDefinition } from "@opencrane/models/agents";
import { ___CloneCanonicalJson, type CanonicalJsonSha256Digest, type JsonValue } from "@opencrane/util";

/** Returns whether a value is a non-empty string. */
function _isNonEmptyString(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0;
}

/** Returns whether a string is safe as one segment of the runtime integration tool revision. */
function _isToolRevisionSegment(value: unknown): value is string
{
	return _isNonEmptyString(value) && !value.includes(":");
}

/** Parses the optional skill-reference array. */
function _parseSkills(raw: unknown): AgentRevisionContent["skills"] | null
{
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) return null;
	const skills = raw.map(function _skill(entry) { const item = entry as Record<string, unknown>; return _isNonEmptyString(item?.skillId) && _isNonEmptyString(item?.revisionId) ? { skillId: item.skillId, revisionId: item.revisionId } : null; });
	return skills.some(skill => skill === null) ? null : (skills as AgentRevisionContent["skills"]);
}

/** Parses reviewed, schema-bound tool definitions from the organisation-admin revision payload. */
function _parseToolDefinitions(raw: unknown): readonly ReviewedIntegrationToolDefinition[] | null
{
	if (!Array.isArray(raw)) return null;
	try
	{
		const definitions = raw.map(function _definition(entry): ReviewedIntegrationToolDefinition | null
		{
			const item = entry as Record<string, unknown>;
			if (!_isToolRevisionSegment(item?.name) || !_isNonEmptyString(item?.description) || !_isNonEmptyString(item?.parametersSchemaDigest)) return null;
			return { name: item.name, description: item.description, parametersSchema: ___CloneCanonicalJson(item.parametersSchema as JsonValue), parametersSchemaDigest: item.parametersSchemaDigest as CanonicalJsonSha256Digest };
		});
		if (definitions.some(function _Missing(definition): boolean { return definition === null; })) return null;
		const reviewed = definitions as readonly ReviewedIntegrationToolDefinition[];
		return __AreReviewedIntegrationToolDefinitionsValid(reviewed) ? reviewed : null;
	}
	catch
	{
		return null;
	}
}

/** Parses the optional integration-assignment array. */
function _parseIntegrations(raw: unknown): AgentRevisionContent["integrationAssignments"] | null
{
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) return null;
	const assignments = raw.map(function _assignment(entry)
	{
		const item = entry as Record<string, unknown>;
		if (!_isToolRevisionSegment(item?.integrationId) || !_isNonEmptyString(item?.custodyReferenceId)) return null;
		const toolDefinitions = _parseToolDefinitions(item.toolDefinitions);
		if (toolDefinitions === null) return null;
		return { integrationId: item.integrationId, custodyReferenceId: item.custodyReferenceId, toolDefinitions };
	});
	return assignments.some(assignment => assignment === null) ? null : (assignments as AgentRevisionContent["integrationAssignments"]);
}

/** Parses the optional revision-scoped scope-attachment array against the canonical vocabulary. */
function _parseScopeAttachments(raw: unknown): AgentRevisionContent["scopeAttachments"] | null
{
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) return null;
	const scopes = new Set(["org", "department", "team", "project", "personal"]);
	const subjectTypes = new Set(["group", "tenant", "user"]);
	const attachments = raw.map(function _attachment(entry)
	{
		const item = entry as Record<string, unknown>;
		if (typeof item?.scope !== "string" || !scopes.has(item.scope) || typeof item?.subjectType !== "string" || !subjectTypes.has(item.subjectType) || !_isNonEmptyString(item?.subjectId)) return null;
		return { scope: item.scope as AgentRevisionContent["scopeAttachments"][number]["scope"], subjectType: item.subjectType as AgentRevisionContent["scopeAttachments"][number]["subjectType"], subjectId: item.subjectId };
	});
	return attachments.some(attachment => attachment === null) ? null : (attachments as AgentRevisionContent["scopeAttachments"]);
}

/** Parses and validates immutable executable content from the reviewed administrator payload. */
export function _ParseAgentRevisionContent(raw: unknown): AgentRevisionContent | null
{
	// 1. Bound the top-level JSON object before inspecting any executable field.
	if (raw === null || typeof raw !== "object") return null;
	const body = raw as Record<string, unknown>;
	const budget = body.budget as Record<string, unknown> | undefined;

	// 2. Require the deployed compiler pin and complete primitive revision coordinates.
	if (body.promptPolicyVersion !== PROMPT_COMPILER_VERSION || !_isNonEmptyString(body.modelDefinitionId) || budget === undefined || typeof budget !== "object") return null;
	if (typeof budget.maxTurns !== "number" || typeof budget.maxTokens !== "number" || typeof budget.maxDurationMs !== "number") return null;
	const personaRevisionId = body.personaRevisionId === undefined || body.personaRevisionId === null ? null : body.personaRevisionId;
	if (personaRevisionId !== null && !_isNonEmptyString(personaRevisionId)) return null;

	// 3. Parse every nested authority with no fallback for malformed assignments or schemas.
	const skills = _parseSkills(body.skills);
	const integrationAssignments = _parseIntegrations(body.integrationAssignments);
	const scopeAttachments = _parseScopeAttachments(body.scopeAttachments);
	if (skills === null || integrationAssignments === null || scopeAttachments === null) return null;

	// 4. Return only the canonical domain shape consumed by revision validation and persistence.
	return { promptPolicyVersion: body.promptPolicyVersion, personaRevisionId, modelDefinitionId: body.modelDefinitionId, budget: { maxTurns: budget.maxTurns, maxTokens: budget.maxTokens, maxDurationMs: budget.maxDurationMs }, skills, integrationAssignments, scopeAttachments };
}
