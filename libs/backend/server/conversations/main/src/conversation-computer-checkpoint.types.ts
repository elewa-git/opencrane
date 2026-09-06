import type { ComputerLease, ComputerWorkspaceCheckpoint, ConversationComputer, LeaseScope } from "@opencrane/contracts";
import type { ArtifactUploadResult, VerifiedArtifactUploadCommand } from "@opencrane/backend/server/agents/artifacts";

/** Supplies the release-fixed format and byte ceiling for durable computer workspaces. */
export interface ConversationComputerCheckpointPolicy
{
	/** Names the format understood by both capture and restore. */
	readonly format: string;
	/** Rejects a sandbox response larger than this byte count. */
	readonly maximumBytes: number;
	/** Limits the storage write lease issued for checkpoint promotion. */
	readonly uploadLeaseSeconds: number;
}

/** Streams checkpoint archives to and from the exact current sandbox lease. */
export interface ConversationComputerCheckpointSandbox
{
	/** Captures bytes from the lease-local workspace endpoint. */
	capture(computer: ConversationComputer, lease: ComputerLease): Promise<AsyncIterable<Uint8Array>>;
	/** Restores verified bytes into the lease-local workspace endpoint. */
	restore(computer: ConversationComputer, lease: ComputerLease, bytes: AsyncIterable<Uint8Array>): Promise<void>;
}

/** Creates the one generated Artifact aggregate owned by a logical computer. */
export interface ConversationComputerCheckpointCatalogue
{
	/** Ensures the deterministic generated Artifact exists before revision upload. */
	ensureGeneratedArtifact(input: { readonly artifactId: string; readonly siloId: string; readonly ownerPrincipalId: string }): Promise<void>;
}

/** Promotes an already-authorized immutable checkpoint revision. */
export interface ConversationComputerCheckpointUploader
{
	/** Uses the shared artifact upload authority and returns only after publication commits. */
	upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult>;
}

/** Reads an exact published checkpoint revision from ArtifactStore. */
export interface ConversationComputerCheckpointReader
{
	/** Returns the exact immutable revision bytes selected by trusted coordinates. */
	read(input: { readonly siloId: string; readonly artifactId: string; readonly artifactRevisionId: string }): Promise<ReadableStream<Uint8Array>>;
}

/** Rechecks current history and Pod identity immediately before checkpoint restoration. */
export interface ConversationComputerCheckpointFence
{
	/** Rejects a stale generation, lease, or Pod token binding. */
	assertCurrent(input: ConversationComputerCheckpointRestoreCommand): Promise<{ readonly computer: ConversationComputer; readonly lease: ComputerLease }>;
}

/** Restores one exact current checkpoint under a TokenReviewed Pod identity. */
export interface ConversationComputerCheckpointRestoreCommand
{
	/** Trusted silo selected by server composition. */
	readonly siloId: string;
	/** Logical computer supplied by the private route. */
	readonly computerId: string;
	/** Lease and generation the Pod claims to hold; the fence checks both against current history. */
	readonly lease: LeaseScope;
	/** Pod UID returned by Kubernetes TokenReview. */
	readonly podUid: string;
}

/** Result returned after one exact immutable workspace revision is restored. */
export interface ConversationComputerCheckpointRestoreResult
{
	/** Names the immutable revision that was streamed to the sandbox. */
	readonly artifactRevisionId: string;
	/** Confirms that sandbox restoration completed. */
	readonly outcome: "restored";
}

/** Durable checkpoint store contract used by the lifecycle authority. */
export interface ConversationComputerCheckpointCapture
{
	/** Captures and publishes the exact lease workspace. */
	capture(computer: ConversationComputer, lease: ComputerLease): Promise<ComputerWorkspaceCheckpoint>;
}
