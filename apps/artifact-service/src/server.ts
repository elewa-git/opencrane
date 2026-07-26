import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { __FilesystemArtifactStore } from "@opencrane/backend/artifacts/filesystem";
import { __SignArtifactPromotionReceipt, __VerifyArtifactReadLease, __VerifyArtifactWriteLease } from "@opencrane/backend/artifacts/authorization";
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
			if (path === "/v1/artifacts/promote" && request.method === "POST")
			{
				const byteSource = _byteSource(request);
				const outcome = await __PromoteArtifactUpload(store, _leaseVerifier(config.leasePublicKeyPem), byteSource, { maxUploadDurationMilliseconds: config.maxUploadDurationMilliseconds, nowEpochMilliseconds: Date.now, receiptSigner: _receiptSigner(config.receiptPrivateKeyPem) });
				_writePromotionOutcome(response, outcome);
				if (outcome.outcome === "rejected" && outcome.reason === "artifact_body_exceeds_lease")
				{
					byteSource.abort(new Error("artifact body exceeds its signed lease byte limit"));
				}
				return;
			}
			if (path.startsWith("/v1/artifacts/content/") && request.method === "GET")
			{
				await _ReadCanonicalArtifact(request, response, store, config.leasePublicKeyPem, path.slice("/v1/artifacts/content/".length));
				return;
			}
			response.writeHead(404, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "not_found" }));
		}).catch(function _onRequestFailure(err)
		{
			log.error({ err, method: request.method, path }, "artifact service request failed");
			response.destroy(err instanceof Error ? err : new Error("artifact service request failed"));
		});
	});
}

/** Verify one exact immutable read lease, then stream only its pinned canonical bytes. */
async function _ReadCanonicalArtifact(request: IncomingMessage, response: ServerResponse, store: ArtifactStore, leasePublicKeyPem: string, digest: string): Promise<void>
{
	// 1. Verify the private-server lease before trusting the requested content coordinate.
	const compactLease = request.headers["x-opencrane-artifact-lease"];
	const lease = typeof compactLease === "string" ? __VerifyArtifactReadLease(compactLease, leasePublicKeyPem, Math.floor(Date.now() / 1_000)) : null;
	const contentAddress = `sha256:${digest}`;
	if (lease === null || !/^[a-f0-9]{64}$/u.test(digest) || lease.contentAddress !== contentAddress)
	{
		response.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(JSON.stringify({ error: "artifact_read_denied" }));
		return;
	}

	// 2. Read only the lease-pinned address; a missing object must never widen the read scope.
	const stream = await store.read(lease.contentAddress);
	if (stream === null)
	{
		response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
		response.end(JSON.stringify({ error: "artifact_not_found" }));
		return;
	}

	// 3. Send signed metadata, never request-controlled headers or inferred catalog details.
	response.writeHead(200, { "content-type": lease.mediaType, "content-length": String(lease.byteLength), "cache-control": "no-store" });
	for await (const chunk of stream)
	{
		if (!response.write(chunk) && !await _WaitForWritableResponse(response)) return;
	}
	response.end();
}

/** Wait for downstream backpressure to drain, but stop reading when the private client disconnects. */
async function _WaitForWritableResponse(response: ServerResponse): Promise<boolean>
{
	return new Promise<boolean>(function _Wait(resolve)
	{
		function _Cleanup(): void
		{
			response.off("drain", _Drained);
			response.off("close", _Closed);
			response.off("error", _Errored);
		}
		function _Drained(): void { _Cleanup(); resolve(true); }
		function _Closed(): void { _Cleanup(); resolve(false); }
		function _Errored(): void { _Cleanup(); resolve(false); }
		response.once("drain", _Drained);
		response.once("close", _Closed);
		response.once("error", _Errored);
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
