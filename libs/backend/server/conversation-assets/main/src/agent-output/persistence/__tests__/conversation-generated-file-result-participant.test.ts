import { describe, expect, it, vi } from "vitest";

import type { McpToolCallResult } from "@opencrane/contracts";
import { ___CreateCsvFile, GENERATED_CSV_TOOL_NAME } from "@opencrane/models/conversation-assets";

import { ConversationGeneratedFileResultParticipant } from "../conversation-generated-file-result-participant";
import { GeneratedFileCaptureOutcomes } from "../generated-file-capture.types";
import type { GeneratedFileInvocationResultCommand } from "../generated-file-invocation-evidence.types";

/** Arguments and bytes are produced by the same validator used in the isolated CSV app. */
const _ARGUMENTS = { displayName: "counties.csv", headers: ["County"], rows: [["Nairobi"]] };

/** Return one real serializer result as the MCP resource protocol expects it. */
function _Resource(): McpToolCallResult
{
	const csv = ___CreateCsvFile(_ARGUMENTS);
	if (!csv.accepted)
		throw new Error("CSV fixture was rejected");
	return { isError: false, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: csv.file.mediaType, text: csv.file.text } }] };
}

/** Observe only the wrapper boundary; capture authority and persistence have their own proofs. */
function _Fixture(toolName = GENERATED_CSV_TOOL_NAME, result = _Resource(), scannerEnabled = true)
{
	const command = { toolName, invocation: { effectiveArguments: _ARGUMENTS }, result } as unknown as GeneratedFileInvocationResultCommand;
	const metadata: McpToolCallResult = { isError: false, content: [{ type: "text", text: "Saved file metadata" }] };
	const capture = vi.fn().mockResolvedValue({ outcome: GeneratedFileCaptureOutcomes.Captured, result: metadata });
	const createCapture = vi.fn().mockReturnValue({ capture });
	const admit = vi.fn();
	const participant = new ConversationGeneratedFileResultParticipant(createCapture, { admit }, scannerEnabled);
	return { command, metadata, capture, createCapture, admit, participant };
}

describe("generated-file result transaction participant", function _Suite()
{
	it.each([true, false])("preserves ordinary results with scanner enabled=%s", async function _OrdinaryResult(scannerEnabled)
	{
		const f = _Fixture("records.read", { isError: false, content: [{ type: "text", text: "permitted record" }] }, scannerEnabled);
		await expect(f.participant.prepare(f.command)).resolves.toBe(f.command.result);
		expect(f.createCapture).not.toHaveBeenCalled();
		expect(f.admit).not.toHaveBeenCalled();
	});

	it("rejects an embedded resource from an unowned result format", async function _UnknownResource()
	{
		const f = _Fixture("records.read");
		await expect(f.participant.prepare(f.command)).rejects.toThrow("Generated file result was rejected");
		expect(f.createCapture).not.toHaveBeenCalled();
	});

	it("returns capture metadata instead of original file bytes", async function _CapturedResult()
	{
		const f = _Fixture();
		await expect(f.participant.prepare(f.command)).resolves.toBe(f.metadata);
		expect(f.capture).toHaveBeenCalledExactlyOnceWith(f.command);
	});

	it("refuses changed bytes before opening capture persistence", async function _ChangedBytes()
	{
		const f = _Fixture();
		const result: McpToolCallResult = { isError: false, content: [{ type: "resource", resource: { uri: "urn:opencrane:generated-file:csv", mimeType: "text/csv;charset=utf-8", text: "County\r\nchanged\r\n" } }] };
		await expect(f.participant.prepare({ ...f.command, result })).rejects.toThrow("Generated file result was rejected");
		expect(f.createCapture).not.toHaveBeenCalled();
	});

	it("cannot fall back to raw terminal JSON when eligible capture declines or fails", async function _NoFallback()
	{
		const f = _Fixture();
		f.capture.mockResolvedValueOnce({ outcome: GeneratedFileCaptureOutcomes.NotApplicable }).mockRejectedValueOnce(new Error("transaction failed"));
		await expect(f.participant.prepare(f.command)).rejects.toThrow("did not return durable metadata");
		await expect(f.participant.prepare(f.command)).rejects.toThrow("transaction failed");
	});
	it("rejects supported resources before storage when scanning is disabled", async function _DisabledScanner()
	{
		const f = _Fixture(GENERATED_CSV_TOOL_NAME, _Resource(), false);
		await expect(f.participant.prepare(f.command)).rejects.toThrow("requires an enabled scanner");
		expect(f.createCapture).not.toHaveBeenCalled();
		expect(f.capture).not.toHaveBeenCalled();
		expect(f.admit).not.toHaveBeenCalled();
	});

});
