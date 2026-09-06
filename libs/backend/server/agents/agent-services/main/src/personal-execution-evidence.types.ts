import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";
import type { TrustedFleetMembershipEvidence } from "@opencrane/backend/server/iam/membership";
import type { ProxiedAgentIdentity } from "@opencrane/contracts";
import type { RevisionBoundaryAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

import type { ExecutionCapabilityEvidence } from "./execution-capability-evidence.types";

/** Exact personal identity, requester, service, and revision coordinates presented for rechecking. */
export interface PersonalExecutionEvidenceCommand
{
	/** Current identity head already verified by the Kurrent identity-history authority. */
	readonly identity: ProxiedAgentIdentity;
	/** Authenticated local Principal that requested this personal execution. */
	readonly requesterPrincipalId: string;
	/** Exact published personal service revision selected by the conversation. */
	readonly agentRevisionId: string;
}

/** Current authority inputs supplied by the run-admission transaction. */
export interface PersonalExecutionEvidenceTransaction
{
	/** Central authorization methods bound to the run-admission transaction. */
	readonly authorization: Pick<AuthorizationAuthority, "admit" | "admitPrincipal">;
	/** Server-owned admission time in epoch milliseconds. */
	readonly admittedAtEpochMs: number;
}

/** Immutable personal revision facts loaded by the transaction-bound Prisma repository. */
export interface PersonalExecutionRevisionEvidence
{
	/** Exact active published revision identifier. */
	readonly id: string;
	/** Digest of the immutable revision. */
	readonly digest: string;
	/** Model definition selected by the revision. */
	readonly modelDefinitionId: string;
	/** Budget selected by the revision. */
	readonly budget: JsonValue;
	/** Structurally valid boundary attachments selected by the revision. */
	readonly boundaryAttachments: readonly RevisionBoundaryAttachment[];
	/** Immutable skill revisions selected by the revision. */
	readonly skillAssignments: readonly { readonly skillId: string; readonly skillRevisionId: string }[];
	/** Immutable Model Context Protocol tool revisions selected by the revision. */
	readonly mcpToolRevisionIds: readonly string[];
}

/** Narrow persistence port consumed by personal execution authority. */
export interface PersonalExecutionEvidenceRepository
{
	/** Loads only the exact active Personal service revision, or null when it is not runnable. */
	loadActiveRevision(siloId: string, agentServiceId: string, agentRevisionId: string): Promise<PersonalExecutionRevisionEvidence | null>;
	/** Selects and verifies one current signed membership assertion without caller-selected evidence. */
	verifyCurrentMembership(siloId: string, principalId: string, nowEpochMs: number): Promise<TrustedFleetMembershipEvidence | null>;
}

/** Personal identity coordinates that survived current authority checks. */
export interface PersonalExecutionIdentityCoordinates
{
	/** Silo shared by the identity, service, Principal, membership, and revision. */
	readonly siloId: string;
	/** Exact active proxied identity checked by the caller's history authority. */
	readonly agentIdentityId: string;
	/** Exact active personal service realized by the identity. */
	readonly agentServiceId: string;
	/** Exact active published revision selected for execution. */
	readonly agentRevisionId: string;
	/** Human Principal through which the personal identity acts. */
	readonly principalId: string;
	/** Delegation policy named by the verified proxied identity head. */
	readonly delegationPolicyId: string;
}

/** Signed membership evidence accepted for the personal execution Principal. */
export interface PersonalExecutionEvidenceMembership
{
	/** Monotonic signed membership revision accepted at admission. */
	readonly revision: number;
	/** Trusted issuer that signed the accepted membership assertion. */
	readonly issuerId: string;
	/** Key identifier the trusted issuer used to sign the assertion. */
	readonly issuerKeyId: string;
	/** Exact accepted assertion identifier. */
	readonly assertionId: string;
	/** SHA-256 digest of the accepted signed membership payload. */
	readonly payloadDigest: string;
	/** Instant after which the assertion must no longer be accepted. */
	readonly trustedUntil: string;
}

/** Checked evidence needed by the execution-subject authority. */
export interface PersonalExecutionEvidence
{
	/** Personal identity and Principal coordinates checked against current service state. */
	readonly identity: PersonalExecutionIdentityCoordinates;
	/** Current signed membership evidence for the proxied Principal. */
	readonly membership: PersonalExecutionEvidenceMembership;
	/** Canonical effective contract and durable authorization decisions. */
	readonly capability: ExecutionCapabilityEvidence;
	/** Durable Invoke decision kept separate for the final run-admission evidence binding. */
	readonly admissionDecisionDigest: string;
}

/** Stable reasons why personal execution evidence cannot be issued. */
export enum PersonalExecutionEvidenceDenialReasons
{
	/** The checked identity is not an active proxied identity for this requester and service. */
	IdentityUnavailable = "identity_unavailable",
	/** The personal service or exact published revision is no longer active. */
	RunNotAdmittable = "run_not_admittable",
	/** Current signed silo membership is absent, invalid, ambiguous, or stale. */
	MembershipStale = "membership_stale",
	/** One or more current central-authorization decisions refused the effective contract. */
	CapabilityUnavailable = "capability_unavailable",
}

/** Result of one personal execution-evidence load. */
export type PersonalExecutionEvidenceResult =
	| { readonly outcome: "loaded"; readonly value: PersonalExecutionEvidence }
	| { readonly outcome: "denied"; readonly reason: PersonalExecutionEvidenceDenialReasons };

/** Rechecks personal execution authority inside the transaction that persists the run. */
export interface PersonalExecutionEvidenceAuthorityPort
{
	/** Loads current service, membership, revision, and authorization evidence without fabricating history facts. */
	load(command: PersonalExecutionEvidenceCommand, transaction: PersonalExecutionEvidenceTransaction): Promise<PersonalExecutionEvidenceResult>;
}
