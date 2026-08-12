import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { __FilesystemArtifactStore } from "@opencrane/backend/artifacts/filesystem";
import { __SignArtifactPromotionReceipt, __VerifyArtifactReadLease, __VerifyArtifactWriteLease } from "@opencrane/backend/artifacts/authorization";
import { __PromoteArtifactUpload } from "@opencrane/backend/artifacts/store";
import type { ArtifactPromotionLeaseVerifier, ArtifactPromotionReceiptSigner, ArtifactStore, BoundedArtifactUploadByteSource, PromoteArtifactUploadResult } from "@opencrane/backend/artifacts/store";
import { ___DoWithTrace } from "@opencrane/backend/observability";

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

/** Create the private server for bounded promotion writes and lease-pinned immutable reads. */
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
			if (path === "/v1/artifacts/read" && request.method === "GET")
			{
				await _ReadCanonicalArtifact(request, response, store, config.leasePublicKeyPem);
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

/** Verifies the immutable read lease, checks the stored size first, then streams bytes only from the address that lease pins. */
async function _ReadCanonicalArtifact(request: IncomingMessage, response: ServerResponse, store: ArtifactStore, leasePublicKeyPem: string): Promise<void>
{
	// 1. Read the dedicated header because write authority must never open the read endpoint.
	const compactLease = request.headers["x-opencrane-artifact-read-lease"];
	const lease = typeof compactLease === "string" ? __VerifyArtifactReadLease(compactLease, leasePublicKeyPem, Math.floor(Date.now() / 1_000)) : null;
	if (lease === null)
	{
		_WriteArtifactReadDenied(response);
		return;
	}

	// 2. Preflight the stored length before opening a stream so missing and mismatched bytes fail identically.
	const storedByteLength = await store.byteLength(lease.contentAddress);
	if (storedByteLength === null || storedByteLength !== lease.byteLength)
	{
		_WriteArtifactReadDenied(response);
		return;
	}

	// 3. Read only the lease-pinned address after its size matches; there is no caller-selected coordinate.
	const stream = await store.read(lease.contentAddress);
	if (stream === null)
	{
		_WriteArtifactReadDenied(response);
		return;
	}

	// 4. Send only lease-signed metadata after all preflight gates passed, preventing a partial successful response.
	// X-Content-Type-Options: proprietary response header that asks clients not to MIME-sniff signed bytes.
	// @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options
	response.writeHead(200, { "content-type": lease.mediaType, "content-length": String(lease.byteLength), "cache-control": "no-store", "x-content-type-options": "nosniff" });
	for await (const chunk of stream)
	{
		if (!response.write(chunk) && !await _WaitForWritableResponse(response)) return;
	}
	response.end();
}

/** Returns the same non-cacheable denial for an invalid lease, missing object, or size mismatch. */
function _WriteArtifactReadDenied(response: ServerResponse): void
{
	response.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
	response.end(JSON.stringify({ error: "artifact_read_denied" }));
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

/** Wraps this app's OpenCrane public key as the lease-verifier port, which knows nothing about storage. */
function _leaseVerifier(leasePublicKeyPem: string): ArtifactPromotionLeaseVerifier
{
	return { verify(compactLease, nowEpochSeconds) { return __VerifyArtifactWriteLease(compactLease, leasePublicKeyPem, nowEpochSeconds); } };
}

/** Wraps this app's receipt key as the receipt-signer port, which knows nothing about storage. */
function _receiptSigner(receiptPrivateKeyPem: string): ArtifactPromotionReceiptSigner
{
	return { sign(claims) { return __SignArtifactPromotionReceipt(claims, receiptPrivateKeyPem); } };
}

/** Hands the promotion protocol only the request parts it needs in order to cap how many bytes it reads. */
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

/** Turns each storage-domain outcome into the status and body this private endpoint returns. */
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
