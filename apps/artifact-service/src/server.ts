import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { __FilesystemArtifactStore } from "@opencrane/backend/artifacts/filesystem";
import { __SignArtifactPromotionReceipt, __VerifyArtifactWriteLease } from "@opencrane/backend/artifacts/authorization";
import { __PromoteArtifactUpload } from "@opencrane/backend/artifacts/store";
import type { ArtifactPromotionLeaseVerifier, ArtifactPromotionReceiptSigner, ArtifactStore, BoundedArtifactUploadByteSource, PromoteArtifactUploadResult } from "@opencrane/backend/artifacts/store";
import { ___DoWithTrace } from "@opencrane/observability";

import type { ArtifactServiceProcessConfig } from "./config.types.js";
import { _log as log } from "./log.js";

/** Prepare the mounted canonical-byte root before admitting health traffic. */
export async function _PrepareArtifactStore(config: ArtifactServiceProcessConfig): Promise<__FilesystemArtifactStore>
{
	return ___DoWithTrace("artifact-service.prepare-store", { artifactRoot: config.artifactRoot }, async function _prepareStore()
	{
		await mkdir(config.artifactRoot, { recursive: true, mode: 0o700 });
		return new __FilesystemArtifactStore({ rootPath: config.artifactRoot });
	});
}

/** Create the private server, which accepts only OpenCrane-signed, bounded write leases. */
export function _CreateServer(config: ArtifactServiceProcessConfig, store: ArtifactStore): Server
{
	return createServer(function _handle(request, response)
	{
		const path = new URL(request.url ?? "/", "http://localhost").pathname;
		void ___DoWithTrace("artifact-service.request", { method: request.method ?? "UNKNOWN", path }, async function _handleRequest()
		{
			if (path === "/livez" || path === "/readyz")
			{
				response.writeHead(204);
				response.end();
				return;
			}
			if (path !== "/v1/artifacts/promote" || request.method !== "POST")
			{
				response.writeHead(404, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "not_found" }));
				return;
			}
			const outcome = await __PromoteArtifactUpload(store, _leaseVerifier(config.leasePublicKeyPem), _byteSource(request), { maxUploadDurationMilliseconds: config.maxUploadDurationMilliseconds, nowEpochMilliseconds: Date.now, receiptSigner: _receiptSigner(config.receiptPrivateKeyPem) });
			_writePromotionOutcome(response, outcome);
		}).catch(function _onRequestFailure(err)
		{
			log.error({ err, method: request.method, path }, "artifact service request failed");
			response.destroy(err instanceof Error ? err : new Error("artifact service request failed"));
		});
	});
}

/** Adapts the app-owned OpenCrane public key to the storage-neutral lease verifier port. */
function _leaseVerifier(leasePublicKeyPem: string): ArtifactPromotionLeaseVerifier
{
	return { verify(compactLease, nowEpochSeconds) { return __VerifyArtifactWriteLease(compactLease, leasePublicKeyPem, nowEpochSeconds); } };
}

/** Adapts the app-owned receipt key to the storage-neutral receipt signer port. */
function _receiptSigner(receiptPrivateKeyPem: string): ArtifactPromotionReceiptSigner
{
	return { sign(claims) { return __SignArtifactPromotionReceipt(claims, receiptPrivateKeyPem); } };
}

/** Exposes only the HTTP request primitives the promotion protocol needs to bound byte ingestion. */
function _byteSource(request: IncomingMessage): BoundedArtifactUploadByteSource
{
	const contentLength = request.headers["content-length"];
	const compactLease = request.headers["x-opencrane-artifact-lease"];
	return {
		compactLease: typeof compactLease === "string" ? compactLease : null,
		declaredByteLength: typeof contentLength === "string" ? contentLength : null,
		bytes: request,
		abort(reason) { request.destroy(reason); },
	};
}

/** Translates stable storage-domain outcomes into the private HTTP endpoint contract. */
function _writePromotionOutcome(response: ServerResponse, outcome: PromoteArtifactUploadResult): void
{
	if (outcome.outcome === "promoted")
	{
		response.writeHead(201, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(JSON.stringify({ ...outcome.promotion, receipt: outcome.receipt }));
		return;
	}
	if (outcome.outcome === "deadline_exceeded")
	{
		if (!response.destroyed) response.destroy(new Error("artifact upload exceeded its absolute lease-bound deadline"));
		return;
	}
	const status = outcome.reason === "artifact_body_exceeds_lease" ? 413 : 403;
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify({ error: outcome.reason }));
}
