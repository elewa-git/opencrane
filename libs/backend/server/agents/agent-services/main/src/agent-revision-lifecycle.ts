import { AgentServiceKinds, AgentServiceStates, __DiffAgentRevisions, __IsAgentServiceTransitionAllowed, type AgentRevisionId, type AgentServiceId, type AgentServiceState } from "@opencrane/models/agents";

import { _AreCompareAgentRevisionsCoordinatesValid, _IsChangeAgentServiceStateCommandValid, _IsCreateManagedAgentServiceCommandValid, _IsManagedRunNowCommandValid, _IsRestoreAgentRevisionCommandValid, _IsReviseAgentRevisionCommandValid } from "./agent-revision-lifecycle.validator";
import { ManagedRunAdmissionOutcomes, type AgentRevisionLifecycleRepository, type AgentServiceHistory, type AgentServiceLifecycleAction, type ChangeAgentServiceStateCommand, type ChangeAgentServiceStateResult, type CompareAgentRevisionsResult, type CreateManagedAgentServiceCommand, type CreateManagedAgentServiceResult, type AppendAgentRevisionResult, type ManagedRunAdmissionPort, type ManagedRunAdmissionResult, type ManagedRunNowCommand, type RestoreAgentRevisionCommand, type ReviseAgentRevisionCommand } from "./agent-revision-lifecycle.types";

/** Maps one lifecycle action to the target stable-service state it requests. */
function _actionState(action: AgentServiceLifecycleAction): AgentServiceState
{
	if (action === "enable") return "active";
	if (action === "pause") return "paused";
	return "retired";
}

/**
 * Creates one managed AgentService and its first immutable draft revision.
 * A managed agent never carries a persona, so the domain rejects a persona reference up front.
 * @param repository - Atomic definition-plane persistence boundary.
 * @param command - Create command carrying the first revision's content.
 * @param createdAt - Trusted ISO-8601 creation instant.
 * @returns The created service and revision, or a fail-closed reason.
 */
export async function __CreateManagedAgentService(repository: AgentRevisionLifecycleRepository, command: CreateManagedAgentServiceCommand, createdAt: string): Promise<CreateManagedAgentServiceResult>
{
	if (!_IsCreateManagedAgentServiceCommandValid(command, createdAt))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}
	return repository.createManagedService(command, createdAt);
}

/**
 * Appends one new immutable draft revision editing the expected head revision.
 * Optimistic concurrency is enforced by the repository against the expected parent revision.
 * @param repository - Atomic definition-plane persistence boundary.
 * @param command - Revise command carrying the new content and expected parent.
 * @param createdAt - Trusted ISO-8601 creation instant.
 * @returns The new draft revision, a conflict with the current head, or a reason.
 */
export async function __ReviseAgentRevision(repository: AgentRevisionLifecycleRepository, command: ReviseAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
{
	if (!_IsReviseAgentRevisionCommandValid(command, createdAt))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}
	return repository.reviseRevision(command, createdAt);
}

/**
 * Restores an older revision by cloning it into a new immutable draft revision.
 * The clone records the older revision as its source and never mutates or deletes history.
 * @param repository - Atomic definition-plane persistence boundary.
 * @param command - Restore command naming the source and expected parent revisions.
 * @param createdAt - Trusted ISO-8601 creation instant.
 * @returns The new draft revision, a conflict with the current head, or a reason.
 */
export async function __RestoreAgentRevision(repository: AgentRevisionLifecycleRepository, command: RestoreAgentRevisionCommand, createdAt: string): Promise<AppendAgentRevisionResult>
{
	if (!_IsRestoreAgentRevisionCommandValid(command, createdAt))
	{
		return { outcome: "denied", reason: "invalid_command" };
	}
	return repository.restoreRevision(command, createdAt);
}

/**
 * Changes one stable AgentService state under optimistic concurrency.
 * The requested transition must be legal for the observed state before authority is touched.
 * @param repository - Atomic definition-plane persistence boundary.
 * @param command - State-change command carrying the observed state and lifecycle action.
 * @param changedAt - Trusted ISO-8601 change instant.
 * @returns The updated service, a conflict with the current state, or a reason.
 */
export async function __ChangeAgentServiceState(repository: AgentRevisionLifecycleRepository, command: ChangeAgentServiceStateCommand, changedAt: string): Promise<ChangeAgentServiceStateResult>
{
	if (!_IsChangeAgentServiceStateCommandValid(command, changedAt) || !__IsAgentServiceTransitionAllowed(command.expectedState, _actionState(command.action)))
	{
		return { outcome: "denied", reason: "transition_not_allowed" };
	}
	return repository.changeServiceState(command, changedAt);
}

/**
 * Compares two immutable revisions of the same service.
 * @param repository - Definition-plane read boundary.
 * @param siloId - Caller's silo; a revision whose parent service is elsewhere must not resolve.
 * @param baseRevisionId - Earlier revision to compare from.
 * @param targetRevisionId - Later revision to compare to.
 * @returns The line, scalar, set, and widening diff, or a fail-closed reason.
 */
export async function __CompareAgentRevisions(repository: AgentRevisionLifecycleRepository, caller: { readonly principalId: string; readonly siloId: string }, baseRevisionId: AgentRevisionId, targetRevisionId: AgentRevisionId): Promise<CompareAgentRevisionsResult>
{
	if (!_AreCompareAgentRevisionsCoordinatesValid(caller.siloId, baseRevisionId, targetRevisionId) || caller.principalId.trim().length === 0)
	{
		return { outcome: "denied", reason: "invalid_command" };
	}
	const [base, target] = await Promise.all([repository.getRevision(baseRevisionId, caller), repository.getRevision(targetRevisionId, caller)]);
	if (base === null || target === null)
	{
		return { outcome: "denied", reason: "revision_not_found" };
	}
	if (base.agentServiceId !== target.agentServiceId)
	{
		return { outcome: "denied", reason: "revision_service_mismatch" };
	}
	return { outcome: "compared", base, target, diff: __DiffAgentRevisions(base, target) };
}

/**
 * Reads the immutable revision lineage and durable run history for one service.
 * @param repository - Definition-plane read boundary.
 * @param agentServiceId - Service whose history is requested.
 * @param siloId - Caller's silo; history of a service in another silo must not resolve.
 * @param runLimit - Maximum run-history records to return.
 * @returns The revision lineage and run history, newest first.
 */
export async function __ReadAgentServiceHistory(repository: AgentRevisionLifecycleRepository, agentServiceId: AgentServiceId, caller: { readonly principalId: string; readonly siloId: string }, runLimit: number): Promise<AgentServiceHistory>
{
	return repository.readHistory(agentServiceId, caller, runLimit);
}

/**
 * Records one managed run-now admission for the service's currently active revision.
 *
 * This validates that the target is a managed service that is active and has an active revision,
 * then delegates to the injected admission port. It never dispatches a Job, schedules, or executes
 * anything; recording the admission is the whole responsibility of this slice.
 *
 * @param repository - Definition-plane read boundary.
 * @param port - App-owned managed run admission boundary.
 * @param command - Run-now command carrying the idempotency key and requester.
 * @returns The admission outcome, or a fail-closed reason.
 */
export async function __AdmitManagedRunNow(repository: AgentRevisionLifecycleRepository, port: ManagedRunAdmissionPort, command: ManagedRunNowCommand): Promise<ManagedRunAdmissionResult>
{
	if (!_IsManagedRunNowCommandValid(command))
	{
		return { outcome: ManagedRunAdmissionOutcomes.Denied, reason: "invalid_command" };
	}
	const service = await repository.getServiceForAdmission(command.agentServiceId, command.siloId);
	if (service === null)
	{
		return { outcome: ManagedRunAdmissionOutcomes.Denied, reason: "service_not_found" };
	}
	if (service.kind !== AgentServiceKinds.Managed || service.state !== AgentServiceStates.Active || service.activeRevisionId === null)
	{
		return { outcome: ManagedRunAdmissionOutcomes.Denied, reason: "service_not_runnable" };
	}
	return port.admitManagedRun(command);
}
