import { __DigestRunInputSnapshot } from "@opencrane/backend/agents/execution/runs";
import type { InitialRunAuthority, RunAdmissionCommit, RunAdmissionPrepare } from "@opencrane/backend/agents/execution/runs";
import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CloneCanonicalJson, ___SortBy } from "@opencrane/util";
import type { JsonValue } from "@opencrane/util";

import { _IsIdentityFresh } from "./utils/canonical-inputs";
import { __AreRunInputSnapshotMcpToolsValid } from "./mcp-tool-snapshot.validator";
import type { AssembleRunInputSnapshotResult, SessionAssemblyRefusalReason } from "./session-assembly-result.types";
import type { ApprovedPersonaInput, IdentityEnvelopeInput, MemoryScopeInput, SessionAssemblyAuthorities, SessionAssemblyCommand, ConversationContextInput, ToolPolicyInput } from "./session-assembly.types";

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
 * @param command - Run ids, trigger, and identity kind. The caller chooses `runId` and
 * `requestIdempotencyKey` before calling. Sending the same key again returns the first run, so a
 * caller that wants a genuinely new run must send a new key.
 * @param authorities - The sources this function sequences, in the order listed above. Build the
 * set with {@link __CreatePrismaManagedSessionAssemblyAuthorities} or
 * {@link __CreatePrismaPersonalSessionAssemblyAuthorities}. Mixing the two lets a personal input
 * source run for a managed service, and every such source then refuses the run.
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
		// 3. Load the run and its locked revision first; every later source needs them.
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
		const conversation = await authorities.conversationContext.load(command, run.value, transaction);
		if (conversation.outcome === "denied") return conversation;
		if (command.conversationId === null && conversation.value.messageIds.length > 0) return { outcome: "denied", reason: "conversation_unavailable" } as const;

		// 7. Freeze preferences, identity-scoped memory, tools, and budgets in the same final transaction.
		const preferences = await authorities.preferenceFacts.load(command, run.value, identity.value, transaction);
		if (preferences.outcome === "denied") return preferences;
		const memory = await authorities.memoryScope.load(command, run.value, identity.value, conversation.value, transaction);
		if (memory.outcome === "denied") return memory;
		const tools = await authorities.toolPolicy.load(command, run.value, transaction);
		if (tools.outcome === "denied") return tools;
		if (!__AreRunInputSnapshotMcpToolsValid(tools.value.mcpTools))
		{
			return { outcome: "denied", reason: "tool_policy_unavailable" } as const;
		}
		const skills = await authorities.skillEligibility.load(command, run.value, tools.value, transaction);
		if (skills.outcome === "denied") return skills;
		const budget = await authorities.budgetPolicy.load(command, run.value, transaction);
		if (budget.outcome === "denied") return budget;
		// 8. Compile the immutable snapshot only after every source has re-checked its data inside this transaction.
		return { outcome: "ready", value: { authority: run.value, snapshot: _compileSnapshot(command, transaction.admittedAt, run.value, persona.value, conversation.value, preferences.value, memory.value, tools.value, budget.value.budgetPolicy, identity.value) } } as const;
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
		&& (command.identityKind !== "user" || command.conversationId === null || (typeof command.inputMessageId === "string" && command.inputMessageId.trim().length > 0 && Array.isArray(command.inputMessageBlocks) && command.inputMessageBlocks.length > 0))
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
function _compileSnapshot(command: SessionAssemblyCommand, admittedAt: string, run: InitialRunAuthority, persona: ApprovedPersonaInput, conversation: ConversationContextInput, preferences: readonly { readonly id: string }[], memory: MemoryScopeInput, tools: ToolPolicyInput, budgetPolicy: JsonValue, identity: IdentityEnvelopeInput): RunInputSnapshot
{
	const withoutDigest = {
		runId: command.runId,
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
		identitySnapshot: _SnapshotIdentity(identity),
		capabilitySetDigest: identity.capabilitySetDigest,
		effectiveContractDigest: run.effectiveContractDigest,
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

/** Drops `capabilitySetDigest`, which is only used during assembly, and keeps every other identity field for the snapshot. */
function _SnapshotIdentity(identity: IdentityEnvelopeInput): RunInputSnapshot["identitySnapshot"]
{
	const { capabilitySetDigest: _capabilitySetDigest, ...snapshotIdentity } = identity;
	return snapshotIdentity;
}
