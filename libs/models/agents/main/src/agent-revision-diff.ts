import type { AgentRevision } from "./agent-revision.types";
import type { AgentRevisionDiff, RevisionLineDiff, RevisionScalarChange, RevisionSetChange, RevisionWidening } from "./agent-revision-diff.types";

/** Computes a multiset-aware line-level diff for one readable text field. */
function _lineDiff(field: string, before: string, after: string): RevisionLineDiff | null
{
	if (before === after)
	{
		return null;
	}
	const baseLines = before.split("\n");
	const targetLines = after.split("\n");
	const baseCounts = _countLines(baseLines);
	const targetCounts = _countLines(targetLines);
	const removedLines = baseLines.filter(function _removed(line) { return _consume(targetCounts, line) === false; });
	const addedLines = targetLines.filter(function _added(line) { return _consume(baseCounts, line) === false; });
	return { field, addedLines, removedLines };
}

/** Builds a mutable multiset of line occurrences. */
function _countLines(lines: readonly string[]): Map<string, number>
{
	const counts = new Map<string, number>();
	for (const line of lines)
	{
		counts.set(line, (counts.get(line) ?? 0) + 1);
	}
	return counts;
}

/** Remove one occurrence of a line from the count, returning false when the other side had none left. */
function _consume(counts: Map<string, number>, line: string): boolean
{
	const remaining = counts.get(line) ?? 0;
	if (remaining <= 0)
	{
		return false;
	}
	counts.set(line, remaining - 1);
	return true;
}

/** Emits a scalar change entry only when the rendered values differ. */
function _scalarChange(field: string, before: string | null, after: string | null): RevisionScalarChange | null
{
	return before === after ? null : { field, before, after };
}

/** Computes the added and removed member keys between two stable key sets. */
function _setChange(field: string, baseKeys: readonly string[], targetKeys: readonly string[]): RevisionSetChange | null
{
	const base = new Set(baseKeys);
	const target = new Set(targetKeys);
	const added = [...target].filter(function _isAdded(key) { return !base.has(key); }).sort();
	const removed = [...base].filter(function _isRemoved(key) { return !target.has(key); }).sort();
	return added.length === 0 && removed.length === 0 ? null : { field, added, removed };
}

/** Renders skill assignments as stable `skillId@revisionId` member keys. */
function _skillKeys(revision: AgentRevision): string[]
{
	return revision.skills.map(function _key(skill) { return `${skill.skillId}@${skill.revisionId}`; });
}

/** Renders integration tool grants as stable schema-bound member keys. */
function _integrationToolKeys(revision: AgentRevision): string[]
{
	return revision.integrationAssignments.flatMap(function _tools(assignment)
	{
		return assignment.toolDefinitions.map(function _key(tool) { return `${assignment.integrationId}:${tool.name}@${tool.parametersSchemaDigest}`; });
	});
}

/** Renders integration custody bindings as stable `integrationId=custodyReferenceId` member keys. */
function _integrationCustodyKeys(revision: AgentRevision): string[]
{
	return revision.integrationAssignments.map(function _key(assignment) { return `${assignment.integrationId}=${assignment.custodyReferenceId}`; });
}

/** Renders exact MCP tool revisions as stable capability keys. */
function _mcpToolRevisionKeys(revision: AgentRevision): string[]
{
	return [...revision.mcpToolRevisionIds];
}

/** Renders boundary attachments as stable kind, identifier, and coverage keys. */
function _boundaryAttachmentKeys(revision: AgentRevision): string[]
{
	return revision.boundaryAttachments.map(function _Key(attachment) { return `${attachment.boundaryKind}:${attachment.boundaryId}:${attachment.boundaryCoverage}`; });
}

/** Report a widening when the target raises this budget ceiling; a lowered or equal ceiling is not reported. */
function _budgetWidening(field: string, before: number, after: number): RevisionWidening | null
{
	return after > before ? { kind: "budget", field, detail: `${field} raised from ${before} to ${after}` } : null;
}

/**
 * Compare two agent revisions so a reviewer can see what a publication would change.
 *
 * Text fields are diffed line by line. Structured configuration is diffed field by field rather
 * than as one blob of JSON, so a reviewer sees which setting moved instead of a wall of text.
 *
 * The important output is `widenings`: any change that gives the agent MORE than before — a
 * broader scope, an extra tool, a new credential binding, or a raised budget. A publication flow
 * must show these and get confirmation; a narrowing change is not flagged. An empty `widenings`
 * therefore means the target grants no new power, not that nothing changed.
 *
 * Pure calculation: no I/O, and it reads only the references a revision stores, never a secret
 * value.
 *
 * Called by: `libs/backend/server/agents/agent-services/main/src/agent-revision-lifecycle.ts`.
 * @param base - Earlier revision to compare from.
 * @param target - Later revision to compare to.
 * @returns Line, field, collection, and widening changes. Empty `widenings` means no new power was granted.
 * @see {@link RevisionWidening}
 */
export function __DiffAgentRevisions(base: AgentRevision, target: AgentRevision): AgentRevisionDiff
{
	// 1. Diff the readable prompt/instructions reference line by line.
	const lineDiffs = [_lineDiff("promptPolicyVersion", base.promptPolicyVersion, target.promptPolicyVersion)].filter(_isPresent);

	// 2. Diff single-value configuration fields one at a time, not as one blob of JSON.
	const scalarChanges = [
		_scalarChange("personaRevisionId", base.personaRevisionId, target.personaRevisionId),
		_scalarChange("modelDefinitionId", base.modelDefinitionId, target.modelDefinitionId),
		_scalarChange("budget.maxTurns", String(base.budget.maxTurns), String(target.budget.maxTurns)),
		_scalarChange("budget.maxTokens", String(base.budget.maxTokens), String(target.budget.maxTokens)),
		_scalarChange("budget.maxDurationMs", String(base.budget.maxDurationMs), String(target.budget.maxDurationMs)),
	].filter(_isPresent);

	// 3. Diff collection configuration fields as stable member-key sets.
	const setChanges = [
		_setChange("skills", _skillKeys(base), _skillKeys(target)),
		_setChange("integrationTools", _integrationToolKeys(base), _integrationToolKeys(target)),
		_setChange("integrationCustody", _integrationCustodyKeys(base), _integrationCustodyKeys(target)),
		_setChange("mcpToolRevisionIds", _mcpToolRevisionKeys(base), _mcpToolRevisionKeys(target)),
		_setChange("boundaryAttachments", _boundaryAttachmentKeys(base), _boundaryAttachmentKeys(target)),
	].filter(_isPresent);

	// 4. Flag every security-relevant widening for reviewer confirmation.
	const widenings = _collectWidenings(base, target, setChanges);

	return { lineDiffs, scalarChanges, setChanges, widenings };
}

/** Collects broader-scope, broader-tool, new-credential, and higher-budget widenings. */
function _collectWidenings(base: AgentRevision, target: AgentRevision, setChanges: readonly RevisionSetChange[]): RevisionWidening[]
{
	const widenings: RevisionWidening[] = [];

	// Broader knowledge scope: any newly attached scope target.
	const scopeChange = setChanges.find(function _Scope(change) { return change.field === "boundaryAttachments"; });
	if (scopeChange && scopeChange.added.length > 0)
	{
		widenings.push({ kind: "boundary", field: "boundaryAttachments", detail: `attached ${scopeChange.added.length} additional knowledge boundary target(s): ${scopeChange.added.join(", ")}` });
	}

	// Broader tools: any newly added skill or integration tool.
	const skillChange = setChanges.find(function _skills(change) { return change.field === "skills"; });
	if (skillChange && skillChange.added.length > 0)
	{
		widenings.push({ kind: "tools", field: "skills", detail: `added ${skillChange.added.length} skill(s): ${skillChange.added.join(", ")}` });
	}
	const toolChange = setChanges.find(function _tools(change) { return change.field === "integrationTools"; });
	if (toolChange && toolChange.added.length > 0)
	{
		widenings.push({ kind: "tools", field: "integrationTools", detail: `granted ${toolChange.added.length} integration tool(s): ${toolChange.added.join(", ")}` });
	}
	const mcpToolChange = setChanges.find(function _McpTools(change) { return change.field === "mcpToolRevisionIds"; });
	if (mcpToolChange && mcpToolChange.added.length > 0)
	{
		widenings.push({ kind: "tools", field: "mcpToolRevisionIds", detail: `granted ${mcpToolChange.added.length} MCP tool revision(s): ${mcpToolChange.added.join(", ")}` });
	}

	// New credentials: any integration bound in the target that the base did not carry.
	const baseIntegrations = new Set(base.integrationAssignments.map(function _id(assignment) { return assignment.integrationId; }));
	const newIntegrations = target.integrationAssignments.map(function _id(assignment) { return assignment.integrationId; }).filter(function _isNew(id) { return !baseIntegrations.has(id); });
	if (newIntegrations.length > 0)
	{
		widenings.push({ kind: "credentials", field: "integrationAssignments", detail: `bound ${newIntegrations.length} additional integration credential(s): ${[...new Set(newIntegrations)].sort().join(", ")}` });
	}

	// Higher budget: any raised resource ceiling.
	const budgetWidenings = [
		_budgetWidening("budget.maxTurns", base.budget.maxTurns, target.budget.maxTurns),
		_budgetWidening("budget.maxTokens", base.budget.maxTokens, target.budget.maxTokens),
		_budgetWidening("budget.maxDurationMs", base.budget.maxDurationMs, target.budget.maxDurationMs),
	].filter(_isPresent);
	widenings.push(...budgetWidenings);

	return widenings;
}

/** Narrows a nullable diff entry to its present value. */
function _isPresent<T>(value: T | null): value is T
{
	return value !== null;
}
