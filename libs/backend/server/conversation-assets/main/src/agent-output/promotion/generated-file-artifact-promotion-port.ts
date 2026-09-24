import { createHash } from "node:crypto";

import type { ArtifactServicePromotionPort, ArtifactUploadCryptoPort } from "@opencrane/backend/server/agents/artifacts";
import { WorkflowTaskTerminalError } from "@opencrane/backend/server/infra/workflows/contract";
import { GENERATED_CSV_LIMITS, GENERATED_CSV_MEDIA_TYPE } from "@opencrane/models/conversation-assets";

import type { GeneratedFilePromotionAuthority, GeneratedFilePromotionAuthorityCommand, GeneratedFilePromotionAuthorityEvidence } from "./generated-file-promotion.types";
import type { GeneratedFilePromotionPort, GeneratedFilePromotionReceipt, PromoteGeneratedFileCommand } from "../workflow/generated-file-workflow.types";

/** Exact digest syntax accepted for captured content and verified receipt evidence. */
const _SHA256 = /^sha256:[0-9a-f]{64}$/u;

/** Promotes verified generated-file bytes under the original transaction-admitted Artifact lease. */
export class GeneratedFileArtifactPromotionPort implements GeneratedFilePromotionPort
{
	/** Compose current fixed-lease authority with the existing Artifact transport and crypto ports. */
	constructor(
		private readonly authority: GeneratedFilePromotionAuthority,
		private readonly service: ArtifactServicePromotionPort,
		private readonly crypto: ArtifactUploadCryptoPort,
	) {}

	/** Reload current authority, sign the original lease, and return only verified receipt metadata. */
	async promote(command: PromoteGeneratedFileCommand): Promise<GeneratedFilePromotionReceipt>
	{
		_ValidateCommand(command);
		const authorityCommand = _AuthorityCommand(command);
		const checkedAt = new Date();
		const evidence = await this.authority.admitCurrent(authorityCommand, checkedAt);
		if (evidence === null)
			throw new WorkflowTaskTerminalError("Generated file promotion authority ended");
		_ValidateEvidence(authorityCommand, evidence, checkedAt);

		const compactLease = this.crypto.signLease(evidence.lease);
		const promoted = await this.service.promote(compactLease, _OneContent(command.content));
		const receipt = this.crypto.verifyReceipt(promoted.receipt);
		if (receipt === null || receipt.leaseId !== evidence.lease.leaseId || receipt.contentAddress !== command.contentAddress
			|| receipt.byteLength !== command.byteLength || receipt.mediaType !== command.mediaType)
			throw new WorkflowTaskTerminalError("Generated file promotion receipt was rejected");
		const receiptDigest = this.crypto.digestReceipt(promoted.receipt);
		if (!_SHA256.test(receiptDigest))
			throw new WorkflowTaskTerminalError("Generated file promotion receipt digest was rejected");
		return { leaseId: receipt.leaseId, contentAddress: receipt.contentAddress, byteLength: receipt.byteLength, mediaType: receipt.mediaType, receiptDigest };
	}
}

/** Validate exact bounded command fields and complete plaintext identity before authority lookup. */
function _ValidateCommand(command: PromoteGeneratedFileCommand): void
{
	const contentAddress = command.content instanceof Uint8Array ? `sha256:${createHash("sha256").update(command.content).digest("hex")}` : null;
	if (![command.siloId, command.operationId, command.artifactId, command.artifactRevisionId, command.uploadLeaseId].every(_Coordinate)
		|| command.mediaType !== GENERATED_CSV_MEDIA_TYPE || !Number.isSafeInteger(command.byteLength) || command.byteLength < 1 || command.byteLength > GENERATED_CSV_LIMITS.generatedBytes
		|| contentAddress === null || command.content.byteLength !== command.byteLength || contentAddress !== command.contentAddress
		|| !Number.isSafeInteger(command.notAfterEpochMs) || command.notAfterEpochMs <= Date.now())
		throw new WorkflowTaskTerminalError("Generated file promotion command is invalid");
}

/** Require the authority answer to be the original unexpired fixed lease and deadline. */
function _ValidateEvidence(command: GeneratedFilePromotionAuthorityCommand, evidence: GeneratedFilePromotionAuthorityEvidence, checkedAt: Date): void
{
	const lease = evidence.lease;
	const expiresAtEpochMs = lease.expiresAtEpochSeconds * 1_000;
	if (evidence.notAfterEpochMs !== command.notAfterEpochMs || !Number.isSafeInteger(evidence.notAfterEpochMs) || evidence.notAfterEpochMs <= checkedAt.getTime()
		|| lease.action !== "artifact.write" || lease.leaseId !== command.uploadLeaseId || lease.siloId !== command.siloId || lease.artifactId !== command.artifactId
		|| lease.expectedContentAddress !== command.contentAddress || lease.expectedByteLength !== command.byteLength || lease.mediaType !== command.mediaType
		|| !Number.isSafeInteger(lease.expiresAtEpochSeconds) || expiresAtEpochMs <= checkedAt.getTime() || expiresAtEpochMs > command.notAfterEpochMs)
		throw new WorkflowTaskTerminalError("Generated file fixed upload lease is invalid");
}

/** Remove plaintext before asking the transaction owner to recheck the operation and lease. */
function _AuthorityCommand(command: PromoteGeneratedFileCommand): GeneratedFilePromotionAuthorityCommand
{
	return { siloId: command.siloId, operationId: command.operationId, artifactId: command.artifactId, artifactRevisionId: command.artifactRevisionId, uploadLeaseId: command.uploadLeaseId, contentAddress: command.contentAddress, byteLength: command.byteLength, mediaType: command.mediaType, notAfterEpochMs: command.notAfterEpochMs };
}

/** Yield one already-bounded immutable buffer to the existing streaming Artifact transport. */
async function* _OneContent(content: Uint8Array): AsyncGenerator<Uint8Array>
{
	yield content;
}

/** Reject empty, normalized, control-bearing or unbounded authority coordinates. */
function _Coordinate(value: unknown): value is string
{
	return typeof value === "string" && value.length > 0 && value.length <= 512 && value === value.trim() && !/[\p{Cc}]/u.test(value);
}
