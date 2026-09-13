import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { McpToolCallResult } from "@opencrane/contracts";
import { ___CreateCsvFile } from "@opencrane/models/conversation-assets";
import { ___DigestCanonicalJson, type JsonValue } from "@opencrane/util";

import { _ParseGeneratedFileResource } from "../generated-file-resource";
import { GeneratedFileResourceOutcomes } from "../generated-file-resource.types";

describe("generated file resource capture", function _Suite()
{
	it("extracts exact UTF-8 bytes and binds the whole raw result", function _Accept()
	{
		const result = _Result("County,Total\r\nNairobi,42\r\n");
		const parsed = _Parse(result);
		expect(parsed.outcome).toBe(GeneratedFileResourceOutcomes.Accepted);
		if (parsed.outcome !== GeneratedFileResourceOutcomes.Accepted)
			throw new Error("expected accepted file");
		expect(Buffer.from(parsed.file.bytes).toString("utf8")).toBe("County,Total\r\nNairobi,42\r\n");
		expect(parsed.file.displayName).toBe("county-totals.csv");
		expect(parsed.file.contentAddress).toBe(`sha256:${createHash("sha256").update(parsed.file.bytes).digest("hex")}`);
		expect(parsed.file.rawResultDigest).toBe(___DigestCanonicalJson(result as unknown as JsonValue));
		expect(parsed.file).not.toHaveProperty("uri");
	});

	it("does not treat another tool's output as a generated file", function _OtherProducer()
	{
		expect(_ParseGeneratedFileResource("records.search", {}, { isError: false, content: [{ type: "text", text: "record found" }] })).toEqual({ outcome: GeneratedFileResourceOutcomes.NotApplicable });
		expect(_ParseGeneratedFileResource("records.search", {}, _Result("a\r\n"))).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
	});

	it("rejects errors, mixed content, blobs, structured data and alternate media types", function _RejectContent()
	{
		const result = _Result("a\r\n");
		const rejected: McpToolCallResult[] = [
			{ ...result, isError: true },
			{ ...result, content: [] },
			{ ...result, content: [...result.content, { type: "text", text: "extra" }] },
			{ ...result, structuredContent: { text: "hidden" } },
			{ ...result, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: "text/csv;charset=utf-8", blob: "YQ==" } }] },
			{ ...result, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: "text/html", text: "<script>bad</script>" } }] },
			{ ...result, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: "text/csv;charset=utf-8", text: "a", blob: "YQ==" } }] },
		];
		for (const candidate of rejected)
			expect(_Parse(candidate)).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
	});

	it("rejects fetchable or path-like URI substitutions and unsafe argument filenames", function _NoUriAuthority()
	{
		for (const uri of ["https://example.invalid/file.csv", "file:///tmp/file.csv", "../../file.csv"])
		{
			const result = { ..._Result("a"), content: [{ type: "resource", resource: { uri, mimeType: "text/csv;charset=utf-8", text: "a" } }] };
			expect(_Parse(result)).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
		}
		for (const displayName of ["../file.csv", "file.csv.exe", "=formula.csv", "a\r\n.csv", `${"x".repeat(125)}.csv`])
			expect(_ParseGeneratedFileResource("opencrane.files.create_csv", { displayName }, _Result("a"))).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
	});

	it("checks encoded byte length and rejects malformed Unicode", function _ByteLimits()
	{
		const argumentsValue = { displayName: "large.csv", headers: ["Value"], rows: Array.from({ length: 200 }, function _Row() { return ["é".repeat(2_048)]; }) };
		const expected = ___CreateCsvFile(argumentsValue);
		if (!expected.accepted)
			throw new Error("expected valid large CSV");
		expect(_ParseGeneratedFileResource("opencrane.files.create_csv", argumentsValue, _Result(expected.file.text)).outcome).toBe(GeneratedFileResourceOutcomes.Accepted);
		for (const text of ["", "a".repeat(1_048_577), "é".repeat(524_289), "\ud800"])
			expect(_Parse(_Result(text))).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
	});

	it("refuses formula injection or changed values even if the resource claims CSV", function _CompareAdmittedArguments()
	{
		for (const text of ["County,Total\r\nNairobi,=HYPERLINK(\"bad\")\r\n", "County,Total\r\nNairobi,43\r\n"])
			expect(_Parse(_Result(text))).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
		expect(_ParseGeneratedFileResource("opencrane.files.create_csv", { displayName: "file.csv", headers: ["Formula"], rows: [["  =HYPERLINK(\"bad\")"]] }, _Result("Formula\r\n  =HYPERLINK(\"bad\")\r\n"))).toEqual({ outcome: GeneratedFileResourceOutcomes.Rejected });
	});
});

/** Builds a standard embedded text resource without importing the producer implementation. */
function _Result(text: string): McpToolCallResult
{
	return { isError: false, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: "text/csv;charset=utf-8", text } }] };
}

/** Supplies the admitted producer name and filename for content-shape tests. */
function _Parse(result: McpToolCallResult)
{
	return _ParseGeneratedFileResource("opencrane.files.create_csv", { displayName: "county-totals.csv", headers: ["County", "Total"], rows: [["Nairobi", 42]] }, result);
}
