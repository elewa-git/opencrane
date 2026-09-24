import type { ManagedAgentIdentity } from "@opencrane/contracts";
import type { ExecutionSubjectHumanMembershipEvidence, ExecutionSubjectManagedMembershipEvidence } from "@opencrane/models/agents";

import type { ExecutionCapabilityEvidence } from "./execution-capability-evidence.types";
import type { ManagedAgentRevisionEvidence } from "../company-assistants/managed-agent.types";
import type { PersonalExecutionEvidenceTransaction } from "./personal-execution-evidence.types";

/** Keeps the checked company identity separate from the human requesting one run. */
export interface ManagedExecutionEvidenceCommand
{
	readonly identity: ManagedAgentIdentity;
	readonly requesterPrincipalId: string;
	readonly agentRevisionId: string;
}

/** Contains current managed execution authority and independent human invocation evidence. */
export interface ManagedExecutionEvidence
{
	readonly revision: ManagedAgentRevisionEvidence;
	readonly membership: ExecutionSubjectManagedMembershipEvidence;
	readonly requesterMembership: ExecutionSubjectHumanMembershipEvidence;
	readonly capability: ExecutionCapabilityEvidence;
	readonly admissionDecisionDigest: string;
}

/** Explains which current authority refused managed execution. */
export enum ManagedExecutionEvidenceDenialReasons
{
	/** The active company identity does not realize the stored Internal Principal. */
	IdentityUnavailable = "identity_unavailable",
	/** The service or selected published revision is no longer runnable. */
	RunNotAdmittable = "run_not_admittable",
	/** The requesting human no longer has current silo membership. */
	MembershipStale = "membership_stale",
	/** Human Invoke or the company's own model Use permission was denied. */
	CapabilityUnavailable = "product_authorization_unavailable",
}

/** Returns evidence only after all current checks succeed in the admission transaction. */
export type ManagedExecutionEvidenceResult = { readonly outcome: "loaded"; readonly value: ManagedExecutionEvidence } | { readonly outcome: "denied"; readonly reason: ManagedExecutionEvidenceDenialReasons };

/** Rechecks current managed and requester authority before an execution subject is frozen. */
export interface ManagedExecutionEvidenceAuthorityPort
{
	load(command: ManagedExecutionEvidenceCommand, transaction: PersonalExecutionEvidenceTransaction): Promise<ManagedExecutionEvidenceResult>;
}
