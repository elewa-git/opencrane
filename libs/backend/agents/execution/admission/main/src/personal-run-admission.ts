import { RunInputSnapshotAdmissionOutcomes, SessionAssemblyOutcomes } from "@opencrane/backend/agents/execution/inputs";
import { RunAdmissionConcurrencyOutcomes } from "@opencrane/backend/agents/execution/runs";

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
	/** No duplicate exists but the caller has no eligible active personal thread. */
	ThreadUnavailable = "thread_unavailable",
	/** The caller may enter the final service-specific admission gate. */
	Resolved = "resolved",
}

/** Read-only preflight result whose only authority output is a server-resolved personal service. */
type _PersonalRunPreflightResult =
	| { readonly outcome: _PersonalRunPreflightOutcomes.Idempotent; readonly runId: string }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Conflict | _PersonalRunPreflightOutcomes.ThreadUnavailable }
	| { readonly outcome: _PersonalRunPreflightOutcomes.Resolved; readonly agentServiceId: string };

/**
 * Creates the transport-free personal run admission port.
 *
 * A bounded preflight lane resolves the thread only to derive the final AgentService fairness
 * coordinate. The immutable assembler re-reads that thread inside its transaction, so this
 * preliminary lookup cannot grant access or survive a participant/service change.
 */
export function __CreatePersonalRunAdmissionPortWithGate(dependencies: PersonalRunAdmissionDependencies): PersonalRunAdmissionPort
{
	return {
		async admitPersonalRun(command): Promise<PersonalRunAdmissionResult>
		{
			// 1. Bound all duplicate/thread reads before browser traffic can reach Prisma.
			const preflight = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId: _PERSONAL_ADMISSION_PREFLIGHT_SERVICE_ID },
				async function _ResolvePreflight(): Promise<_PersonalRunPreflightResult>
				{
					const duplicate = await dependencies.repository.resolve(command);
					if (duplicate.outcome === PersonalRunIdempotencyOutcomes.Idempotent) return { outcome: _PersonalRunPreflightOutcomes.Idempotent, runId: duplicate.runId };
					if (duplicate.outcome === PersonalRunIdempotencyOutcomes.Conflict) return { outcome: _PersonalRunPreflightOutcomes.Conflict };
					const authority = await dependencies.repository.resolveThread(command);
					return authority === null ? { outcome: _PersonalRunPreflightOutcomes.ThreadUnavailable } : { outcome: _PersonalRunPreflightOutcomes.Resolved, agentServiceId: authority.agentServiceId };
				},
			);
			if (preflight.outcome === RunAdmissionConcurrencyOutcomes.Rejected) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: preflight.reason };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.Idempotent) return { outcome: PersonalRunAdmissionOutcomes.Idempotent, runId: preflight.value.runId };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.Conflict) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.AuthorityConflict };
			if (preflight.value.outcome === _PersonalRunPreflightOutcomes.ThreadUnavailable) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.ThreadUnavailable };
			if (preflight.value.outcome !== _PersonalRunPreflightOutcomes.Resolved) return { outcome: PersonalRunAdmissionOutcomes.Denied, reason: PersonalRunAdmissionDenialReasons.AuthorityConflict };
			const agentServiceId = preflight.value.agentServiceId;

			// 2. Share personal-and-managed fairness before opening the expensive final assembly transaction.
			const bounded = await dependencies.capacityGate.execute(
				{ siloId: command.siloId, agentServiceId },
				async function _assembleAfterCapacityGrant()
				{
					return dependencies.assemble(command, { agentServiceId });
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
