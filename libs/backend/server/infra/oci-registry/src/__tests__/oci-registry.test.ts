import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { __CreateOciRegistryClient } from "../oci-registry";
import { OciRegistryImportErrorCodes } from "../oci-registry.types";
import type { OciRegistryBlob, OciRegistryImportPlan } from "../oci-registry.types";

/** Registry origin used by every mocked request. */
const _REGISTRY_ORIGIN = "https://registry.example.com";
/** Fixed repository whose immutable reference the client returns. */
const _REPOSITORY = "opencrane/mcp-images";

/** Returns the SHA-256 address of deterministic test bytes. */
function _Digest(bytes: Uint8Array): string
{
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Encodes a string for one deterministic image component. */
function _Bytes(value: string): Uint8Array
{
	return new TextEncoder().encode(value);
}

/** Creates one valid already-checked image import plan. */
function _Plan(): OciRegistryImportPlan
{
	const configBytes = _Bytes("{}");
	const layerBytes = _Bytes("layer bytes");
	const blobs: readonly OciRegistryBlob[] = [{ digest: _Digest(configBytes), bytes: configBytes }, { digest: _Digest(layerBytes), bytes: layerBytes }];
	const manifestBytes = _Bytes(JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: blobs[0]?.digest, size: configBytes.byteLength }, layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: blobs[1]?.digest, size: layerBytes.byteLength }] }));
	return { blobs, manifest: { digest: _Digest(manifestBytes), mediaType: "application/vnd.oci.image.manifest.v1+json", bytes: manifestBytes } };
}

/** Creates the importer with the supplied mocked fetch function. */
function _Client(request: typeof fetch)
{
	return __CreateOciRegistryClient({ baseUrl: _REGISTRY_ORIGIN, repository: _REPOSITORY, requestTimeoutMilliseconds: 1_000, readAuthorizationHeader: async function _ReadAuthorization() { return "Bearer test-secret"; }, request });
}

/** Converts any Fetch API request input into a URL for assertions. */
function _Url(input: string | URL | Request): URL
{
	if (input instanceof Request)
		return new URL(input.url);
	return new URL(input);
}

describe("OCI registry importer", function _describeOciRegistryImporter()
{
	it("skips existing blobs and publishes the manifest by digest", async function _importsExistingBlobs()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			const url = _Url(input);
			const authorization = new Headers(init?.headers).get("Authorization");
			expect(authorization).toBe("Bearer test-secret");
			if (init?.method === "HEAD")
			{
				const digest = url.pathname.split("/").at(-1) as string;
				const blob = plan.blobs.find(candidate => candidate.digest === digest) as OciRegistryBlob;
				return new Response(null, { status: 200, headers: { "Docker-Content-Digest": digest, "Content-Length": String(blob.bytes.byteLength) } });
			}
			expect(init?.method).toBe("PUT");
			expect(url.pathname).toBe(`/v2/${_REPOSITORY}/manifests/${plan.manifest.digest}`);
			expect(new Headers(init?.headers).get("Content-Type")).toBe(plan.manifest.mediaType);
			expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(plan.manifest.bytes);
			return new Response(null, { status: 201, headers: { "Docker-Content-Digest": plan.manifest.digest, Location: `/v2/${_REPOSITORY}/manifests/${plan.manifest.digest}` } });
		});

		const result = await _Client(request).import(plan);

		expect(result).toEqual({ reference: `registry.example.com/${_REPOSITORY}@${plan.manifest.digest}`, manifestDigest: plan.manifest.digest });
		expect(request).toHaveBeenCalledTimes(3);
		expect(request.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(0);
	});

	it("re-reads the registry credential for every request", async function _ReadsRotatedCredential()
	{
		const plan = _Plan();
		let credential = "Bearer first";
		const readAuthorizationHeader = vi.fn(async function _ReadAuthorization() { return credential; });
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			const digest = _Url(input).pathname.split("/").at(-1) as string;
			if (init?.method === "HEAD")
			{
				expect(new Headers(init.headers).get("Authorization")).toBe(credential);
				credential = "Bearer rotated";
				const blob = plan.blobs.find(candidate => candidate.digest === digest) as OciRegistryBlob;
				return new Response(null, { status: 200, headers: { "Docker-Content-Digest": digest, "Content-Length": String(blob.bytes.byteLength) } });
			}
			expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer rotated");
			return new Response(null, { status: 201, headers: { "Docker-Content-Digest": plan.manifest.digest, Location: `/v2/${_REPOSITORY}/manifests/${plan.manifest.digest}` } });
		});
		const client = __CreateOciRegistryClient({ baseUrl: _REGISTRY_ORIGIN, repository: _REPOSITORY, requestTimeoutMilliseconds: 1_000, readAuthorizationHeader, request });

		await client.import(plan);

		expect(readAuthorizationHeader).toHaveBeenCalledTimes(3);
	});

	it("uploads missing blobs through POST then PUT before the manifest", async function _uploadsMissingBlobs()
	{
		const plan = _Plan();
		let session = 0;
		const uploaded = new Map<string, Uint8Array>();
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			const url = _Url(input);
			if (init?.method === "HEAD")
				return new Response(null, { status: 404 });
			if (init?.method === "POST")
			{
				session += 1;
				return new Response(null, { status: 202, headers: { Location: `/v2/${_REPOSITORY}/blobs/uploads/session-${session}?state=a%20b` } });
			}
			if (url.pathname.includes("/blobs/uploads/"))
			{
				const digest = url.searchParams.get("digest") as string;
				expect(String(input)).toContain("?state=a%20b&digest=sha256%3A");
				uploaded.set(digest, new Uint8Array(init?.body as ArrayBuffer));
				return new Response(null, { status: 201, headers: { "Docker-Content-Digest": digest, Location: `/v2/${_REPOSITORY}/blobs/${digest}` } });
			}
			return new Response(null, { status: 201, headers: { "Docker-Content-Digest": plan.manifest.digest, Location: `/v2/${_REPOSITORY}/manifests/${plan.manifest.digest}` } });
		});

		await _Client(request).import(plan);

		expect([...uploaded.keys()]).toEqual(plan.blobs.map(blob => blob.digest));
		expect([...uploaded.values()]).toEqual(plan.blobs.map(blob => blob.bytes));
		expect(request.mock.calls.map(call => call[1]?.method)).toEqual(["HEAD", "POST", "PUT", "HEAD", "POST", "PUT", "PUT"]);
	});

	it("retries the same plan without uploading blobs that the first call stored", async function _retriesIdempotently()
	{
		const plan = _Plan();
		const stored = new Set<string>();
		let session = 0;
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			const url = _Url(input);
			if (init?.method === "HEAD")
			{
				const digest = url.pathname.split("/").at(-1) as string;
				const blob = plan.blobs.find(candidate => candidate.digest === digest) as OciRegistryBlob;
				if (!stored.has(digest))
					return new Response(null, { status: 404 });
				return new Response(null, { status: 200, headers: { "Docker-Content-Digest": digest, "Content-Length": String(blob.bytes.byteLength) } });
			}
			if (init?.method === "POST")
			{
				session += 1;
				return new Response(null, { status: 202, headers: { Location: `/v2/${_REPOSITORY}/blobs/uploads/session-${session}` } });
			}
			if (url.pathname.includes("/blobs/uploads/"))
			{
				const digest = url.searchParams.get("digest") as string;
				stored.add(digest);
				return new Response(null, { status: 201, headers: { "Docker-Content-Digest": digest, Location: `/v2/${_REPOSITORY}/blobs/${digest}` } });
			}
			return new Response(null, { status: 201, headers: { "Docker-Content-Digest": plan.manifest.digest, Location: `/v2/${_REPOSITORY}/manifests/${plan.manifest.digest}` } });
		});

		const client = _Client(request);
		await client.import(plan);
		await client.import(plan);

		expect(stored).toEqual(new Set(plan.blobs.map(blob => blob.digest)));
		expect(request.mock.calls.filter(call => call[1]?.method === "POST")).toHaveLength(plan.blobs.length);
		expect(request.mock.calls.filter(call => _Url(call[0]).pathname.includes("/manifests/"))).toHaveLength(2);
	});

	it("rejects a different digest returned for an existing blob", async function _rejectsBlobDigestMismatch()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(): Promise<Response>
		{
			return new Response(null, { status: 200, headers: { "Docker-Content-Digest": `sha256:${"0".repeat(64)}` } });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.DigestMismatch });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("refuses registry redirects instead of forwarding an import request", async function _refusesRegistryRedirects()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(_input, init): Promise<Response>
		{
			expect(init?.redirect).toBe("manual");
			return new Response(null, { status: 307, headers: { Location: "https://attacker.example/upload" } });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.InvalidRegistryResponse, status: 307 });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it("reports temporary registry statuses as retryable", async function _reportsRetryableStatus()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(): Promise<Response>
		{
			return new Response(null, { status: 503, headers: { "Retry-After": "5" } });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.TransportFailed, status: 503 });
	});

	it("reports every registry server error as retryable", async function _reportsUncommonServerError()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(): Promise<Response>
		{
			return new Response(null, { status: 507 });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.TransportFailed, status: 507 });
	});

	it("rejects a blob upload location on another origin", async function _rejectsCrossOriginUpload()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			if (init?.method === "HEAD")
				return new Response(null, { status: 404 });
			expect(_Url(input).origin).toBe(_REGISTRY_ORIGIN);
			return new Response(null, { status: 202, headers: { Location: "https://storage.example/upload-session" } });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.InvalidRegistryResponse });
		expect(request).toHaveBeenCalledTimes(2);
	});

	it("rejects a different digest returned after the manifest upload", async function _rejectsManifestDigestMismatch()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			const url = _Url(input);
			if (init?.method === "HEAD")
			{
				const digest = url.pathname.split("/").at(-1) as string;
				const blob = plan.blobs.find(candidate => candidate.digest === digest) as OciRegistryBlob;
				return new Response(null, { status: 200, headers: { "Docker-Content-Digest": digest, "Content-Length": String(blob.bytes.byteLength) } });
			}
			return new Response(null, { status: 201, headers: { "Docker-Content-Digest": `sha256:${"f".repeat(64)}`, Location: `/v2/${_REPOSITORY}/manifests/rejected` } });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.DigestMismatch });
	});

	it("rejects a manifest success response without confirmation headers", async function _rejectsIncompleteManifestSuccess()
	{
		const plan = _Plan();
		const request = vi.fn<typeof fetch>(async function _request(input, init): Promise<Response>
		{
			const url = _Url(input);
			if (init?.method === "HEAD")
			{
				const digest = url.pathname.split("/").at(-1) as string;
				const blob = plan.blobs.find(candidate => candidate.digest === digest) as OciRegistryBlob;
				return new Response(null, { status: 200, headers: { "Docker-Content-Digest": digest, "Content-Length": String(blob.bytes.byteLength) } });
			}
			return new Response(null, { status: 201 });
		});

		await expect(_Client(request).import(plan)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.InvalidRegistryResponse, status: 201 });
	});

	it("rejects changed bytes before sending a registry request", async function _rejectsChangedBytes()
	{
		const plan = _Plan();
		const changed = { ...plan, manifest: { ...plan.manifest, bytes: _Bytes("changed") } };
		const request = vi.fn<typeof fetch>();

		await expect(_Client(request).import(changed)).rejects.toMatchObject({ code: OciRegistryImportErrorCodes.InvalidPlan });
		expect(request).not.toHaveBeenCalled();
	});
});
