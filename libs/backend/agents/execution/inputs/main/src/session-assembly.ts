import { __DigestRunInputSnapshot } from "@opencrane/backend/agents/execution/runs";
import { RunExecutionPersonaPolicies, type InitialRunAuthority, type RunAdmissionCommit, type RunAdmissionPrepare } from "@opencrane/backend/agents/execution/runs";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CloneCanonicalJson, ___SortBy } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { __AreRunInputSnapshotMcpToolsValid } from "./mcp-tool-snapshot.validator";
import type { AssembleRunInputSnapshotResult, SessionAssemblyRefusalReason } from "./session-assembly-result.types";
import type { ExecutionSubject } from "@opencrane/models/agents";
import type { ApprovedPersonaInput, MemoryScopeInput, SessionAssemblyAuthorities, SessionAssemblyCommand, ConversationContextInput, ToolPolicyInput } from "./session-assembly.types";

/** Snapshot format version this assembler stamps on every snapshot it writes. */
const _SNAPSHOT_VERSION = 1;

/**
 * Admits one logical run by compiling its sole immutable `RunInputSnapshot`.
 *
 * The heavy lifting is delegated: this function only sequences it. Inside the admission
 * repository's single transaction (which serializes duplicates and holds the service lock),
 * each injected authority loads its slice of the input — run/revision, persona, conversation,
 * preferences, memory, tools, budget, signed identity — and any single refusal aborts the
 * whole admission with that reason. Nothing is persisted unless every source loads; a
 * duplicate `requestIdempotencyKey` returns the previously admitted snapshot untouched.
 *
 * Called by: `__CreateManagedRunAdmissionPort` (execution/admission/main/src/managed-run-admission.composition.ts)
 * and `__CreatePersonalRunAdmissionPort` (execution/admission/main/src/personal-run-admission.composition.ts).
 * Both wrap this call in a capacity gate first, so do not call it straight from a route. The personal
 * port reaches it twice: once for an ordinary agent-session message, and once through
 * `admitFirstAgentThreadRun` for the first run of a child Agent thread, which is the only caller that
 * passes `prepare`.
 *
 * @param command - Run ids and trigger. The caller chooses `runId` and
 * `requestIdempotencyKey` before calling. Sending the same key again returns the first run, so a
 * caller that wants a genuinely new run must send a new key.
 * @param authorities - The sources this function sequences, in the order listed above. Build the
 * set with the matching target admission composition. Each source receives the same checked
 * `ExecutionSubject`, so request provenance cannot select a separate execution identity.
 * @param commit - Optional extra write the caller needs inside the same transaction, such as the
 * conversation's input message. It runs only after every source has loaded, so it can never be
 * committed next to a partial snapshot.
 * @param prepare - Optional write the caller needs *before* the sources load, for the case where the
 * run's own inputs do not exist yet: the group `@agent` path uses it to create the child conversation
 * that the conversation source then reads in the same transaction. It is skipped for a duplicate key,
 * and rolled back with everything else if any source refuses, so it does not weaken the guarantee
 * above — a refused admission still leaves nothing behind.
 * @returns `assembled` with the snapshot, plus `admissionOutcome`: `accepted` means this call
 * created the run, `idempotent` means the key was already used and the snapshot is the original
 * one. A caller that treats `idempotent` as `accepted` will start a second runtime for one run.
 * `denied` carries a {@link SessionAssemblyRefusalReason}, which says whether the caller should
 * fix the request, wait, or give up.
 * @throws Anything an injected authority throws. This function has no try/catch, so a Prisma or
 * memory-gateway error is not turned into a `denied` outcome here.
 * @see SessionAssemblyRefusalReason
 * @see RunInputSnapshotAdmissionOutcomes
 */
export async function __AssembleRunInputSnapshot(command: SessionAssemblyCommand, authorities: SessionAssemblyAuthorities, commit?: RunAdmissionCommit, prepare?: RunAdmissionPrepare): Promise<AssembleRunInputSnapshotResult>
{
	// 1. Reject a command with blank or missing ids first, so no authority read can match rows outside this run.
	if (!_isCommandValid(command)) return { outcome: "denied", reason: "invalid_command" };

	// 2. Resolve a duplicate before compilation, or hold the service lock while every input is
	// revalidated. `prepare` runs first inside that same transaction when the caller passed one, so a
	// source below can read a conversation the caller has only just created.
	const admitted = await authorities.admission.admit(command, async function _compileWithinAdmission(transaction)
	{
		// 3. Load the run and its frozen revision first; every later source needs them.
		const run = await authorities.runAuthority.load(command, transaction);
		if (run.outcome === "denied") return run;

		// 4. Verify one AgentIdentity-and-Principal subject before loading any identity-scoped input.
		const executionSubject = await authorities.executionSubject.load(command, run.value, transaction);
		if (executionSubject.outcome === "denied") return executionSubject;
		if (!_IsExecutionSubjectBound(command, run.value, executionSubject.value)) return { outcome: "denied", reason: "identity_unavailable" } as const;

		// 5. The admitted revision's explicit policy determines whether an approved persona is required.
		const persona = await authorities.approvedPersona.load(command, run.value, executionSubject.value, transaction);
		if (persona.outcome === "denied") return persona;
		if ((run.value.executionPolicy.persona === RunExecutionPersonaPolicies.Required) !== (persona.value.personaRevisionId !== null))
		{
			return { outcome: "denied", reason: "persona_unavailable" } as const;
		}

		// 6. Freeze the transcript, rejecting messages that leaked into a non-conversational run.
		const conversation = await authorities.conversationContext.load(command, run.value, executionSubject.value, transaction);
		if (conversation.outcome === "denied") return conversation;
		if (command.conversationId === null && conversation.value.messageIds.length > 0) return { outcome: "denied", reason: "conversation_unavailable" } as const;

		// 7. Freeze preferences, identity-scoped memory, tools, and budgets in the same final transaction.
		const preferences = await authorities.preferenceFacts.load(command, run.value, executionSubject.value, transaction);
		if (preferences.outcome === "denied") return preferences;
		const memory = await authorities.memoryScope.load(command, run.value, executionSubject.value, conversation.value, transaction);
		if (memory.outcome === "denied") return memory;
		const tools = await authorities.toolPolicy.load(command, run.value, transaction);
		if (tools.outcome === "denied") return tools;
		if (!__AreRunInputSnapshotMcpToolsValid(tools.value.mcpTools))
		{
			return { outcome: "denied", reason: "tool_policy_unavailable" } as const;
		}
		const skills = await authorities.skillEligibility.load(command, run.value, tools.value, transaction);
		if (skills.outcome === "denied") return skills;
		const productAuthorization = await authorities.productAuthorization.load(command, executionSubject.value, persona.value, memory.value, tools.value, transaction);
		if (productAuthorization.outcome === "denied")
			return productAuthorization;
		const budget = await authorities.budgetPolicy.load(command, run.value, transaction);
		if (budget.outcome === "denied") return budget;
		// 8. Compile the immutable snapshot only after every source has re-checked its data inside this transaction.
		return { outcome: "ready", value: { authority: run.value, snapshot: _compileSnapshot(command, transaction.admittedAt, run.value, persona.value, conversation.value, preferences.value, memory.value, tools.value, budget.value.budgetPolicy, executionSubject.value) } } as const;
	}, commit, prepare);
	if (admitted.outcome === "denied") return { outcome: "denied", reason: _publicReason(admitted.reason) };
	return { outcome: "assembled", admissionOutcome: admitted.outcome, snapshot: admitted.snapshot };
}

/** Returns whether a command contains valid run coordinates and one deterministic compilation instant. */
function _isCommandValid(command: SessionAssemblyCommand): boolean
{
	return command.runId.trim().length > 0
		&& command.siloId.trim().length > 0
		&& (command.conversationId === null || command.conversationId.trim().length > 0)
		&& command.requestIdempotencyKey.trim().length > 0
		&& (command.conversationId === null || (typeof command.inputMessageId === "string" && command.inputMessageId.trim().length > 0 && Array.isArray(command.inputMessageBlocks) && command.inputMessageBlocks.length > 0));
}

/** Maps the repository-internal `authority_conflict` refusal onto the public assembly vocabulary. */
function _publicReason(reason: SessionAssemblyRefusalReason | "authority_conflict"): SessionAssemblyRefusalReason
{
	return reason === "authority_conflict" ? "run_not_admittable" : reason;
}

/** Compiles sorted source outputs into the one canonical shape and digests it without self-reference. */
function _compileSnapshot(command: SessionAssemblyCommand, admittedAt: string, run: InitialRunAuthority, persona: ApprovedPersonaInput, conversation: ConversationContextInput, preferences: readonly { readonly id: string }[], memory: MemoryScopeInput, tools: ToolPolicyInput, budgetPolicy: JsonValue, executionSubject: ExecutionSubject): RunInputSnapshot
{
	const withoutDigest = {
		runId: command.runId,
		attempt: executionSubject.runScope.attempt,
		siloId: command.siloId,
		agentServiceId: run.agentServiceId,
		agentRevisionId: run.agentRevisionId,
		snapshotVersion: _SNAPSHOT_VERSION,
		conversationId: command.conversationId,
		messageIds: [...conversation.messageIds],
		personaRevisionId: persona.personaRevisionId,
		preferenceFactIds: ___SortBy(preferences.map(function _preferenceId(preference): string { return preference.id; })),
		artifactRevisionIds: ___SortBy([...tools.artifactRevisionIds]),
		skillRevisionIds: ___SortBy([...tools.skillRevisionIds]),
		memoryQueryPolicy: ___CloneCanonicalJson(memory.memoryQueryPolicy),
		mcpTools: _canonicalMcpTools(tools.mcpTools),
		modelRoute: ___CloneCanonicalJson(tools.modelRoute),
		budgetPolicy: ___CloneCanonicalJson(budgetPolicy),
		executionSubject,
		promptCompilerVersion: run.promptCompilerVersion,
		compiledAt: admittedAt,
	};
	const digest = __DigestRunInputSnapshot(withoutDigest);
	return { ...withoutDigest, digest };
}

/** Copies and canonically orders exact MCP tool revisions before sealing the run snapshot. */
function _canonicalMcpTools(tools: ToolPolicyInput["mcpTools"]): ToolPolicyInput["mcpTools"]
{
	return [...tools]
		.map(function _McpTool(tool)
		{
			return { toolRevisionId: tool.toolRevisionId, name: tool.name, description: tool.description, inputSchema: ___CloneCanonicalJson(tool.inputSchema), inputSchemaDigest: tool.inputSchemaDigest };
		})
		.sort(function _ByRevision(left, right): number { return left.toolRevisionId.localeCompare(right.toolRevisionId); });
}

/** Checks that the injected subject fences the exact admitted run and a non-empty active computer lease. */
function _IsExecutionSubjectBound(command: SessionAssemblyCommand, run: InitialRunAuthority, executionSubject: ExecutionSubject): boolean
{
	return executionSubject.siloId === command.siloId
		&& executionSubject.runScope.siloId === command.siloId
		&& executionSubject.runScope.runId === command.runId
		&& executionSubject.runScope.attempt === 1
		&& executionSubject.runScope.agentServiceId === run.agentServiceId
		&& executionSubject.runScope.agentRevisionId === run.agentRevisionId
		&& executionSubject.computerScope.siloId === command.siloId
		&& executionSubject.computerScope.computerId.trim().length > 0
		&& executionSubject.computerScope.leaseId.trim().length > 0
		&& executionSubject.computerScope.leaseGeneration > 0
		&& executionSubject.capability.computerId === executionSubject.computerScope.computerId;
}
