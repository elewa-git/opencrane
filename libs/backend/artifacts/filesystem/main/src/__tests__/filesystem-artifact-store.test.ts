import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { __FilesystemArtifactStore } from "../filesystem-artifact-store.js";

/** Builds an authorized upload lease that remains valid through the test. */
function _lease(id: string): { readonly leaseId: string; readonly siloId: string; readonly artifactId: string; readonly action: "artifact.write"; readonly expiresAtEpochSeconds: number }
{
	return { leaseId: id, siloId: "silo-1", artifactId: "artifact-1", action: "artifact.write", expiresAtEpochSeconds: Math.floor(Date.now() / 1_000) + 60 };
}

/** Exposes byte chunks as an asynchronous upload stream. */
async function* _bytes(...chunks: string[]): AsyncIterable<Uint8Array>
{
	for (const chunk of chunks)
	{
		yield Buffer.from(chunk, "utf8");
	}
}

/** Collects a strict ArtifactStore read stream for assertion. */
async function _collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer>
{
	const chunks: Uint8Array[] = [];
	for await (const chunk of stream)
	{
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

describe("filesystem ArtifactStore", function _suite()
{
	it("promotes concurrent identical staged uploads into one immutable CAS object", async function _concurrentPromotion()
	{
		const rootPath = await mkdtemp(join(tmpdir(), "opencrane-artifact-store-"));
		try
		{
			const store = new __FilesystemArtifactStore({ rootPath });
			const [first, second] = await Promise.all([
				store.stage({ lease: _lease("lease-1"), bytes: _bytes("open", "crane"), expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }),
				store.stage({ lease: _lease("lease-2"), bytes: _bytes("opencrane"), expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" }),
			]);
			const promotions = await Promise.all([store.promote(first), store.promote(second)]);
			expect(promotions.map(promotion => promotion.created).sort()).toEqual([false, true]);
			expect(promotions[0]?.contentAddress).toBe(promotions[1]?.contentAddress);
			const stream = await store.read(promotions[0]?.contentAddress ?? "");
			expect(stream === null ? null : (await _collect(stream)).toString("utf8")).toBe("opencrane");
		}
		finally
		{
			await rm(rootPath, { recursive: true, force: true });
		}
	});

	it("rejects mismatched expected metadata and never leaves a canonical file", async function _mismatchedMetadata()
	{
		const rootPath = await mkdtemp(join(tmpdir(), "opencrane-artifact-store-"));
		try
		{
			const store = new __FilesystemArtifactStore({ rootPath });
			await expect(store.stage({ lease: _lease("lease-1"), bytes: _bytes("artifact"), expectedContentAddress: `sha256:${"a".repeat(64)}`, expectedByteLength: 8, mediaType: "text/plain" })).rejects.toThrow(/do not match/);
			expect(await readFile(join(rootPath, "sha256", "aa", "a".repeat(64))).catch(function _missing(): null { return null; })).toBeNull();
		}
		finally
		{
			await rm(rootPath, { recursive: true, force: true });
		}
	});

	it("stops consuming a stream as soon as it exceeds its signed byte allowance", async function _boundedStream()
	{
		const rootPath = await mkdtemp(join(tmpdir(), "opencrane-artifact-store-"));
		try
		{
			const store = new __FilesystemArtifactStore({ rootPath });
			await expect(store.stage({ lease: _lease("lease-1"), bytes: _bytes("allowed", "overflow"), expectedContentAddress: null, expectedByteLength: 7, mediaType: "text/plain" })).rejects.toThrow(/exceed the authorized byte length/);
		}
		finally
		{
			await rm(rootPath, { recursive: true, force: true });
		}
	});

	it("rejects a same-sized canonical pathname whose bytes no longer match its address", async function _tamperedCanonicalFile()
	{
		const rootPath = await mkdtemp(join(tmpdir(), "opencrane-artifact-store-"));
		try
		{
			const store = new __FilesystemArtifactStore({ rootPath });
			const first = await store.stage({ lease: _lease("lease-1"), bytes: _bytes("opencrane"), expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" });
			const promotion = await store.promote(first);
			await writeFile(join(rootPath, "sha256", promotion.contentAddress.slice("sha256:".length, "sha256:".length + 2), promotion.contentAddress.slice("sha256:".length)), "corrupted");
			const second = await store.stage({ lease: _lease("lease-2"), bytes: _bytes("opencrane"), expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" });
			await expect(store.promote(second)).rejects.toThrow(/does not match its content address/);
		}
		finally
		{
			await rm(rootPath, { recursive: true, force: true });
		}
	});

	it("rejects traversal-shaped reads and performs an idempotent physical purge", async function _safePurge()
	{
		const rootPath = await mkdtemp(join(tmpdir(), "opencrane-artifact-store-"));
		try
		{
			const store = new __FilesystemArtifactStore({ rootPath });
			const staged = await store.stage({ lease: _lease("lease-1"), bytes: _bytes("artifact"), expectedContentAddress: null, expectedByteLength: null, mediaType: "text/plain" });
			const promotion = await store.promote(staged);
			await expect(store.read("../../etc/passwd")).rejects.toThrow(/invalid ArtifactStore content address/);
			expect(await store.purge(promotion.contentAddress)).toEqual({ purged: true });
			expect(await store.purge(promotion.contentAddress)).toEqual({ purged: false });
		}
		finally
		{
			await rm(rootPath, { recursive: true, force: true });
		}
	});
});
