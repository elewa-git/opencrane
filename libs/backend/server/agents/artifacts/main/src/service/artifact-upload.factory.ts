import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { _CreateArtifactCatalogueRepository, _CreateArtifactUploadAuthority } from "../prisma-artifact-authority.composition";
import { __IssueArtifactReadLease } from "../artifact-read-lease";
import { __UploadArtifact } from "../artifact-upload";
import { IssueArtifactReadLeaseOutcomes, type PublishedArtifactReadTarget } from "../artifact-read-lease.types";
import type { ArtifactUploadResult, VerifiedArtifactUploadCommand } from "../artifact-upload.types";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { _ReadArtifactMountedPem } from "./artifact-mounted-key.loader";
import { _CreateArtifactReadLeaseSigner } from "./artifact-read-lease-signer.factory";
import { _CreateArtifactServiceReadPort, _InternalArtifactServiceUrl } from "./artifact-service-read-port.factory";
import { _CreateArtifactServicePromotionPort } from "./artifact-service-promotion-port";

/**
 * Builds the upload gateway that signs storage leases and publishes verified artifact revisions.
 *
 * The workflow engine reaches the publication repository through this factory. For a PDF, the
 * revision, preprocessing record, and saved task receipt therefore use the same database
 * transaction; a task-admission failure also rejects the publication.
 *
 * Called by: `apps/opencrane/src/index.ts`, which installs the gateway on the public application.
 * @param prisma - Product database client used by the artifact repositories.
 * @param workflow - Guarded engine that saves PDF preprocessing tasks in the publication transaction.
 * @param environment - Deployment paths and the private artifact-service address.
 * @returns The application upload port.
 * @throws Error when the service address or mounted signing keys are missing or invalid.
 */
export function _CreateArtifactUploadGateway(prisma: PrismaClient, workflow: Pick<IWorkflowEngine, "spawn">, environment: NodeJS.ProcessEnv = process.env): { upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult> }
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	const repository = _CreateArtifactUploadAuthority(prisma, workflow);
	return {
		upload(command: VerifiedArtifactUploadCommand): Promise<ArtifactUploadResult>
		{
			return __UploadArtifact(repository, _CreateArtifactServicePromotionPort(serviceUrl), {
				signLease(claims) { return __SignArtifactWriteLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); },
				verifyReceipt(compact) { return __VerifyArtifactPromotionReceipt(compact, receiptPublicKey); },
				digestReceipt(compact) { return `sha256:${createHash("sha256").update(compact, "utf8").digest("hex")}`; },
			}, command);
		},
	};
}

/** Build the server-side path that turns exact published coordinates into verified ArtifactStore bytes. */
export function _CreatePublishedArtifactReader(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): { read(input: PublishedArtifactReadTarget, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> }
{
	const repository = _CreateArtifactCatalogueRepository(prisma);
	return {
		async read(input: PublishedArtifactReadTarget, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>
		{
			signal?.throwIfAborted();
			return ___DoWithTrace("artifact.published-read", { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, async function _ReadArtifact(): Promise<ReadableStream<Uint8Array>>
			{
				const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
				const signLease = _CreateArtifactReadLeaseSigner(environment);
				const readPort = _CreateArtifactServiceReadPort(serviceUrl);
				const issued = await __IssueArtifactReadLease(repository, { sign: signLease }, { siloId: input.siloId, artifactId: input.artifactId, artifactRevisionId: input.artifactRevisionId }, Math.floor(Date.now() / 1_000));
				if (issued.outcome !== IssueArtifactReadLeaseOutcomes.Issued)
					throw new Error("artifact read lease denied");
				signal?.throwIfAborted();
				const response = await readPort.read(issued.compactLease, signal);
				if (response.headers.get("content-length") !== String(issued.claims.byteLength) || response.headers.get("content-type") !== issued.claims.mediaType)
					throw new Error("artifact service read metadata did not match the published revision");
				if (response.body === null)
					throw new Error("artifact service returned no published artifact body");
				return response.body;
			});
		},
	};
}
