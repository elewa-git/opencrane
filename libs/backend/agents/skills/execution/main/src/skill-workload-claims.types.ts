import type { AgentControllerSkillWorkloadAssignmentCommand, AgentControllerSkillWorkloadClaim, AgentControllerSkillWorkloadPodRegistrationCommand, AgentControllerSkillWorkloadReleaseClaim, AgentControllerSkillWorkloadReleaseCommand } from "@opencrane/contracts";

/** Persistence authority for controller-only workload claim and suspended-Job assignment. */
export interface SkillWorkloadClaimsRepository
{
	/** Claims one pending workload or returns no current controller work. */
	claimNextAtomically(): Promise<AgentControllerSkillWorkloadClaim | null>;
	/** Binds one exact claim generation to the Kubernetes-issued immutable Job UID. */
	commitAssignmentAtomically(workloadId: string, command: AgentControllerSkillWorkloadAssignmentCommand): Promise<"assigned" | "idempotent" | "conflict">;
	/** Claims one assigned, bootstrap-ready Job for a fenced Kubernetes unsuspend operation. */
	claimNextReleaseAtomically(): Promise<AgentControllerSkillWorkloadReleaseClaim | null>;
	/** Records an exact successful unsuspend or its idempotent replay. */
	commitReleaseAtomically(workloadId: string, command: AgentControllerSkillWorkloadReleaseCommand): Promise<"released" | "idempotent" | "conflict">;
	/** Binds the sole Job-owned worker Pod before its bootstrap can be consumed. */
	registerFirstPodAtomically(workloadId: string, command: AgentControllerSkillWorkloadPodRegistrationCommand): Promise<"registered" | "idempotent" | "conflict">;
}
