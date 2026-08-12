import { Injector, runInInjectionContext } from "@angular/core";
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";

import { OpenCraneConversationAssetsGateway } from "../opencrane-conversation-assets-gateway.js";

const _ASSET = { id: "asset-1", conversationId: "conversation-1", messageId: null, provenance: "participant_upload" as const, state: "processing" as const, displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, disposition: "preview" as const, failureCode: null, canRemove: false, createdAt: "2026-08-11T10:00:00.000Z" };

/** Construct the adapter with controlled generated-client methods. */
function _Gateway(client: object): OpenCraneConversationAssetsGateway
{
	const injector = Injector.create({ providers: [{ provide: ControlPlaneApiService, useValue: { client } }] });
	return runInInjectionContext(injector, function _Create() { return new OpenCraneConversationAssetsGateway(); });
}

describe("OpenCraneConversationAssetsGateway", function _Suite()
{
	it("uses the typed conversation path and returns safe list metadata", async function _Lists()
	{
		const GET = vi.fn().mockResolvedValue({ data: { assets: [_ASSET] }, error: undefined });
		const assets = await _Gateway({ GET }).list("conversation-1");
		expect(GET).toHaveBeenCalledWith("/me/conversations/{conversationId}/assets", { params: { path: { conversationId: "conversation-1" } } });
		expect(assets).toEqual([_ASSET]);
	});

	it("uses the typed removal path and returns its sanitized tombstone", async function _Removes()
	{
		const removed = { ..._ASSET, state: "removed" as const, displayName: "Attachment removed" };
		const DELETE = vi.fn().mockResolvedValue({ data: { outcome: "accepted", asset: removed }, error: undefined });
		expect(await _Gateway({ DELETE }).remove("conversation-1", "asset-1")).toEqual(removed);
		expect(DELETE).toHaveBeenCalledWith("/me/conversations/{conversationId}/assets/{assetId}", { params: { path: { conversationId: "conversation-1", assetId: "asset-1" } } });
	});

	it("reads checked bytes through the participant route without receiving storage authority", async function _Reads()
	{
		const file = new Blob(["proof"], { type: "application/pdf" });
		const GET = vi.fn().mockResolvedValue({ data: file, error: undefined });
		expect(await _Gateway({ GET }).read("conversation-1", "asset-1")).toBe(file);
		expect(GET).toHaveBeenCalledWith("/me/conversations/{conversationId}/assets/{assetId}/content", { params: { path: { conversationId: "conversation-1", assetId: "asset-1" } }, parseAs: "blob" });
	});

	it("sends File bytes without JSON serialization", async function _UploadsExactBytes()
	{
		const PUT = vi.fn().mockResolvedValue({ data: { outcome: "accepted", asset: _ASSET }, error: undefined });
		const file = new File(["brief"], "brief.pdf", { type: "application/pdf" });
		await _Gateway({ PUT }).upload("conversation-1", "asset-1", file);
		const options = PUT.mock.calls[0]?.[1];
		expect(PUT.mock.calls[0]?.[0]).toBe("/me/conversations/{conversationId}/assets/{assetId}/content");
		expect(options.params.path).toEqual({ conversationId: "conversation-1", assetId: "asset-1" });
		expect(options.bodySerializer(options.body)).toBe(file);
		expect(options.headers).toEqual({ "Content-Type": "application/pdf" });
	});

	it("fails closed when the generated client returns no success payload", async function _FailsClosed()
	{
		const POST = vi.fn().mockResolvedValue({ data: undefined, error: { outcome: "denied", reason: "conversation_unavailable" } });
		await expect(_Gateway({ POST }).reserve("conversation-1", { idempotencyKey: "retry-1", displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, contentAddress: `sha256:${"a".repeat(64)}` })).rejects.toThrow("could not be reserved");
	});

	it("fails closed when a content response is not binary", async function _RejectsNonBinaryContent()
	{
		const GET = vi.fn().mockResolvedValue({ data: { lease: "must-not-be-used" }, error: undefined });
		await expect(_Gateway({ GET }).read("conversation-1", "asset-1")).rejects.toThrow("could not be opened");
	});
});
