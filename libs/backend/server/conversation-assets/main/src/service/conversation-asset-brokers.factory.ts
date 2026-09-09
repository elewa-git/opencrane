import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { _CreateArtifactCatalogueRepository, __IssueArtifactReadLease, IssueArtifactReadLeaseOutcomes } from "@opencrane/backend/server/agents/artifacts";
import { ___DoWithTrace } from "@opencrane/backend/observability";
import { PrismaConversationAssetUnitOfWork } from "../prisma-conversation-asset-unit-of-work";
import type { ConversationAssetContentBroker, ConversationAssetReadTarget } from "../conversation-asset-content.types";
import { _ReadArtifactMountedPem } from "@opencrane/backend/server/agents/artifacts";
import { _CreateArtifactReadLeaseSigner } from "@opencrane/backend/server/agents/artifacts";
import { _CreateArtifactServiceReadPort, _InternalArtifactServiceUrl } from "@opencrane/backend/server/agents/artifacts";
import { _CreateArtifactServicePromotionPort } from "@opencrane/backend/server/agents/artifacts";

/** Build the participant conversation-file authority without exposing its write leases. */
export function _CreateConversationAssetAuthority(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env, scannerAvailable = true): PrismaConversationAssetUnitOfWork
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const leasePrivateKey = _ReadArtifactMountedPem(environment.ARTIFACT_LEASE_PRIVATE_KEY_PATH, "ARTIFACT_LEASE_PRIVATE_KEY_PATH");
	const receiptPublicKey = _ReadArtifactMountedPem(environment.ARTIFACT_RECEIPT_PUBLIC_KEY_PATH, "ARTIFACT_RECEIPT_PUBLIC_KEY_PATH");
	return new PrismaConversationAssetUnitOfWork(prisma, _CreateArtifactServicePromotionPort(serviceUrl), {
		signLease(claims) { return __SignArtifactWriteLease(claims, leasePrivateKey, Math.floor(Date.now() / 1_000)); },
		verifyReceipt(compact) { return __VerifyArtifactPromotionReceipt(compact, receiptPublicKey); },
		digestReceipt(compact) { return `sha256:${createHash("sha256").update(compact, "utf8").digest("hex")}`; }
	}, _CreateConversationAssetContentBroker(prisma, environment), scannerAvailable);
}

/** Build the private broker that turns an authorized ready asset into exact published bytes. */
export function _CreateConversationAssetContentBroker(prisma: PrismaClient, environment: NodeJS.ProcessEnv = process.env): ConversationAssetContentBroker
{
	const serviceUrl = _InternalArtifactServiceUrl(environment.ARTIFACT_SERVICE_URL ?? "");
	const repository = _CreateArtifactCatalogueRepository(prisma);
	const signer = { sign: _CreateArtifactReadLeaseSigner(environment) };
	const readPort = _CreateArtifactServiceReadPort(serviceUrl);
	return {
		async open(target: ConversationAssetReadTarget): Promise<AsyncIterable<Uint8Array> | null>
		{
			return ___DoWithTrace("conversation.asset.content-broker", { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId }, async function _ReadContent(): Promise<AsyncIterable<Uint8Array> | null>
			{
				const issued = await __IssueArtifactReadLease(repository, signer, { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId }, Math.floor(Date.now() / 1_000));
				if (issued.outcome !== IssueArtifactReadLeaseOutcomes.Issued)
					return null;
				if (issued.claims.byteLength !== target.byteLength || issued.claims.mediaType !== target.mediaType)
					return null;
				const response = await readPort.read(issued.compactLease);
				if (response.headers.get("content-length") !== String(target.byteLength) || response.headers.get("content-type") !== target.mediaType)
					throw new Error("artifact service read metadata did not match the ready conversation asset");
				if (response.body === null)
					throw new Error("artifact service returned no conversation asset body");
				return _ResponseBytes(response.body);
			});
		}
	};
}

/** Yield a private HTTP response body and cancel its reader if the browser disconnects early. */
async function* _ResponseBytes(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array>
{
	const reader = body.getReader();
	let complete = false;
	try
	{
		while (true)
		{
			const next = await reader.read();
			if (next.done)
			{
				complete = true;
				return;
			}
			yield next.value;
		}
	}
	finally
	{
		if (!complete)
			await reader.cancel().catch(function _IgnoreCancellationFailure(): void {});
		reader.releaseLock();
	}
}
