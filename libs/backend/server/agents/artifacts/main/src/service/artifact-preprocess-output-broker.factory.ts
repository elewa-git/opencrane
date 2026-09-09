import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { _CreateArtifactPreprocessAuthority } from "../prisma-artifact-authority.composition";
import { __CompleteArtifactPreprocessJob, __IssueArtifactPreprocessOutputLease } from "../artifact-preprocessing";
import type { ArtifactPreprocessOutputBroker } from "../artifact-preprocessing.types";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { _ReadArtifactMountedPem } from "./artifact-mounted-key.loader";
import { _InternalArtifactServiceUrl } from "./artifact-service-read-port.factory";
import { _CreateArtifactServicePromotionPort } from "./artifact-service-promotion-port";

/** Builds the server-side output broker that owns hashing, promotion, receipt verification, and completion. */
export function _CreateArtifactPreprocessOutputBroker(prisma: PrismaClient, maximumOutputBytes: number, environment: NodeJS.ProcessEnv = process.env): ArtifactPreprocessOutputBroker
{
	if (!Number.isSafeInteger(maximumOutputBytes) || maximumOutputBytes <= 0)
	{
		throw new Error("maximumOutputBytes must be a positive safe integer");
	}
	const jobs = _CreateArtifactPreprocessAuthority(prisma);
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const promotionPort = _CreateArtifactServicePromotionPort(serviceUrl);
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	return {
		async publish(command, bytes)
		{
			return ___DoWithTrace("artifact-preprocessor.output.broker", { jobId: command.jobId, attempt: command.attempt }, async function _PublishOutput()
			{
				// 1. Observe and hash the exact bounded body before granting any storage authority.
				const output = await _CollectBounded(bytes, maximumOutputBytes);
				const contentAddress = `sha256:${createHash("sha256").update(output).digest("hex")}`;
				const issued = await __IssueArtifactPreprocessOutputLease(jobs, { ...command, contentAddress, byteLength: output.byteLength });
				if (issued === null)
					return "conflict";
				if (issued === "completed")
					return "completed";

				// 2. Sign and consume the exact-byte write lease entirely inside OpenCrane.
				const compactLease = __SignArtifactWriteLease(issued.writeLease, leasePrivateKey, Math.floor(Date.now() / 1_000));
				const promoted = await promotionPort.promote(compactLease, _OneBuffer(output));
				const promotion = __VerifyArtifactPromotionReceipt(promoted.receipt, receiptPublicKey);
				if (promotion === null)
					throw new Error("artifact service returned an invalid promotion receipt");

				// 3. Commit the verified receipt, generated revision, lineage, and job atomically.
				const completed = await __CompleteArtifactPreprocessJob(jobs, { ...command, derivedRevisionId: issued.derivedRevisionId, promotion, receiptDigest: `sha256:${createHash("sha256").update(promoted.receipt, "utf8").digest("hex")}` });
				return completed ? "completed" : "conflict";
			});
		},
	};
}

/** Collect one untrusted stream under the configured raw-body ceiling. */
async function _CollectBounded(bytes: AsyncIterable<Uint8Array>, maximumBytes: number): Promise<Buffer>
{
	const chunks: Buffer[] = [];
	let length = 0;
	for await (const chunk of bytes)
	{
		length += chunk.byteLength;
		if (length > maximumBytes)
			throw new Error("artifact preprocess output exceeded the configured byte limit");
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks, length);
}

/** Hand an already size-checked output buffer to the promotion port without copying it again. */
async function* _OneBuffer(buffer: Buffer): AsyncGenerator<Uint8Array>
{
	yield buffer;
}
