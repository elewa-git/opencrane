import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import { extractSignatureBlock, verifyMcpbFile } from "@anthropic-ai/mcpb/node";
import { McpbManifestSchema } from "@anthropic-ai/mcpb/schemas/0.3";
import { ___DoWithTrace } from "@opencrane/backend/observability";

import { MCPB_MANIFEST_VERSION, MCPB_MAXIMUM_BUNDLE_BYTES, MCPB_MAXIMUM_MANIFEST_BYTES, McpbVerificationFailureCodes } from "./mcpb-validation.types";
import type { McpbBundleArtifactReader, McpbBundleArtifactTarget, McpbBundleVerifier, McpbSignatureObservation, McpbVerificationResult } from "./mcpb-validation.types";

/** ZIP end-of-directory marker used to find the central file list. */
const _ZIP_END_MARKER = 0x06054b50;
/** ZIP central-file marker used to read one entry without unpacking the archive. */
const _ZIP_CENTRAL_ENTRY_MARKER = 0x02014b50;
/** ZIP local-file marker used to locate the exact compressed manifest bytes. */
const _ZIP_LOCAL_ENTRY_MARKER = 0x04034b50;
/** ZIP method for files stored without compression. */
const _ZIP_STORED_METHOD = 0;
/** ZIP method for raw DEFLATE streams. */
const _ZIP_DEFLATE_METHOD = 8;
/** Maximum ZIP comment size allowed by the file format. */
const _ZIP_MAXIMUM_COMMENT_BYTES = 65_535;
/** Root file name required by the MCPB specification. */
const _MCPB_MANIFEST_PATH = "manifest.json";

/** Facts read from one ZIP central-directory entry. */
interface _ZipEntry
{
	/** ZIP compression method stored for this file. */
	readonly method: number;
	/** Number of bytes in the ZIP payload. */
	readonly compressedSize: number;
	/** Expected number of bytes after decompression. */
	readonly uncompressedSize: number;
	/** Offset of the matching local-file header. */
	readonly localHeaderOffset: number;
}

/** Convert the stream to one exact bounded buffer before signature verification starts. */
async function _CollectBundle(stream: ReadableStream<Uint8Array>, expectedLength: number): Promise<Buffer | null>
{
	if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > MCPB_MAXIMUM_BUNDLE_BYTES)
		return null;
	const reader = stream.getReader();
	const chunks: Buffer[] = [];
	let byteLength = 0;
	try
	{
		while (true)
		{
			const next = await reader.read();
			if (next.done)
				break;
			byteLength += next.value.byteLength;
			if (byteLength > expectedLength || byteLength > MCPB_MAXIMUM_BUNDLE_BYTES)
				return null;
			chunks.push(Buffer.from(next.value));
		}
	}
	finally
	{
		reader.releaseLock();
	}
	if (byteLength !== expectedLength)
		return null;
	return Buffer.concat(chunks, byteLength);
}

/** Find the last valid ZIP end marker without trusting the stored comment length. */
function _FindZipEnd(zip: Buffer): number
{
	const firstCandidate = Math.max(0, zip.byteLength - 22 - _ZIP_MAXIMUM_COMMENT_BYTES);
	for (let offset = zip.byteLength - 22; offset >= firstCandidate; offset -= 1)
	{
		if (zip.readUInt32LE(offset) === _ZIP_END_MARKER)
			return offset;
	}
	return -1;
}

/** Read one root manifest entry while rejecting duplicate, encrypted, ZIP64, or malformed entries. */
function _FindManifestEntry(zip: Buffer): _ZipEntry | null
{
	const endOffset = _FindZipEnd(zip);
	if (endOffset < 0 || endOffset + 22 > zip.byteLength)
		return null;
	const entryCount = zip.readUInt16LE(endOffset + 10);
	const centralSize = zip.readUInt32LE(endOffset + 12);
	const centralOffset = zip.readUInt32LE(endOffset + 16);
	if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize > endOffset)
		return null;

	let offset = centralOffset;
	let manifest: _ZipEntry | null = null;
	for (let index = 0; index < entryCount; index += 1)
	{
		if (offset + 46 > zip.byteLength || zip.readUInt32LE(offset) !== _ZIP_CENTRAL_ENTRY_MARKER)
			return null;
		const flags = zip.readUInt16LE(offset + 8);
		const method = zip.readUInt16LE(offset + 10);
		const compressedSize = zip.readUInt32LE(offset + 20);
		const uncompressedSize = zip.readUInt32LE(offset + 24);
		const nameLength = zip.readUInt16LE(offset + 28);
		const extraLength = zip.readUInt16LE(offset + 30);
		const commentLength = zip.readUInt16LE(offset + 32);
		const localHeaderOffset = zip.readUInt32LE(offset + 42);
		const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
		if ((flags & 0x0001) !== 0 || nextOffset > zip.byteLength)
			return null;
		const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
		if (name === _MCPB_MANIFEST_PATH)
		{
			if (manifest !== null || uncompressedSize > MCPB_MAXIMUM_MANIFEST_BYTES || compressedSize > MCPB_MAXIMUM_BUNDLE_BYTES)
				return null;
			manifest = { method, compressedSize, uncompressedSize, localHeaderOffset };
		}
		offset = nextOffset;
	}
	if (offset !== centralOffset + centralSize)
		return null;
	return manifest;
}

/** Decompress only the bounded root manifest instead of unpacking untrusted bundle files. */
function _ReadManifest(zip: Buffer): Buffer | null
{
	const entry = _FindManifestEntry(zip);
	if (entry === null || entry.localHeaderOffset + 30 > zip.byteLength || zip.readUInt32LE(entry.localHeaderOffset) !== _ZIP_LOCAL_ENTRY_MARKER)
		return null;
	const nameLength = zip.readUInt16LE(entry.localHeaderOffset + 26);
	const extraLength = zip.readUInt16LE(entry.localHeaderOffset + 28);
	const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
	if (dataOffset + entry.compressedSize > zip.byteLength)
		return null;
	const compressed = zip.subarray(dataOffset, dataOffset + entry.compressedSize);
	let manifest: Buffer;
	try
	{
		if (entry.method === _ZIP_STORED_METHOD)
			manifest = Buffer.from(compressed);
		else if (entry.method === _ZIP_DEFLATE_METHOD)
			manifest = inflateRawSync(compressed, { maxOutputLength: MCPB_MAXIMUM_MANIFEST_BYTES });
		else
			return null;
	}
	catch
	{
		return null;
	}
	return manifest.byteLength === entry.uncompressedSize ? manifest : null;
}

/** Parse and validate a trusted bundle against the exact MCPB 0.3 schema. */
export function _InspectMcpbBundle(bundle: Buffer, signature: McpbSignatureObservation): McpbVerificationResult
{
	if (signature.status !== "signed" || !signature.publisher || !/^[a-f0-9]{64}$/u.test(signature.fingerprint ?? ""))
		return { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidSignature };
	const zip = extractSignatureBlock(bundle).originalContent;
	const manifestBytes = _ReadManifest(zip);
	if (manifestBytes === null)
		return { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidArchive };
	let parsed: unknown;
	try
	{
		parsed = JSON.parse(manifestBytes.toString("utf8"));
	}
	catch
	{
		return { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidManifest };
	}
	if (typeof parsed !== "object" || parsed === null || !("manifest_version" in parsed) || parsed.manifest_version !== MCPB_MANIFEST_VERSION)
		return { accepted: false, failureCode: McpbVerificationFailureCodes.UnsupportedManifestVersion };
	const manifest = McpbManifestSchema.safeParse(parsed);
	if (!manifest.success)
		return { accepted: false, failureCode: McpbVerificationFailureCodes.InvalidManifest };
	return { accepted: true, manifest: { manifestVersion: MCPB_MANIFEST_VERSION, manifestDigest: `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`, name: manifest.data.name, version: manifest.data.version, publisher: signature.publisher, signerFingerprint: `sha256:${signature.fingerprint}` } };
}

/** Verify a bundle signature through the official pinned MCPB implementation and operating-system trust store. */
async function _VerifySignature(bundle: Buffer): Promise<McpbSignatureObservation>
{
	const directory = await mkdtemp(join(tmpdir(), "opencrane-mcpb-"));
	const path = join(directory, "candidate.mcpb");
	try
	{
		await writeFile(path, bundle, { mode: 0o600 });
		return await verifyMcpbFile(path);
	}
	finally
	{
		await rm(directory, { recursive: true, force: true });
	}
}

/**
 * Build the adapter that reads, authenticates, and validates one immutable MCP bundle.
 *
 * Called by: the OpenCrane MCP workflow composition when it registers the `.mcpb` validation job.
 * @param reader - Server-owned artifact reader that keeps leases and storage locations private.
 * @returns A verifier suitable for the MCP workflow port.
 * @see https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md
 * @see https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md
 */
export function __CreateMcpbBundleVerifier(reader: McpbBundleArtifactReader): McpbBundleVerifier
{
	return {
		async verify(target: McpbBundleArtifactTarget): Promise<McpbVerificationResult>
		{
			return ___DoWithTrace("mcpb.bundle.verify", { siloId: target.siloId, artifactId: target.artifactId, artifactRevisionId: target.artifactRevisionId, byteLength: target.byteLength }, async function _VerifyBundle(): Promise<McpbVerificationResult>
			{
				// 1. Re-read the exact published artifact and stop before parsing when its saved byte facts differ.
				const bundle = await _CollectBundle(await reader.read(target), target.byteLength);
				if (bundle === null || `sha256:${createHash("sha256").update(bundle).digest("hex")}` !== target.contentAddress)
					return { accepted: false, failureCode: target.byteLength > MCPB_MAXIMUM_BUNDLE_BYTES ? McpbVerificationFailureCodes.BundleTooLarge : McpbVerificationFailureCodes.ArtifactMismatch };

				// 2. Verify the detached signature before any untrusted manifest field is accepted.
				const signature = await _VerifySignature(bundle);

				// 3. Read only the bounded root manifest and validate it against the pinned schema.
				return _InspectMcpbBundle(bundle, signature);
			});
		},
	};
}
