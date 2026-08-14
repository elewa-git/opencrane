import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { __SignArtifactReadLease, __SignArtifactWriteLease, __VerifyArtifactPromotionReceipt } from "@opencrane/backend/artifacts/authorization";
import { __FilesystemArtifactStore } from "@opencrane/backend/artifacts/filesystem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateServer } from "../server";

const _leaseKeys = generateKeyPairSync("ed25519");
const _receiptKeys = generateKeyPairSync("ed25519");
const _leasePrivateKey = _leaseKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const _leasePublicKey = _leaseKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const _receiptPrivateKey = _receiptKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const _receiptPublicKey = _receiptKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
const _servers: Array<ReturnType<typeof _CreateServer>> = [];

afterEach(async function _closeServers()
{
	await Promise.all(_servers.splice(0).map(function _close(server) { return _closeServer(server); }));
});

/**
 * Closes a test server after terminating fetch keep-alive connections.
 *
 * @param server - Server whose listener and client connections must be released.
 */
async function _closeServer(server: ReturnType<typeof _CreateServer>): Promise<void>
{
	// 1. Drop Node fetch's idle keep-alive sockets so `close` cannot wait indefinitely after a completed request.
	server.closeAllConnections();
	// 2. Await listener shutdown so the following test starts from an isolated server state.
	await new Promise<void>(function _close(resolve) { server.close(function _closed() { resolve(); }); });
}

describe("artifact-service promotion endpoint", function _suite()
{
	it("accepts an OpenCrane-signed bounded lease and returns a separately signed receipt", async function _promote()
	{
		const root = await mkdtemp(join(tmpdir(), "artifact-service-"));
		try
		{
			const server = _CreateServer({ port: 0, artifactRoot: root, maxUploadDurationMilliseconds: 300_000, leasePublicKeyPem: _leasePublicKey, receiptPrivateKeyPem: _receiptPrivateKey }, new __FilesystemArtifactStore({ rootPath: root }));
			_servers.push(server);
			await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", function _ready() { resolve(); }); });
			const port = (server.address() as { port: number }).port;
			const bytes = Buffer.from("opencrane");
			const digest = `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}`;
			const lease = __SignArtifactWriteLease({ leaseId: "lease-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60, expectedContentAddress: digest, expectedByteLength: bytes.byteLength, mediaType: "text/plain" }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
			const response = await fetch(`http://127.0.0.1:${port}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease }, body: bytes });
			const body = await response.json() as { receipt: string };
			expect(response.status).toBe(201);
			expect(__VerifyArtifactPromotionReceipt(body.receipt, _receiptPublicKey)).toMatchObject({ leaseId: "lease-1", contentAddress: digest });
		}
		finally
		{
			await rm(root, { recursive: true, force: true });
		}
	});

	it("rejects a declared body larger than the signed lease before staging bytes", async function _oversizedContentLength()
	{
		const root = await mkdtemp(join(tmpdir(), "artifact-service-"));
		try
		{
			const server = _CreateServer({ port: 0, artifactRoot: root, maxUploadDurationMilliseconds: 300_000, leasePublicKeyPem: _leasePublicKey, receiptPrivateKeyPem: _receiptPrivateKey }, new __FilesystemArtifactStore({ rootPath: root }));
			_servers.push(server);
			await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", function _ready() { resolve(); }); });
			const port = (server.address() as { port: number }).port;
			const lease = __SignArtifactWriteLease({ leaseId: "lease-2", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60, expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 1, mediaType: "text/plain" }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
			const response = await fetch(`http://127.0.0.1:${port}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease, "content-length": "2" }, body: "ab" });
			expect(response.status).toBe(413);
		}
		finally
		{
			await rm(root, { recursive: true, force: true });
		}
	});

	it("streams only the canonical address pinned by a signed immutable read lease", async function _readCanonicalBytes()
	{
		const root = await mkdtemp(join(tmpdir(), "artifact-service-"));
		try
		{
			const server = _CreateServer({ port: 0, artifactRoot: root, maxUploadDurationMilliseconds: 300_000, leasePublicKeyPem: _leasePublicKey, receiptPrivateKeyPem: _receiptPrivateKey }, new __FilesystemArtifactStore({ rootPath: root }));
			_servers.push(server);
			await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", function _ready() { resolve(); }); });
			const port = (server.address() as { port: number }).port;
			const bytes = Buffer.from("opencrane");
			const digest = `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}`;
			const writeLease = __SignArtifactWriteLease({ leaseId: "write-1", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60, expectedContentAddress: digest, expectedByteLength: bytes.byteLength, mediaType: "text/plain" }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
			await fetch(`http://127.0.0.1:${port}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": writeLease }, body: bytes });
			const readLease = __SignArtifactReadLease({ leaseId: "read-1", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: digest, byteLength: bytes.byteLength, mediaType: "text/plain", action: "artifact.read", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60 }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
			const response = await fetch(`http://127.0.0.1:${port}/v1/artifacts/read`, { headers: { "x-opencrane-artifact-read-lease": readLease } });

			expect(response.status).toBe(200);
			expect(response.headers.get("content-length")).toBe(String(bytes.byteLength));
			expect(response.headers.get("cache-control")).toBe("no-store");
			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(await response.text()).toBe("opencrane");
			expect((await fetch(`http://127.0.0.1:${port}/v1/artifacts/read`, { headers: { "x-opencrane-artifact-lease": readLease } })).status).toBe(403);
			expect((await fetch(`http://127.0.0.1:${port}/v1/artifacts/content/${digest.slice("sha256:".length)}`, { headers: { "x-opencrane-artifact-read-lease": readLease } })).status).toBe(404);
		}
		finally
		{
			await rm(root, { recursive: true, force: true });
		}
	});

	it("denies missing and byte-mismatched objects before reading or sending a success response", async function _readPreflight()
	{
		const read = vi.fn(async function _read() { return null; });
		let storedByteLength: number | null = 8;
		const store = { stage: vi.fn(), promote: vi.fn(), byteLength: vi.fn(async function _byteLength() { return storedByteLength; }), read, purge: vi.fn() } as never;
		const server = _CreateServer({ port: 0, artifactRoot: "/tmp/artifact-service", maxUploadDurationMilliseconds: 300_000, leasePublicKeyPem: _leasePublicKey, receiptPrivateKeyPem: _receiptPrivateKey }, store);
		_servers.push(server);
		await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", function _ready() { resolve(); }); });
		const port = (server.address() as { port: number }).port;
		const readLease = __SignArtifactReadLease({ leaseId: "read-2", siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"a".repeat(64)}`, byteLength: 9, mediaType: "text/plain", action: "artifact.read", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60 }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
		const mismatch = await fetch(`http://127.0.0.1:${port}/v1/artifacts/read`, { headers: { "x-opencrane-artifact-read-lease": readLease } });
		storedByteLength = null;
		const missing = await fetch(`http://127.0.0.1:${port}/v1/artifacts/read`, { headers: { "x-opencrane-artifact-read-lease": readLease } });

		expect(mismatch.status).toBe(403);
		expect(missing.status).toBe(403);
		expect(mismatch.headers.get("cache-control")).toBe("no-store");
		expect(missing.headers.get("cache-control")).toBe("no-store");
		expect(await mismatch.text()).toBe(await missing.text());
		expect(read).not.toHaveBeenCalled();
	});

	it("cuts off a client that drips bytes beyond the independent lease-bound deadline", async function _absoluteDeadline()
	{
		const root = await mkdtemp(join(tmpdir(), "artifact-service-"));
		try
		{
			const server = _CreateServer({ port: 0, artifactRoot: root, maxUploadDurationMilliseconds: 5, leasePublicKeyPem: _leasePublicKey, receiptPrivateKeyPem: _receiptPrivateKey }, new __FilesystemArtifactStore({ rootPath: root }));
			_servers.push(server);
			await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", function _ready() { resolve(); }); });
			const port = (server.address() as { port: number }).port;
			const bytes = Buffer.from("opencrane");
			const digest = `sha256:${(await import("node:crypto")).createHash("sha256").update(bytes).digest("hex")}`;
			const lease = __SignArtifactWriteLease({ leaseId: "lease-3", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60, expectedContentAddress: digest, expectedByteLength: bytes.byteLength, mediaType: "text/plain" }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
			const slowBody = new ReadableStream<Uint8Array>({ start(controller): void { controller.enqueue(Buffer.from("open")); setTimeout(function _drip() { controller.enqueue(Buffer.from("crane")); controller.close(); }, 25); } });
			await expect(fetch(`http://127.0.0.1:${port}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease }, body: slowBody, duplex: "half" } as RequestInit)).rejects.toThrow();
		}
		finally
		{
			await rm(root, { recursive: true, force: true });
		}
	});

	it("never signs a receipt when canonical promotion crosses the deadline", async function _promotionDeadline()
	{
		const root = await mkdtemp(join(tmpdir(), "artifact-service-"));
		try
		{
			const address = `sha256:${"a".repeat(64)}`;
			const promote = vi.fn(async function _slowPromotion() { await new Promise<void>(function _delay(resolve) { setTimeout(resolve, 25); }); return { leaseId: "lease-4", contentAddress: address, byteLength: 1, mediaType: "text/plain", created: true }; });
			const store = { stage: vi.fn().mockResolvedValue({ leaseId: "lease-4", stagingHandle: "a".repeat(64), contentAddress: address, byteLength: 1, mediaType: "text/plain" }), promote } as never;
			const server = _CreateServer({ port: 0, artifactRoot: root, maxUploadDurationMilliseconds: 5, leasePublicKeyPem: _leasePublicKey, receiptPrivateKeyPem: _receiptPrivateKey }, store);
			_servers.push(server);
			await new Promise<void>(function _listen(resolve) { server.listen(0, "127.0.0.1", function _ready() { resolve(); }); });
			const port = (server.address() as { port: number }).port;
			const lease = __SignArtifactWriteLease({ leaseId: "lease-4", siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60, expectedContentAddress: address, expectedByteLength: 1, mediaType: "text/plain" }, _leasePrivateKey, Math.floor(Date.now() / 1_000));
			await expect(fetch(`http://127.0.0.1:${port}/v1/artifacts/promote`, { method: "POST", headers: { "x-opencrane-artifact-lease": lease }, body: "x" })).rejects.toThrow();
			expect(promote).toHaveBeenCalledOnce();
		}
		finally
		{
			await rm(root, { recursive: true, force: true });
		}
	});
});
