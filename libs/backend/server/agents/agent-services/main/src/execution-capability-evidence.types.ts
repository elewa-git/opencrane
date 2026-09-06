import type { RevisionBoundaryAttachment } from "@opencrane/models/agents";
import type { JsonValue } from "@opencrane/util";

/** Immutable revision and current authorization inputs used to derive execution capability evidence. */
export interface ExecutionCapabilityEvidenceInput
{
	/** Silo that owns every input. */
	readonly siloId: string;
	/** Service selected for execution. */
	readonly agentServiceId: string;
	/** Published revision selected for execution. */
	readonly agentRevisionId: string;
	/** Digest of the immutable published revision. */
	readonly agentRevisionDigest: string;
	/** Principal whose current grants were evaluated. */
	readonly principalId: string;
	/** Signed membership revision accepted during this evaluation. */
	readonly fleetMembershipRevision: number;
	/** Digest of the signed membership payload accepted during this evaluation. */
	readonly fleetMembershipPayloadDigest: string;
	/** Durable central-authorization decision digests for Invoke and every declared boundary. */
	readonly authorizationDecisionDigests: readonly string[];
	/** Revision boundaries that survived current authorization. */
	readonly effectiveBoundaryAttachments: readonly RevisionBoundaryAttachment[];
	/** Model definition selected by the immutable revision. */
	readonly modelDefinitionId: string;
	/** Budget selected by the immutable revision. */
	readonly budget: JsonValue;
	/** Immutable skill revisions selected by the revision. */
	readonly skillAssignments: readonly { readonly skillId: string; readonly skillRevisionId: string }[];
	/** Immutable Model Context Protocol tool revisions selected by the revision. */
	readonly mcpToolRevisionIds: readonly string[];
}

/** Canonical capability evidence shared by personal and managed execution admission. */
export interface ExecutionCapabilityEvidence
{
	/** Digest of every immutable revision input and every current authority decision. */
	readonly effectiveContractDigest: string;
	/** Canonically ordered revision boundaries that survived current authorization. */
	readonly effectiveBoundaryAttachments: readonly RevisionBoundaryAttachment[];
	/** Digest of the canonical effective boundary list. */
	readonly effectiveBoundaryAttachmentDigest: string;
	/** Canonically ordered durable central-authorization decision digests. */
	readonly authorizationDecisionDigests: readonly string[];
}
