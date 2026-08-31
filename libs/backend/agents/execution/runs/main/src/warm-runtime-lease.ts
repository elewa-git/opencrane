/** The projected Pod identity a reviewer verified for the calling runtime. */
export interface WarmRuntimeLeaseIdentity
{
	readonly namespace: string;
	readonly serviceAccountName: string;
	readonly podUid: string;
}

/** The assignment fields the lease check reads; state strings follow the runs schema enums. */
export interface WarmRuntimeLeaseAssignmentRow
{
	readonly namespace: string;
	readonly serviceAccountName: string;
	readonly state: string;
	readonly revokedAt: Date | null;
	readonly expiresAt: Date;
	readonly workloadKind: string;
	readonly bindingGeneration: number;
}

/** The reservation fields the lease check reads; state strings follow the runs schema enums. */
export interface WarmRuntimeLeaseReservationRow
{
	readonly generation: number;
	readonly state: string;
	readonly namespace: string;
	readonly serviceAccountName: string;
	readonly podUid: string;
	readonly idleDeadline: Date;
}

/**
 * Decides whether one reviewed Pod identity currently holds the warm-runtime lease for a run attempt.
 *
 * This is the one predicate set every reader of the WorkloadAssignment + WarmRuntimeReservation
 * pair applies before treating a caller as the assigned runtime: the assignment must be a live,
 * unrevoked, unexpired Registered Deployment in the caller's namespace under the caller's service
 * account; the reservation must be the assignment's current generation, Claimed by exactly this
 * Pod, and inside its idle deadline. Each reader used to hand-roll a subset of these checks and
 * the subsets had drifted.
 *
 * Called by: the runtime continuation repository, the runtime dispatch repository, the
 * conversation-asset output repository, and the agent-thread parent-delivery repository.
 *
 * @param identity - The reviewed Pod identity making the request.
 * @param assignment - The workload assignment row for the exact run attempt, or null when absent.
 * @param reservation - The reservation row for the assignment's binding generation, or null when absent.
 * @param now - The instant the caller compares expiries against.
 * @param runtimeNamespaces - When given, the namespaces a runtime may call from; omitted where the
 * token reviewer already pins the namespace.
 * @returns Whether the caller holds the current lease. False is always a safe denial.
 */
export function __ValidateWarmRuntimeLease(identity: WarmRuntimeLeaseIdentity, assignment: WarmRuntimeLeaseAssignmentRow | null, reservation: WarmRuntimeLeaseReservationRow | null, now: Date, runtimeNamespaces?: readonly string[]): boolean
{
	if (assignment === null || reservation === null)
	{
		return false;
	}
	if (runtimeNamespaces !== undefined && !runtimeNamespaces.includes(identity.namespace))
	{
		return false;
	}
	if (assignment.namespace !== identity.namespace || assignment.serviceAccountName !== identity.serviceAccountName || assignment.state !== "Registered" || assignment.revokedAt !== null || assignment.expiresAt.getTime() <= now.getTime() || assignment.workloadKind !== "Deployment")
	{
		return false;
	}
	return reservation.generation === assignment.bindingGeneration
		&& reservation.state === "Claimed"
		&& reservation.namespace === identity.namespace
		&& reservation.serviceAccountName === identity.serviceAccountName
		&& reservation.podUid === identity.podUid
		&& reservation.idleDeadline.getTime() > now.getTime();
}
