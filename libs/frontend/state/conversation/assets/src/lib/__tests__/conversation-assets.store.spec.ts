import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import { CONVERSATION_ASSETS_GATEWAY, type ConversationAssetsGateway } from "../conversation-assets-gateway.types.js";
import { ConversationAssetsStore } from "../conversation-assets.store.js";
import { ConversationAssetTransferPhases, type ConversationAsset } from "../conversation-assets.types.js";

/** One safe server projection fixture. */
function _Asset(state: ConversationAssetLifecycle = ConversationAssetLifecycle.Processing): ConversationAsset
{
	return { id: "asset-1", conversationId: "conversation-1", messageId: null, provenance: ConversationAssetProvenance.ParticipantUpload, state, displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, disposition: ConversationAssetDisposition.Preview, failureCode: null, canRemove: state === ConversationAssetLifecycle.Uploading, canRetry: false, createdAt: "2026-08-11T10:00:00.000Z" };
}

/** Minimal file with deterministic bytes for hashing in jsdom. */
function _File(name: string, type: string, text: string): File
{
	const bytes = new TextEncoder().encode(text);
	return { name, type, size: bytes.byteLength, arrayBuffer: async function _Bytes() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } } as File;
}

/** Build one component-scoped store with a controlled gateway. */
function _Store(gateway: ConversationAssetsGateway): ConversationAssetsStore
{
	TestBed.configureTestingModule({ providers: [ConversationAssetsStore, { provide: CONVERSATION_ASSETS_GATEWAY, useValue: gateway }] });
	return TestBed.inject(ConversationAssetsStore);
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationAssetsStore", function _Suite()
{
	it("rejects an unsupported batch without reserving any file", async function _RejectsSelection()
	{
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		await store.select([_File("data.sqlite", "application/vnd.sqlite3", "db")]);
		expect(store.selectionFailure()).toBe("unsupported_media_type");
		expect(gateway.reserve).not.toHaveBeenCalled();
	});

	it("reuses the exact reservation after an ambiguous transport failure", async function _RetriesReservation()
	{
		const asset = _Asset();
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(asset), upload: vi.fn().mockResolvedValue(asset), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		await store.select([_File("brief.pdf", "application/pdf", "brief")]);
		const failed = store.pendingUploads()[0];
		expect(failed?.phase).toBe(ConversationAssetTransferPhases.Failed);
		if (failed === undefined) throw new Error("failed intent missing");

		await store.retry(failed.idempotencyKey);

		expect(gateway.reserve).toHaveBeenCalledTimes(2);
		expect(gateway.reserve.mock.calls[1]?.[1]).toEqual(gateway.reserve.mock.calls[0]?.[1]);
		expect(gateway.upload).toHaveBeenCalledTimes(1);
		expect(store.pendingUploads()).toEqual([]);
	});

	it("retries upload bytes without reserving a second asset", async function _RetriesBytes()
	{
		const asset = _Asset();
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockResolvedValue(asset), upload: vi.fn().mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(asset), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		await store.select([_File("brief.pdf", "application/pdf", "brief")]);
		const failed = store.pendingUploads()[0];
		if (failed === undefined) throw new Error("failed intent missing");
		expect(failed.canRemove).toBe(false);

		await store.retry(failed.idempotencyKey);

		expect(gateway.reserve).toHaveBeenCalledTimes(1);
		expect(gateway.upload).toHaveBeenCalledTimes(2);
		expect(gateway.upload.mock.calls[1]?.[2]).toBe(gateway.upload.mock.calls[0]?.[2]);
	});

	it("uses only the server-granted removal capability and adopts its tombstone", async function _RemovesAuthorizedReservation()
	{
		const asset = _Asset(ConversationAssetLifecycle.Uploading);
		const removed = { ...asset, state: ConversationAssetLifecycle.Removed, displayName: "Attachment removed", canRemove: false };
		const gateway = { list: vi.fn().mockResolvedValue([asset]), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn().mockResolvedValue(removed) };
		const store = _Store(gateway);
		store.open("conversation-1");
		await vi.waitFor(function _Loaded() { expect(store.assets.hasValue()).toBe(true); });

		await store.remove(asset.id);

		expect(gateway.remove).toHaveBeenCalledWith("conversation-1", asset.id);
		expect(store.assets.value()).toEqual([removed]);
	});

	it("does not infer removal permission from lifecycle", async function _DoesNotInferRemoval()
	{
		const asset = { ..._Asset(ConversationAssetLifecycle.Uploading), canRemove: false };
		const gateway = { list: vi.fn().mockResolvedValue([asset]), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		await vi.waitFor(function _Loaded() { expect(store.assets.hasValue()).toBe(true); });
		await store.remove(asset.id);
		expect(gateway.remove).not.toHaveBeenCalled();
	});
});
