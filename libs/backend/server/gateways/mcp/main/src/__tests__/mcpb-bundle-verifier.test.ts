import { describe, expect, it } from "vitest";

import { _InspectMcpbBundle } from "../mcpb-validation/mcpb-bundle-verifier";
import { MCPB_MANIFEST_VERSION, McpbVerificationFailureCodes } from "../mcpb-validation/mcpb-validation.types";
import type { McpbSignatureObservation } from "../mcpb-validation/mcpb-validation.types";

/** Trusted signature facts used by parser-focused tests. */
const _TRUSTED_SIGNATURE: McpbSignatureObservation = { status: "signed", publisher: "Example Publisher", fingerprint: "a".repeat(64) };

/** Return the smallest valid manifest accepted by the pinned MCPB 0.3 schema. */
function _Manifest(overrides: Record<string, unknown> = {}): Record<string, unknown>
{
	return {
		manifest_version: MCPB_MANIFEST_VERSION,
		name: "example-server",
		version: "1.2.3",
		description: "An example MCP server.",
		author: { name: "Example Publisher" },
		server: { type: "node", entry_point: "server/index.js", mcp_config: { command: "node", args: ["${__dirname}/server/index.js"] } },
		...overrides,
	};
}

/** Build a small uncompressed ZIP file sufficient to exercise the bounded central-directory reader. */
function _Zip(entries: readonly { readonly name: string; readonly bytes: Buffer }[]): Buffer
{
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let localOffset = 0;
	for (const entry of entries)
	{
		const name = Buffer.from(entry.name, "utf8");
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt32LE(entry.bytes.byteLength, 18);
		local.writeUInt32LE(entry.bytes.byteLength, 22);
		local.writeUInt16LE(name.byteLength, 26);
		localParts.push(local, name, entry.bytes);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt32LE(entry.bytes.byteLength, 20);
		central.writeUInt32LE(entry.bytes.byteLength, 24);
		central.writeUInt16LE(name.byteLength, 28);
		central.writeUInt32LE(localOffset, 42);
		centralParts.push(central, name);
		localOffset += local.byteLength + name.byteLength + entry.bytes.byteLength;
	}
	const centralDirectory = Buffer.concat(centralParts);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralDirectory.byteLength, 12);
	end.writeUInt32LE(localOffset, 16);
	return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Build a bundle whose root manifest contains the supplied bytes. */
function _Bundle(manifest: Buffer): Buffer
{
	return _Zip([{ name: "manifest.json", bytes: manifest }, { name: "server/index.js", bytes: Buffer.from("export {};", "utf8") }]);
}

describe("MCPB bundle verifier", function _McpbBundleVerifierSuite()
{
	it("accepts one trusted bundle using the pinned manifest version", function _AcceptsTrustedBundle()
	{
		const result = _InspectMcpbBundle(_Bundle(Buffer.from(JSON.stringify(_Manifest()), "utf8")), _TRUSTED_SIGNATURE);

		expect(result).toEqual({
			accepted: true,
			manifest: {
				manifestVersion: MCPB_MANIFEST_VERSION,
				manifestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
				name: "example-server",
				version: "1.2.3",
				publisher: "Example Publisher",
				signerFingerprint: `sha256:${"a".repeat(64)}`,
			},
		});
	});

	it("rejects a bundle before parsing when the signature is not trusted", function _RejectsUnsignedBundle()
	{
		const bundle = _Bundle(Buffer.from(JSON.stringify(_Manifest()), "utf8"));

		expect(_InspectMcpbBundle(bundle, { status: "unsigned" })).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.InvalidSignature });
		expect(_InspectMcpbBundle(bundle, { status: "self-signed", publisher: "Local", fingerprint: "b".repeat(64) })).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.InvalidSignature });
	});

	it("rejects manifest versions other than the pinned version", function _RejectsOtherManifestVersion()
	{
		const bundle = _Bundle(Buffer.from(JSON.stringify(_Manifest({ manifest_version: "0.4" })), "utf8"));

		expect(_InspectMcpbBundle(bundle, _TRUSTED_SIGNATURE)).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.UnsupportedManifestVersion });
	});

	it("rejects invalid JSON and schema-invalid manifests with bounded reasons", function _RejectsInvalidManifest()
	{
		const invalidJson = _Bundle(Buffer.from("{", "utf8"));
		const missingServer = _Bundle(Buffer.from(JSON.stringify(_Manifest({ server: undefined })), "utf8"));

		expect(_InspectMcpbBundle(invalidJson, _TRUSTED_SIGNATURE)).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.InvalidManifest });
		expect(_InspectMcpbBundle(missingServer, _TRUSTED_SIGNATURE)).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.InvalidManifest });
	});

	it("rejects archives without exactly one root manifest", function _RejectsMissingOrDuplicateManifest()
	{
		const manifest = Buffer.from(JSON.stringify(_Manifest()), "utf8");
		const missing = _Zip([{ name: "nested/manifest.json", bytes: manifest }]);
		const duplicate = _Zip([{ name: "manifest.json", bytes: manifest }, { name: "manifest.json", bytes: manifest }]);

		expect(_InspectMcpbBundle(missing, _TRUSTED_SIGNATURE)).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.InvalidArchive });
		expect(_InspectMcpbBundle(duplicate, _TRUSTED_SIGNATURE)).toEqual({ accepted: false, failureCode: McpbVerificationFailureCodes.InvalidArchive });
	});
});
