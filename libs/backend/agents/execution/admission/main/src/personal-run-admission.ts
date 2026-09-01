import { createHash, randomUUID } from "node:crypto";

import { RunInputSnapshotAdmissionOutcomes, SessionAssemblyOutcomes, type AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import { RunAdmissionConcurrencyOutcomes, RunAdmissionDenialReasons } from "@opencrane/backend/agents/execution/runs";

import type { PersonalRunAdmissionAssemblyCommand, PersonalRunAdmissionDependencies, PersonalRunAdmissionPort, PersonalRunAdmissionResult } from "./personal-run-admission.types";
import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types";

/** Fake service id used as the gate key for the preflight reads, which run before the real service is known. */
const _PERSONAL_ADMISSION_PREFLIGHT_SERVICE_ID = "__personal_admission_preflight__";

/**
 * What the read-only preflight stage of `admitPersonalRun` found, and therefore whether the
 * expensive assembly transaction is opened at all.
 *
 * Only this file reads these values. They are never stored and never sent to a client, so renaming a
 * member needs no migration. Three of the four end the call immediately; only `Resolved` continues.
 */
enum _PersonalRunPreflightOutcomes
{
	/** The caller is not a participant in an open personal conversation. Refuse without assembling. */
	ConversationUnavailable = "conversation_unavailable",
	/** The conversation resolved to an AgentService, so the call may take a slot on that service's lane and assemble. Carries `agentServiceId`. */
	Resolved = "resolved",
}

/**
 * Result of the read-only preflight. The only new fact it produces is the AgentService the server
 * resolved, which decides which capacity lane the assembly stage queues on.
 *
 * The preflight grants no access: session assembly re-reads the same conversation inside its own
 * transaction and refuses there if the caller's participation has since ended.
 */
type _PersonalRunPreflightResult =
	| { readonly outcome: _PersonalRunPreflightOutcomes.ConversationUnavailable }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Resolved; readonly agentServiceId: string };

/** Combines a durable duplicate outcome with normal input assembly after transaction-scoped subject resolution. */
type _PersonalRunAssemblyResult = AssembleRunInputSnapshotResult | { readonly outcome: "idempotent"; readonly runId: string } | { readonly outcome: "conflict" };

/**
 * Creates the personal run admission port. It knows nothing about HTTP.
 *
 * The port has two entry points because a run can start against a conversation that already exists
 * or against one that does not exist yet. `admitPersonalRun` takes the first case and runs the two
 * gated stages described below. `admitFirstAgentThreadRun` takes the second: its child conversation
 * is created by the caller's `prepare` write inside the admission transaction, so there is nothing
 * to look up beforehand and it skips the preflight entirely — see the test
 * "admits a first Agent-thread run without pre-reading a child that is created in the same
 * transaction" in `__tests__/personal-run-admission.test.ts`.
 *
 * Two gated stages. The preflight read looks up the conversation for one reason only: to learn which
 * AgentService the final capacity gate should queue against. The assembler reads that conversation
 * again inside its own transaction, so this early lookup grants no access and is thrown away if the
 * participant or service changed in between.
 *
 * The preflight is itself behind the gate, under a placeholder service id, so browser traffic cannot
 * reach Prisma unbounded before a real service is known.
 *
 * If the final commit fails, it re-reads the conversation once to tell "another run got there first"
 * apart from "the database is unhealthy" — those need different replies. If that recovery read also
 * fails, the original failure is returned and the recovery error is logged, never swallowed.
 *
 * Called by: `__CreatePersonalRunAdmissionPort` (personal-run-admission.composition.ts) and
 * `__tests__/personal-run-admission.test.ts`.
 *
 * @param dependencies - Repository, assembler, shared capacity gate, and logger. See
 * {@link PersonalRunAdmissionDependencies}; the gate must be the same instance managed admission got.
 * @returns The port the HTTP layer calls. See {@link PersonalRunAdmissionResult} for what each
 * outcome obliges the caller to do.
 */
export function __CreatePersonalRunAdmissionPortWithGate(dependencies: PersonalRunAdmissionDependencies): PersonalRunAdmissionPort
{
	return {
		async admitPersonalRun(command, commit): Promise<PersonalRunAdmissionResult>
		{
			// 1. Hash the caller's key together with the conversation id, so keys from different conversations cannot collide in the silo-wide run table.
			const scopedCommand = { ...command, requestIdempotencyKey: _conversationScopedIdempotencyKey(command.conversationId, command.requestIdempotencyKey) };

			// 2. Put the participant-bound conversation read behind the capacity gate, so browser traffic cannot hit Prisma unbounded.
			const preflight = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId: _PERSONAL_ADMISSION_PREFLIGHT_SERVICE_ID },
				async function _ResolvePreflight(): Promise<_PersonalRunPreflightResult>
				{
					const authority = await dependencies.repository.resolveConversation(scopedCommand);
					return authority === null ? { outcome: _PersonalRunPreflightOutcomes.ConversationUnavailable } : { outcome: _PersonalRunPreflightOutcomes.Resolved, agentServiceId: authority.agentServiceId };
				},
			);
			if (preflight.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: preflight.reason };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.ConversationUnavailable) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.ConversationUnavailable };
			if (preflight.value.outcome !== _PersonalRunPreflightOutcomes.Resolved) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.AuthorityConflict };
			const agentServiceId = preflight.value.agentServiceId;

			// 3. Take a slot from the same gate managed admission uses, before opening the expensive assembly transaction.
			const bounded = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId },
				async function _assembleAfterCapacityGrant(): Promise<_PersonalRunAssemblyResult>
				{
					const assemblyCommand = _assembleCommand(scopedCommand, agentServiceId);
					const duplicate = await dependencies.repository.resolve(assemblyCommand);
					if (duplicate.outcome === PersonalRunIdempotencyOutcomes.Idempotent)
						return { outcome: "idempotent", runId: duplicate.runId };
					if (duplicate.outcome === PersonalRunIdempotencyOutcomes.Conflict)
						return { outcome: "conflict" };
					const assembled = await dependencies.assemble(assemblyCommand, { agentServiceId }, commit);
					if (assembled.outcome !== SessionAssemblyOutcomes.Denied || assembled.reason !== RunAdmissionDenialReasons.PersistenceUnavailable) return assembled;
					try
					{
						if (await dependencies.repository.hasActiveConversationRun(scopedCommand)) return { outcome: SessionAssemblyOutcomes.Denied, reason: RunAdmissionDenialReasons.ActiveRun };
					}
					catch (err)
					{
						dependencies.logger.warn({ err, siloId: scopedCommand.siloId, agentServiceId, failureKind: "active_run_recovery_failed" }, "Personal run admission recovery failed");
						return assembled;
					}
					return assembled;
				},
			);
			if (bounded.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: bounded.reason };
			if (bounded.value.outcome === "idempotent") return { outcome: PersonalRunAdmissionOutcomes.Idempotent, runId: bounded.value.runId };
			if (bounded.value.outcome === "conflict") return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.AuthorityConflict };
			if (bounded.value.outcome === SessionAssemblyOutcomes.Denied) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: bounded.value.reason };
			return {
				outcome: bounded.value.admissionOutcome === RunInputSnapshotAdmissionOutcomes.Accepted ? PersonalRunAdmissionOutcomes.Accepted : PersonalRunAdmissionOutcomes.Idempotent,
				runId: bounded.value.snapshot.runId,
			};
		},
		async admitFirstAgentThreadRun(command, agentServiceId, prepare, commit): Promise<PersonalRunAdmissionResult>
		{
			// 1. Hash the caller's key together with the child conversation id, the same way the ordinary
			// path does, because both keys land in the one silo-wide AgentRun table. The caller reuses its
			// browser idempotency key for the parent message as well, so without this the two would clash.
			const scopedCommand = { ...command, requestIdempotencyKey: _conversationScopedIdempotencyKey(command.conversationId, command.requestIdempotencyKey) };

			// 2. Take a slot on the service the caller named, then do everything inside one transaction:
			// `prepare` writes the parent message and creates the child conversation, the input sources
			// read that child, and `commit` saves the child message and the thread's origin row. There is
			// no preflight read here — the child does not exist until `prepare` runs.
			const bounded = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId },
				async function _AssembleFirstThreadRun(): Promise<AssembleRunInputSnapshotResult>
				{
					return dependencies.assemble(_assembleCommand(scopedCommand, agentServiceId), { agentServiceId }, commit, prepare);
				},
			);

			// 3. Translate the two failure shapes and the two success shapes into the port's own result.
			// A capacity rejection and an assembly refusal are both `Denied` but carry different reasons,
			// and `Accepted` must stay distinct from `Idempotent` so the caller does not report a fresh
			// thread for a message it already admitted.
			if (bounded.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: bounded.reason };
			if (bounded.value.outcome === SessionAssemblyOutcomes.Denied) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: bounded.value.reason };
			return { outcome: bounded.value.admissionOutcome === RunInputSnapshotAdmissionOutcomes.Accepted ? PersonalRunAdmissionOutcomes.Accepted : PersonalRunAdmissionOutcomes.Idempotent, runId: bounded.value.snapshot.runId };
		},
	};
}

/** Allocates run coordinates; the transaction-scoped input authority resolves the subject after preparation. */
function _assembleCommand(command: Parameters<PersonalRunAdmissionPort["admitPersonalRun"]>[0], agentServiceId: string): PersonalRunAdmissionAssemblyCommand
{
	return { ...command, runId: randomUUID(), agentServiceId };
}

/**
 * Combines the caller's key with the conversation id before it is stored in the silo-wide AgentRun
 * table. Hashing keeps the stored key a fixed length, stops the same key in two conversations from
 * clashing, and still lets a retry in the same conversation find the same run.
 */
function _conversationScopedIdempotencyKey(conversationId: string, requestIdempotencyKey: string): string
{
	const digest = createHash("sha256")
		.update("personal-conversation-run\u0000")
		.update(conversationId)
		.update("\u0000")
		.update(requestIdempotencyKey)
		.digest("hex");
	return `sha256:${digest}`;
}
