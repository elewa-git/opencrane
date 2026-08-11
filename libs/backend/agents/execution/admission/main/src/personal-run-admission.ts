import { createHash } from "node:crypto";

import { RunInputSnapshotAdmissionOutcomes, SessionAssemblyOutcomes, type AssembleRunInputSnapshotResult } from "@opencrane/backend/agents/execution/inputs";
import { RunAdmissionConcurrencyOutcomes, RunAdmissionDenialReasons } from "@opencrane/backend/agents/execution/runs";

import type { PersonalRunAdmissionDependencies, PersonalRunAdmissionPort, PersonalRunAdmissionResult } from "./personal-run-admission.types.js";
import { PersonalRunAdmissionDenialReasons, PersonalRunAdmissionOutcomes, PersonalRunIdempotencyOutcomes } from "./personal-run-admission.types.js";

/** Non-user-visible service key that bounds preflight reads before a real service is known. */
const _PERSONAL_ADMISSION_PREFLIGHT_SERVICE_ID = "__personal_admission_preflight__";

/** Private outcomes from the bounded read-only preflight stage. */
enum _PersonalRunPreflightOutcomes
{
	/** A durable duplicate has already frozen the caller's original snapshot. */
	Idempotent = "idempotent",
	/** The idempotency key belongs to a conflicting durable authority. */
	Conflict = "conflict",
	/** No duplicate exists but the caller has no eligible active personal conversation. */
	ConversationUnavailable = "conversation_unavailable",
	/** The caller may enter the final service-specific admission gate. */
	Resolved = "resolved",
}

/** Read-only preflight result whose only authority output is a server-resolved personal service. */
type _PersonalRunPreflightResult =
	| { readonly outcome: _PersonalRunPreflightOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Conflict | _PersonalRunPreflightOutcomes.ConversationUnavailable }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Resolved; readonly agentServiceId: string };

/**
 * Creates the transport-free personal run admission port.
 *
 * A bounded preflight lane resolves the conversation only to derive the final AgentService fairness
 * coordinate. The immutable assembler re-reads that conversation inside its transaction, so this
 * preliminary lookup cannot grant access or survive a participant/service change.
 */
export function __CreatePersonalRunAdmissionPortWithGate(dependencies: PersonalRunAdmissionDependencies): PersonalRunAdmissionPort
{
	return {
		async admitPersonalRun(command, commit): Promise<PersonalRunAdmissionResult>
		{
			// 1. Domain-separate the conversation-local public key before any silo-global run lookup.
			const scopedCommand = { ...command, requestIdempotencyKey: _conversationScopedIdempotencyKey(command.conversationId, command.requestIdempotencyKey) };

			// 2. Bound all duplicate/conversation reads before browser traffic can reach Prisma.
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

			// 3. Share personal-and-managed fairness before opening the expensive final assembly transaction.
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
 * Namespaces a participant-visible message key before it enters the silo-global AgentRun keyspace.
 * The digest keeps stored keys bounded and prevents identical keys in different conversations from
 * conflicting while exact retries in one conversation still select the same durable run.
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
