import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import type { ComputerLease, ComputerWorkspaceCheckpoint, ConversationComputer } from "@opencrane/contracts";

import { _DeterministicUuid } from "./agent-session-identifiers";
import type { ConversationComputerCheckpointCatalogue, ConversationComputerCheckpointFence, ConversationComputerCheckpointPolicy, ConversationComputerCheckpointReader, ConversationComputerCheckpointRestoreCommand, ConversationComputerCheckpointRestoreResult, ConversationComputerCheckpointSandbox, ConversationComputerCheckpointUploader } from "./conversation-computer-checkpoint.types";

/** Owns deterministic Artifact publication and exact-revision restoration for computer workspaces. */
export class ConversationComputerCheckpointAuthority
{
	/** Binds sandbox transport to the shared governed artifact seams. */
	public constructor(private readonly sandbox: ConversationComputerCheckpointSandbox, private readonly catalogue: ConversationComputerCheckpointCatalogue, private readonly uploader: ConversationComputerCheckpointUploader, private readonly reader: ConversationComputerCheckpointReader, private readonly fence: ConversationComputerCheckpointFence, private readonly policy: ConversationComputerCheckpointPolicy, private readonly now: () => Date = function _Now() { return new Date(); })
	{
		if (!Number.isSafeInteger(policy.maximumBytes) || policy.maximumBytes <= 0 || !Number.isSafeInteger(policy.uploadLeaseSeconds) || policy.uploadLeaseSeconds <= 0 || !policy.format)
			throw new Error("Conversation computer checkpoint policy is invalid");
	}

	/** Captures, hashes, promotes, and commits one immutable revision before returning history data. */
	public async capture(computer: ConversationComputer, lease: ComputerLease): Promise<ComputerWorkspaceCheckpoint>
	{
		// 1. Materialize the bounded sandbox response so the write lease binds its exact hash and size.
		const bytes = await _CollectBounded(await this.sandbox.capture(computer, lease), this.policy.maximumBytes);
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		const artifactId = _CheckpointArtifactId(computer.id);
		const revision = lease.generation;
		const artifactRevisionId = _CheckpointRevisionId(computer.id, revision);
		const acceptedAt = this.now();

		// 2. Ensure the stable generated aggregate exists before using the common artifact publication path.
		await this.catalogue.ensureGeneratedArtifact({ artifactId, siloId: computer.siloId, ownerPrincipalId: computer.agentIdentityId });
		const stableExpiry = Math.floor(Date.parse(lease.expiresAt) / 1_000);
		const result = await this.uploader.upload({ artifactId, siloId: computer.siloId, capabilityJti: _DeterministicUuid("computer-checkpoint-upload", computer.id, String(revision)), expectedContentAddress: digest, expectedByteLength: bytes.byteLength, mediaType: "application/vnd.opencrane.workspace-tar+gzip", expiresAtEpochSeconds: stableExpiry, createdBy: computer.agentIdentityId, revision, artifactRevisionId, provenance: { source: "conversation_computer_checkpoint", computerId: computer.id, leaseId: lease.id, generation: lease.generation }, idempotencyKey: _DeterministicUuid("computer-checkpoint-finalize", computer.id, String(revision)), bytes: _OneBuffer(bytes) });
		if (result.outcome !== "finalized")
			throw new Error(`Conversation computer checkpoint publication failed: ${result.reason}`);

		// 3. Return history coordinates only after ArtifactStore promotion and catalogue commit both succeed.
		return { artifactRevisionId, digest, format: this.policy.format, checkpointedAt: acceptedAt.toISOString() };
	}

	/** Rechecks the TokenReviewed Pod fence and restores only the current exact published revision. */
	public async restore(command: ConversationComputerCheckpointRestoreCommand): Promise<ConversationComputerCheckpointRestoreResult | null>
	{
		const current = await this.fence.assertCurrent(command);
		const checkpoint = current.computer.workspaceCheckpoint;
		if (checkpoint === null)
			return null;
		if (checkpoint.format !== this.policy.format || current.lease.id !== command.lease.leaseId || current.lease.generation !== command.lease.leaseGeneration)
			throw new Error("Conversation computer checkpoint restore fence changed");
		const artifactId = _CheckpointArtifactId(current.computer.id);
		const body = await this.reader.read({ siloId: current.computer.siloId, artifactId, artifactRevisionId: checkpoint.artifactRevisionId });
		const bytes = await _CollectBounded(_WebBytes(body), this.policy.maximumBytes);
		const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		if (digest !== checkpoint.digest)
			throw new Error("Conversation computer checkpoint digest did not match history");
		await this.sandbox.restore(current.computer, current.lease, _OneBuffer(bytes));
		return { outcome: "restored", artifactRevisionId: checkpoint.artifactRevisionId };
	}
}

/** Derive the one generated artifact identity retained across computer generations. */
export function _CheckpointArtifactId(computerId: string): string { return _DeterministicUuid("computer-checkpoint-artifact", computerId); }

/** Derive exactly one immutable revision id per lease generation. */
export function _CheckpointRevisionId(computerId: string, generation: number): string { return _DeterministicUuid("computer-checkpoint-revision", computerId, String(generation)); }

/** Buffer an untrusted sandbox stream under the release-owned checkpoint ceiling. */
async function _CollectBounded(source: AsyncIterable<Uint8Array>, maximumBytes: number): Promise<Buffer>
{
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of source)
	{
		length += chunk.byteLength;
		if (length > maximumBytes)
			throw new Error("Conversation computer checkpoint exceeded the byte limit");
		chunks.push(Buffer.from(chunk));
	}
	if (length === 0)
		throw new Error("Conversation computer checkpoint was empty");
	return Buffer.concat(chunks, length);
}

/** Stream one already bounded buffer through the artifact promotion port. */
async function* _OneBuffer(bytes: Buffer): AsyncGenerator<Uint8Array> { yield bytes; }

/** Adapt a verified Web response body to the sandbox streaming port. */
async function* _WebBytes(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array>
{
	for await (const chunk of Readable.fromWeb(body as never))
		yield chunk;
}
