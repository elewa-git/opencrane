import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { _InspectOciImageLayoutForImport, _ReadOciImageLayoutZip } from "../oci-image-validation/oci-image-layout-verifier";
import { OCI_IMAGE_MAXIMUM_BUNDLE_BYTES, OciImageVerificationFailureCodes } from "../oci-image-validation/oci-image-validation.types";

/** One stored ZIP file used to build a deterministic OCI image-layout fixture. */
interface _ZipEntry
{
	/** Archive-relative path. */
	readonly path: string;
	/** Exact entry bytes. */
	readonly bytes: Buffer;
}

/** Fixture controls used to corrupt one part of an otherwise valid image layout. */
interface _LayoutOptions
{
	/** Descriptors written into the layout index instead of its valid image manifest. */
	readonly indexManifests?: readonly unknown[];
	/** Descriptor written into the image manifest configuration slot. */
	readonly configDescriptor?: unknown;
	/** Descriptors written into the image manifest layer list. */
	readonly layerDescriptors?: readonly unknown[];
	/** Removes the required layer list from the image manifest. */
	readonly omitLayers?: boolean;
	/** Removes the valid configuration blob from the archive. */
	readonly omitConfigBlob?: boolean;
	/** Removes the valid layer blob from the archive. */
	readonly omitLayerBlob?: boolean;
	/** Media type declared inside the image manifest document. */
	readonly manifestMediaType?: string;
	/** Extra files appended after the valid descriptor blobs. */
	readonly additionalEntries?: readonly _ZipEntry[];
}

/** Return the digest grammar and bytes required by an OCI descriptor. */
function _Digest(bytes: Buffer): string
{
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** Build a compact stored ZIP without extracting any fixture to disk. */
function _Zip(entries: readonly _ZipEntry[]): Buffer
{
	const local: Buffer[] = [];
	const central: Buffer[] = [];
	let offset = 0;
	for (const entry of entries)
	{
		const path = Buffer.from(entry.path, "utf8");
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50, 0);
		header.writeUInt16LE(20, 4);
		header.writeUInt32LE(entry.bytes.byteLength, 18);
		header.writeUInt32LE(entry.bytes.byteLength, 22);
		header.writeUInt16LE(path.byteLength, 26);
		const directory = Buffer.alloc(46);
		directory.writeUInt32LE(0x02014b50, 0);
		directory.writeUInt16LE(20, 4);
		directory.writeUInt16LE(20, 6);
		directory.writeUInt32LE(entry.bytes.byteLength, 20);
		directory.writeUInt32LE(entry.bytes.byteLength, 24);
		directory.writeUInt16LE(path.byteLength, 28);
		directory.writeUInt32LE(offset, 42);
		local.push(header, path, entry.bytes);
		central.push(directory, path);
		offset += header.byteLength + path.byteLength + entry.bytes.byteLength;
	}
	const directory = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(directory.byteLength, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...local, directory, end]);
}

/** Build a valid OCI image layout and optionally replace one descriptor boundary. */
function _Layout(options: _LayoutOptions = {}): Buffer
{
	const config = Buffer.from(JSON.stringify({ architecture: "amd64", os: "linux" }), "utf8");
	const configDigest = _Digest(config);
	const layer = Buffer.from("one immutable layer", "utf8");
	const layerDigest = _Digest(layer);
	const configDescriptor = { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: config.byteLength };
	const layerDescriptor = { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: layerDigest, size: layer.byteLength };
	const manifestDocument: Record<string, unknown> = { schemaVersion: 2, config: options.configDescriptor ?? configDescriptor };
	if (!options.omitLayers)
		manifestDocument.layers = options.layerDescriptors ?? [layerDescriptor];
	if (options.manifestMediaType !== undefined)
		manifestDocument.mediaType = options.manifestMediaType;
	const manifest = Buffer.from(JSON.stringify(manifestDocument), "utf8");
	const manifestDigest = _Digest(manifest);
	const manifestDescriptor = { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: manifestDigest, size: manifest.byteLength };
	const index = Buffer.from(JSON.stringify({ schemaVersion: 2, manifests: options.indexManifests ?? [manifestDescriptor] }), "utf8");
	const entries: _ZipEntry[] = [
		{ path: "oci-layout", bytes: Buffer.from(JSON.stringify({ imageLayoutVersion: "1.0.0" }), "utf8") },
		{ path: "index.json", bytes: index },
		{ path: `blobs/sha256/${manifestDigest.slice(7)}`, bytes: manifest },
	];
	if (!options.omitConfigBlob)
		entries.push({ path: `blobs/sha256/${configDigest.slice(7)}`, bytes: config });
	if (!options.omitLayerBlob)
		entries.push({ path: `blobs/sha256/${layerDigest.slice(7)}`, bytes: layer });
	entries.push(...(options.additionalEntries ?? []));
	return _Zip(entries);
}

describe("_InspectOciImageLayoutForImport", function _OciImageLayoutSuite()
{
	it("rejects an oversized saved artifact before opening its stream", async function _RejectsSavedOversize()
	{
		const read = vi.fn();
		const target = { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"0".repeat(64)}`, byteLength: OCI_IMAGE_MAXIMUM_BUNDLE_BYTES + 1, mediaType: "application/vnd.oci.image.layout.v1+zip" };

		await expect(_ReadOciImageLayoutZip({ read }, target)).resolves.toBeNull();
		expect(read).not.toHaveBeenCalled();
	});

	it("cancels an artifact stream that exceeds its saved length", async function _CancelsOverlongStream()
	{
		const cancel = vi.fn();
		const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); }, cancel });
		const target = { siloId: "silo-1", artifactId: "artifact-1", artifactRevisionId: "revision-1", contentAddress: `sha256:${"0".repeat(64)}`, byteLength: 1, mediaType: "application/vnd.oci.image.layout.v1+zip" };

		await expect(_ReadOciImageLayoutZip({ read: vi.fn().mockResolvedValue(stream) }, target)).resolves.toBeNull();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it("accepts exactly one complete OCI image layout and verifies its layer", function _AcceptsLayout()
	{
		expect(_InspectOciImageLayoutForImport(_Layout()).validation).toMatchObject({ accepted: true, layout: { indexDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u), imageManifestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u), configDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u) } });
	});

	it("returns the exact configuration, layer and manifest bytes for registry import", function _BuildsRegistryPlan()
	{
		const plan = _InspectOciImageLayoutForImport(_Layout()).plan;
		expect(plan?.blobs).toHaveLength(2);
		expect(plan?.blobs.map(function _Digest(blob) { return blob.digest; })).toEqual(plan?.blobs.map(function _ContentDigest(blob) { return _Digest(Buffer.from(blob.bytes)); }));
		expect(plan?.manifest.digest).toBe(_Digest(Buffer.from(plan?.manifest.bytes ?? [])));
		expect(plan?.manifest.mediaType).toBe("application/vnd.oci.image.manifest.v1+json");
		expect(_InspectOciImageLayoutForImport(Buffer.from("not-a-zip", "utf8")).plan).toBeNull();
	});

	it("reports a malformed ZIP separately from a readable non-OCI ZIP", function _ClassifiesArchiveFailures()
	{
		expect(_InspectOciImageLayoutForImport(Buffer.from("not-a-zip", "utf8")).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.MalformedZipPackage });
		expect(_InspectOciImageLayoutForImport(_Zip([{ path: "note.txt", bytes: Buffer.from("not an OCI layout", "utf8") }])).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.NotOciImageLayout });
	});

	it("rejects missing, multiple and unsupported index manifest descriptors", function _RejectsInvalidIndexDescriptors()
	{
		const invalid = { mediaType: "application/vnd.oci.image.manifest.v1+json", digest: "not-a-digest", size: 1 };
		const unsupported = { mediaType: "application/vnd.docker.distribution.manifest.v2+json", digest: `sha256:${"0".repeat(64)}`, size: 1 };
		expect(_InspectOciImageLayoutForImport(_Layout({ indexManifests: [] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex });
		expect(_InspectOciImageLayoutForImport(_Layout({ indexManifests: [invalid] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex });
		expect(_InspectOciImageLayoutForImport(_Layout({ indexManifests: [unsupported] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex });
		expect(_InspectOciImageLayoutForImport(_Layout({ indexManifests: [invalid, invalid] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidIndex });
	});

	it("rejects malformed or unsupported configuration and layer descriptors", function _RejectsInvalidImageDescriptors()
	{
		const invalidConfig = { mediaType: "application/vnd.oci.image.config.v1+json", digest: "bad", size: 1 };
		const malformedLayer = { mediaType: "application/vnd.oci.image.layer.v1.tar", digest: `sha256:${"0".repeat(64)}` };
		const unsupportedLayer = { mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip", digest: `sha256:${"0".repeat(64)}`, size: 1 };
		expect(_InspectOciImageLayoutForImport(_Layout({ configDescriptor: invalidConfig })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ omitLayers: true })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ layerDescriptors: [malformedLayer] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ layerDescriptors: [unsupportedLayer] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
	});

	it("rejects missing blobs and every bad layer digest or declared size", function _RejectsIncompleteBlobClosure()
	{
		const missingDigest = `sha256:${"0".repeat(64)}`;
		const badDigestLayer = { mediaType: "application/vnd.oci.image.layer.v1.tar", digest: missingDigest, size: 1 };
		const mismatchedDigestBlob = { path: `blobs/sha256/${missingDigest.slice(7)}`, bytes: Buffer.from("x", "utf8") };
		const realLayer = Buffer.from("one immutable layer", "utf8");
		const badSizeLayer = { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: _Digest(realLayer), size: realLayer.byteLength + 1 };
		expect(_InspectOciImageLayoutForImport(_Layout({ omitConfigBlob: true })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ omitLayerBlob: true })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ layerDescriptors: [badDigestLayer], additionalEntries: [mismatchedDigestBlob] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ layerDescriptors: [badSizeLayer] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
	});

	it("rejects duplicate blob descriptors and a non-image manifest document", function _RejectsDuplicateOrWrongManifest()
	{
		const layer = Buffer.from("one immutable layer", "utf8");
		const descriptor = { mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: _Digest(layer), size: layer.byteLength };
		expect(_InspectOciImageLayoutForImport(_Layout({ layerDescriptors: [descriptor, descriptor] })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
		expect(_InspectOciImageLayoutForImport(_Layout({ manifestMediaType: "application/vnd.oci.artifact.manifest.v1+json" })).validation).toEqual({ accepted: false, failureCode: OciImageVerificationFailureCodes.InvalidImageManifest });
	});
});
