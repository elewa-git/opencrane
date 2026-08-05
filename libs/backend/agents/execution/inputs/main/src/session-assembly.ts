import { __DigestRunInputSnapshot } from "@opencrane/backend/agents/execution/runs";
import type { InitialRunAuthority } from "@opencrane/backend/agents/execution/runs";
import type { RunInputSnapshot, RunInputSnapshotIntegrationAssignment } from "@opencrane/contracts";
import { ___CloneCanonicalJson, ___SortBy } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { _CanonicalMemoryFacts, _IsIdentityFresh } from "./utils/canonical-inputs.js";
import type { AssembleRunInputSnapshotResult, SessionAssemblyRefusalReason } from "./session-assembly-result.types.js";
import type { ApprovedPersonaInput, IdentityEnvelopeInput, MemoryScopeInput, SessionAssemblyAuthorities, SessionAssemblyCommand, ThreadContextInput, ToolPolicyInput } from "./session-assembly.types.js";

/** Stable contract version emitted by the first session assembler. */
const _SNAPSHOT_VERSION = 1;

/**
 * Admits one logical run by compiling its sole immutable `RunInputSnapshot`.
 *
 * The heavy lifting is delegated: this function only sequences it. Inside the admission
 * repository's single transaction (which serializes duplicates and holds the service lock),
 * each injected authority loads its slice of the input — run/revision, persona, thread,
 * preferences, memory, tools, budget, signed identity — and any single refusal aborts the
 * whole admission with that reason. Nothing is persisted unless every source loads; a
 * duplicate `requestIdempotencyKey` returns the previously admitted snapshot untouched.
 */
export async function __AssembleRunInputSnapshot(command: SessionAssemblyCommand, authorities: SessionAssemblyAuthorities): Promise<AssembleRunInputSnapshotResult>
{
	// 1. Reject malformed coordinates before any authority read can accidentally widen its scope.
	if (!_isCommandValid(command)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Resolve a duplicate before compilation, or hold the service lock while every input is revalidated.
	const admitted = await authorities.admission.admit(command, async function _compileWithinAdmission(transaction)
	{
		// 3. Load the admitted run and pinned revision before any dependent authority can be resolved.
		const run = await authorities.runAuthority.load(command, transaction);
		if (run.outcome === "denied") return run;

		// 4. Verify signed identity before any identity-scoped input can select data from another organization.
		const identity = await authorities.identityEnvelope.load(command, run.value, transaction);
		if (identity.outcome === "denied") return identity;
		if (!_IsIdentityFresh(identity.value, transaction.admittedAt)) return { outcome: "denied", reason: "membership_stale" } as const;
		if ((run.value.agentKind === "personal" && identity.value.kind !== "user") || (run.value.agentKind === "managed" && identity.value.kind !== "service")) return { outcome: "denied", reason: "identity_unavailable" } as const;

		// 5. A personal run requires an approved persona; a managed run must not carry one.
		const persona = await authorities.approvedPersona.load(command, run.value, transaction);
		if (persona.outcome === "denied") return persona;
		if ((run.value.agentKind === "personal") !== (persona.value.personaRevisionId !== null)) return { outcome: "denied", reason: "persona_unavailable" } as const;

		// 6. Freeze the transcript, rejecting messages that leaked into a non-conversational run.
		const thread = await authorities.threadContext.load(command, run.value, transaction);
		if (thread.outcome === "denied") return thread;
		if (command.threadId === null && thread.value.messageIds.length > 0) return { outcome: "denied", reason: "thread_unavailable" } as const;

		// 7. Freeze preferences, identity-scoped memory, tools, and budgets in the same final transaction.
		const preferences = await authorities.preferenceFacts.load(command, run.value, identity.value, transaction);
		if (preferences.outcome === "denied") return preferences;
		const memory = await authorities.memoryScope.load(command, run.value, identity.value, thread.value, transaction);
		if (memory.outcome === "denied") return memory;
		const tools = await authorities.toolPolicy.load(command, run.value, transaction);
		if (tools.outcome === "denied") return tools;
		if (!_areIntegrationAssignmentsValid(tools.value.integrationAssignments)) return { outcome: "denied", reason: "tool_policy_unavailable" } as const;
		const skills = await authorities.skillEligibility.load(command, run.value, tools.value, transaction);
		if (skills.outcome === "denied") return skills;
		const budget = await authorities.budgetPolicy.load(command, run.value, transaction);
		if (budget.outcome === "denied") return budget;
		// 8. Compile the immutable snapshot only after all source authority is revalidated at the durable fence.
		return { outcome: "ready", value: { authority: run.value, snapshot: _compileSnapshot(command, transaction.admittedAt, run.value, persona.value, thread.value, preferences.value, memory.value, tools.value, budget.value.budgetPolicy, identity.value) } } as const;
	});
	if (admitted.outcome === "denied") return { outcome: "denied", reason: _publicReason(admitted.reason) };
	return { outcome: "assembled", admissionOutcome: admitted.outcome, snapshot: admitted.snapshot };
}

/** Returns whether a command contains valid run coordinates and one deterministic compilation instant. */
function _isCommandValid(command: SessionAssemblyCommand): boolean
{
	return command.runId.trim().length > 0
		&& command.siloId.trim().length > 0
		&& (command.threadId === null || command.threadId.trim().length > 0)
		&& command.requestIdempotencyKey.trim().length > 0
		&& (command.identityKind === "user"
			? command.trigger === "interactive" && command.executionSubjectId.trim().length > 0
			: (command.trigger === "schedule" || command.trigger === "managed_invocation"));
}

/** Maps the repository-internal `authority_conflict` refusal onto the public assembly vocabulary. */
function _publicReason(reason: SessionAssemblyRefusalReason | "authority_conflict"): SessionAssemblyRefusalReason
{
	return reason === "authority_conflict" ? "run_not_admittable" : reason;
}

/** Compiles sorted source outputs into the one canonical shape and digests it without self-reference. */
function _compileSnapshot(command: SessionAssemblyCommand, admittedAt: string, run: InitialRunAuthority, persona: ApprovedPersonaInput, thread: ThreadContextInput, preferences: readonly { readonly id: string }[], memory: MemoryScopeInput, tools: ToolPolicyInput, budgetPolicy: JsonValue, identity: IdentityEnvelopeInput): RunInputSnapshot
{
	const withoutDigest = {
		runId: command.runId,
		siloId: command.siloId,
		agentServiceId: run.agentServiceId,
		agentRevisionId: run.agentRevisionId,
		snapshotVersion: _SNAPSHOT_VERSION,
		threadId: command.threadId,
		messageIds: [...thread.messageIds],
		personaRevisionId: persona.personaRevisionId,
		preferenceFactIds: ___SortBy(preferences.map(function _preferenceId(preference): string { return preference.id; })),
		artifactRevisionIds: ___SortBy([...tools.artifactRevisionIds]),
		skillRevisionIds: ___SortBy([...tools.skillRevisionIds]),
		memoryFacts: _CanonicalMemoryFacts(memory.memoryFacts),
		memoryQueryPolicy: ___CloneCanonicalJson(memory.memoryQueryPolicy),
		integrationAssignments: _canonicalIntegrationAssignments(tools.integrationAssignments),
		modelRoute: ___CloneCanonicalJson(tools.modelRoute),
		budgetPolicy: ___CloneCanonicalJson(budgetPolicy),
		identitySnapshot: _SnapshotIdentity(identity),
		capabilitySetDigest: identity.capabilitySetDigest,
		effectiveContractDigest: run.effectiveContractDigest,
		promptCompilerVersion: run.promptCompilerVersion,
		compiledAt: admittedAt,
	};
	const digest = __DigestRunInputSnapshot(withoutDigest);
	return { ...withoutDigest, digest };
}

/** Removes the assembly-only capability digest while retaining every tagged identity field in the persisted snapshot. */
function _SnapshotIdentity(identity: IdentityEnvelopeInput): RunInputSnapshot["identitySnapshot"]
{
	const { capabilitySetDigest: _capabilitySetDigest, ...snapshotIdentity } = identity;
	return snapshotIdentity;
}

/** Canonicalises revision-selected integration tools before sealing them into a snapshot. */
function _canonicalIntegrationAssignments(assignments: readonly RunInputSnapshotIntegrationAssignment[]): readonly RunInputSnapshotIntegrationAssignment[]
{
	return [...assignments]
		.map(function _assignment(assignment): RunInputSnapshotIntegrationAssignment
		{
			return { integrationId: assignment.integrationId, allowedTools: ___SortBy([...new Set(assignment.allowedTools)]) };
		})
		.sort(function _byIntegration(left, right): number { return left.integrationId.localeCompare(right.integrationId); });
}

/** Rejects integration allowances that cannot form one unambiguous runtime tool-revision identifier. */
function _areIntegrationAssignmentsValid(assignments: readonly RunInputSnapshotIntegrationAssignment[]): boolean
{
	return assignments.every(function _assignment(assignment): boolean
	{
		return assignment.integrationId.trim().length > 0
			&& !assignment.integrationId.includes(":")
			&& assignment.allowedTools.length > 0
			&& assignment.allowedTools.every(function _tool(tool): boolean { return tool.trim().length > 0 && !tool.includes(":"); });
	});
}
