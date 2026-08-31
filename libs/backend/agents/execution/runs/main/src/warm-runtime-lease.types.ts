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
