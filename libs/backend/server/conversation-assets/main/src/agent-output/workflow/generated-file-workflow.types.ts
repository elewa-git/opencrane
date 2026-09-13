import type { IWorkflowTaskReceipt } from "@opencrane/backend/server/infra/workflows/contract";

import type { ConversationGeneratedFileTaskInput } from "../persistence/generated-file-capture.types";

/** Saved file outcomes, or unfinished work that still requires current execution authority. */
export enum GeneratedFileWorkflowStates
{
	/** Encrypted custody is complete and the fixed upload lease still needs one promotion. */
	PromotionRequired = "promotion_required",
	/** The exact promoted revision is quarantined while the existing scanner owns the next decision. */
	ScanPending = "scan_pending",
	/** The scanner published the revision and the conversation asset is ready for authorized reads. */
	Ready = "ready",
	/** The scanner or owning authority recorded a terminal generated-file failure. */
	Failed = "failed",
}

/** Current immutable coordinates reloaded before one workflow advancement. */
export interface GeneratedFileWorkflowSnapshot
{
	/** Requester-owned logical Artifact. */
	readonly artifactId: string;
	/** Reserved first immutable Artifact revision. */
	readonly artifactRevisionId: string;
	/** Exact plaintext byte length bound by custody and the upload lease. */
	readonly byteLength: number;
	/** Lowercase SHA-256 content address of the reconstructed plaintext. */
	readonly contentAddress: string;
	/** Fixed media type admitted from the generated-file tool arguments. */
	readonly mediaType: string;
	/** Original current-authority deadline; the workflow never extends it. */
	readonly notAfterEpochMs: number;
	/** Immutable capture operation whose task, custody and Artifact coordinates were checked. */
	readonly operationId: string;
	/** Current lifecycle state derived by the persistence and Artifact owners. */
	readonly state: GeneratedFileWorkflowStates;
	/** Silo that owns the operation, Artifact and fixed upload lease. */
	readonly siloId: string;
	/** Existing upload lease admitted in the original capture transaction. */
	readonly uploadLeaseId: string;
}

/** Metadata-only command for promoting verified custody bytes through the existing Artifact gateway. */
export interface PromoteGeneratedFileCommand
{
	/** Requester-owned logical Artifact. */
	readonly artifactId: string;
	/** Reserved first immutable Artifact revision. */
	readonly artifactRevisionId: string;
	/** Exact byte length checked before promotion. */
	readonly byteLength: number;
	/** Lowercase SHA-256 address checked before promotion. */
	readonly contentAddress: string;
	/** Verified plaintext bytes held only for this external call and never checkpointed. */
	readonly content: Uint8Array;
	/** Admitted generated-file media type. */
	readonly mediaType: string;
	/** Original execution deadline that the promotion adapter must enforce without extension. */
	readonly notAfterEpochMs: number;
	/** Immutable operation used as the stable promotion idempotency coordinate. */
	readonly operationId: string;
	/** Owning silo. */
	readonly siloId: string;
	/** Original fixed upload lease; an adapter must not issue or refresh another lease. */
	readonly uploadLeaseId: string;
}

/** Content-free receipt saved by the workflow checkpoint after Artifact promotion. */
export interface GeneratedFilePromotionReceipt
{
	/** Exact promoted byte length. */
	readonly byteLength: number;
	/** Lowercase SHA-256 address returned for the stored bytes. */
	readonly contentAddress: string;
	/** Existing lease consumed by this promotion. */
	readonly leaseId: string;
	/** Exact promoted media type. */
	readonly mediaType: string;
	/** Opaque lowercase SHA-256 digest authenticating the promotion receipt. */
	readonly receiptDigest: string;
}

/** External promotion seam that accepts bytes only after current authority and custody verification. */
export interface GeneratedFilePromotionPort
{
	/** Promote exact bytes under the operation's original fixed upload lease. */
	promote(command: PromoteGeneratedFileCommand): Promise<GeneratedFilePromotionReceipt>;
}

/** Closed outcomes from the transaction that admits the promoted revision to quarantine. */
export enum GeneratedFileQuarantineOutcomes
{
	/** The revision entered quarantine in this transaction. */
	Advanced = "advanced",
	/** A concurrent or recovered exact receipt already produced the same quarantine state. */
	Idempotent = "idempotent",
	/** Current execution authority ended before the revision could enter quarantine. */
	AuthorityEnded = "authority_ended",
}

/** Transaction owner used by the workflow to reload authority, open custody and admit quarantine. */
export interface GeneratedFileWorkflowPersistence
{
	/** Recover a saved terminal outcome, or recheck unfinished work and return null after its authority ends. */
	loadCurrent(input: ConversationGeneratedFileTaskInput, task: IWorkflowTaskReceipt, now: Date): Promise<GeneratedFileWorkflowSnapshot | null>;
	/** Recheck current authority and return plaintext only after the encrypted manifest verifies completely. */
	openVerifiedBytes(snapshot: GeneratedFileWorkflowSnapshot, task: IWorkflowTaskReceipt, now: Date): Promise<Uint8Array | null>;
	/** Recheck current authority and atomically admit the exact promotion receipt to quarantine. */
	finalizeQuarantine(snapshot: GeneratedFileWorkflowSnapshot, task: IWorkflowTaskReceipt, receipt: GeneratedFilePromotionReceipt, now: Date): Promise<GeneratedFileQuarantineOutcomes>;
}

/** Dependencies that keep durable persistence and Artifact transport outside orchestration. */
export interface ConversationGeneratedFileWorkflowDependencies
{
	/** Existing Artifact upload gateway composed with fixed-lease authority. */
	readonly promotion: GeneratedFilePromotionPort;
	/** Transaction-scoped operation, custody and quarantine owner. */
	readonly persistence: GeneratedFileWorkflowPersistence;
}

/** Terminal task outcomes saved by Absurd after the product owner reaches a durable state. */
export enum ConversationGeneratedFileWorkflowOutcomes
{
	/** The generated asset reached its authorized Ready state. */
	Ready = "ready",
	/** The existing scanner or product owner recorded a terminal failure. */
	Failed = "failed",
	/** Current execution authority ended before publication completed. */
	AuthorityEnded = "authority_ended",
}

/** Identifier-only result saved by the generated-file task. */
export interface ConversationGeneratedFileWorkflowResult
{
	/** Immutable generated-file operation. */
	readonly operationId: string;
	/** Terminal workflow outcome; it carries no file bytes, keys, lease token or read authority. */
	readonly outcome: ConversationGeneratedFileWorkflowOutcomes;
}
