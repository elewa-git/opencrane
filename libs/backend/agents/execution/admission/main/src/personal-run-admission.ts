import { createHash } from "node:crypto";

import { RunInputSnapshotAdmissionOutcomes, SessionAssemblyOutcomes, type AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import { RunAdmissionConcurrencyOutcomes, RunAdmissionDenialReasons } from "@opencrane/backend/agents/execution/runs";

import type { PersonalRunAdmissionDependencies, PersonalRunAdmissionPort, PersonalRunAdmissionResult } from "./personal-run-admission.types.js";
import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types.js";

/** Fake service id used as the gate key for the preflight reads, which run before the real service is known. */
const _PERSONAL_ADMISSION_PREFLIGHT_SERVICE_ID = "__personal_admission_preflight__";

/** What the read-only preflight stage can find. */
enum _PersonalRunPreflightOutcomes
{
	/** A durable duplicate has already frozen the caller's original snapshot. */
	Idempotent = "idempotent",
	/** The idempotency key already belongs to a different subject, trigger, or conversation. */
	Conflict = "conflict",
	/** No duplicate exists but the caller has no eligible active personal conversation. */
	ConversationUnavailable = "conversation_unavailable",
	/** The caller may enter the final service-specific admission gate. */
	Resolved = "resolved",
}

/** Result of the read-only preflight. The only thing it produces is the AgentService the server resolved. */
type _PersonalRunPreflightResult =
	| { readonly outcome: _PersonalRunPreflightOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Conflict | _PersonalRunPreflightOutcomes.ConversationUnavailable }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Resolved; readonly agentServiceId: string };

/**
 * Creates the personal run admission port. It knows nothing about HTTP.
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

			// 2. Put the duplicate and conversation reads behind the capacity gate, so browser traffic cannot hit Prisma unbounded.
			const preflight = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId: _PERSONAL_ADMISSION_PREFLIGHT_SERVICE_ID },
				async function _ResolvePreflight(): Promise<_PersonalRunPreflightResult>
				{
					const duplicate = await dependencies.repository.resolve(scopedCommand);
					if (duplicate.outcome === PersonalRunIdempotencyOutcomes.Idempotent) return { outcome: _PersonalRunPreflightOutcomes.Idempotent, runId: duplicate.runId };
					if (duplicate.outcome === PersonalRunIdempotencyOutcomes.Conflict) return { outcome: _PersonalRunPreflightOutcomes.Conflict };
					const authority = await dependencies.repository.resolveConversation(scopedCommand);
					return authority === null ? { outcome: _PersonalRunPreflightOutcomes.ConversationUnavailable } : { outcome: _PersonalRunPreflightOutcomes.Resolved, agentServiceId: authority.agentServiceId };
				},
			);
			if (preflight.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: preflight.reason };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.Idempotent) return { outcome: PersonalRunAdmissionOutcomes.Idempotent, runId: preflight.value.runId };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.Conflict) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.AuthorityConflict };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.ConversationUnavailable) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.ConversationUnavailable };
			if (preflight.value.outcome !== _PersonalRunPreflightOutcomes.Resolved) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.AuthorityConflict };
			const agentServiceId = preflight.value.agentServiceId;

			// 3. Take a slot from the same gate managed admission uses, before opening the expensive assembly transaction.
			const bounded = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId },
				async function _assembleAfterCapacityGrant(): Promise<AssembleRunInputSnapshotResult>
				{
					const assembled = await dependencies.assemble(scopedCommand, { agentServiceId }, commit);
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
			if (bounded.value.outcome === SessionAssemblyOutcomes.Denied) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: bounded.value.reason };
			return {
				outcome: bounded.value.admissionOutcome === RunInputSnapshotAdmissionOutcomes.Accepted ? PersonalRunAdmissionOutcomes.Accepted : PersonalRunAdmissionOutcomes.Idempotent,
				runId: bounded.value.snapshot.runId,
			};
		},
	};
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
