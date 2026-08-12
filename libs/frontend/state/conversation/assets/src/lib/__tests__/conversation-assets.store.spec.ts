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
	return { id: "asset-1", conversationId: "conversation-1", messageId: null, provenance: ConversationAssetProvenance.ParticipantUpload, state, displayName: "brief.pdf", mediaType: "application/pdf", byteLength: 5, disposition: ConversationAssetDisposition.Preview, failureCode: null, canRemove: state === ConversationAssetLifecycle.Uploading, createdAt: "2026-08-11T10:00:00.000Z" };
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

/** Controlled promise for conversation-switch race tests. */
function _Deferred<Value>(): { readonly promise: Promise<Value>; readonly resolve: (value: Value) => void }
{
	let resolvePromise: ((value: Value) => void) | undefined;
	const promise = new Promise<Value>(function _Create(resolve) { resolvePromise = resolve; });
	return { promise, resolve: function _Resolve(value) { if (resolvePromise === undefined) throw new Error("Deferred promise is unavailable."); resolvePromise(value); } };
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationAssetsStore", function _Suite()
{
	it("reloads once for each newly streamed asset invalidation in the selected conversation", async function _LiveInvalidation()
	{
		const gateway = { list: vi.fn().mockResolvedValueOnce([_Asset()]).mockResolvedValueOnce([_Asset(ConversationAssetLifecycle.Ready)]), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		await vi.waitFor(function _Loaded() { expect(store.assets.hasValue()).toBe(true); });
		store.observeInvalidations("conversation-1", ["opencrane.conversation_assets_changed"]);
		store.observeInvalidations("conversation-1", ["opencrane.conversation_assets_changed"]);
		store.observeInvalidations("conversation-2", ["opencrane.conversation_assets_changed", "opencrane.conversation_assets_changed"]);
		await vi.waitFor(function _Reloaded() { expect(gateway.list).toHaveBeenCalledTimes(2); expect(store.assets.value()?.[0]?.state).toBe(ConversationAssetLifecycle.Ready); });
	});
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

	it("discards a reservation that completes after switching conversations", async function _DiscardsLateReservation()
	{
		const deferred = _Deferred<ConversationAsset>();
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockReturnValue(deferred.promise), upload: vi.fn(), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		const selection = store.select([_File("brief.pdf", "application/pdf", "brief")]);
		await vi.waitFor(function _Reserved() { expect(gateway.reserve).toHaveBeenCalledOnce(); });

		store.open("conversation-2");
		deferred.resolve(_Asset());
		await selection;
		await vi.waitFor(function _LoadedNewScope() { expect(gateway.list).toHaveBeenCalledWith("conversation-2"); expect(store.assets.value()).toEqual([]); });
		expect(gateway.upload).not.toHaveBeenCalled();
	});

	it("discards an upload that completes after switching conversations", async function _DiscardsLateUpload()
	{
		const deferred = _Deferred<ConversationAsset>();
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockResolvedValue(_Asset(ConversationAssetLifecycle.Uploading)), upload: vi.fn().mockReturnValue(deferred.promise), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		const selection = store.select([_File("brief.pdf", "application/pdf", "brief")]);
		await vi.waitFor(function _Uploading() { expect(gateway.upload).toHaveBeenCalledOnce(); });

		store.open("conversation-2");
		deferred.resolve(_Asset(ConversationAssetLifecycle.Processing));
		await selection;
		await vi.waitFor(function _LoadedNewScope() { expect(gateway.list).toHaveBeenCalledWith("conversation-2"); expect(store.assets.value()).toEqual([]); });
	});

	it("discards an old reservation after switching away and back", async function _DiscardsOldGeneration()
	{
		const deferred = _Deferred<ConversationAsset>();
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockReturnValue(deferred.promise), upload: vi.fn(), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		const selection = store.select([_File("brief.pdf", "application/pdf", "brief")]);
		await vi.waitFor(function _Reserved() { expect(gateway.reserve).toHaveBeenCalledOnce(); });

		store.open("conversation-2");
		store.open("conversation-1");
		deferred.resolve(_Asset());
		await selection;
		await vi.waitFor(function _ReloadedOriginalScope() { expect(gateway.list).toHaveBeenLastCalledWith("conversation-1"); expect(store.assets.value()).toEqual([]); });
		expect(gateway.upload).not.toHaveBeenCalled();
	});

	it("discards an old upload after switching away and back", async function _DiscardsOldUploadGeneration()
	{
		const deferred = _Deferred<ConversationAsset>();
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockResolvedValue(_Asset(ConversationAssetLifecycle.Uploading)), upload: vi.fn().mockReturnValue(deferred.promise), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		const selection = store.select([_File("brief.pdf", "application/pdf", "brief")]);
		await vi.waitFor(function _Uploading() { expect(gateway.upload).toHaveBeenCalledOnce(); });

		store.open("conversation-2");
		store.open("conversation-1");
		deferred.resolve(_Asset(ConversationAssetLifecycle.Processing));
		await selection;
		await vi.waitFor(function _ReloadedOriginalScope() { expect(gateway.list).toHaveBeenLastCalledWith("conversation-1"); expect(store.assets.value()).toEqual([]); });
	});

	it("discards a removal tombstone after switching conversations", async function _DiscardsLateRemoval()
	{
		const asset = _Asset(ConversationAssetLifecycle.Uploading);
		const deferred = _Deferred<ConversationAsset>();
		const gateway = { list: vi.fn().mockImplementation(async function _List(conversationId: string) { return conversationId === "conversation-1" ? [asset] : []; }), reserve: vi.fn(), upload: vi.fn(), remove: vi.fn().mockReturnValue(deferred.promise) };
		const store = _Store(gateway);
		store.open("conversation-1");
		await vi.waitFor(function _Loaded() { expect(store.assets.hasValue()).toBe(true); expect(store.assets.value()).toEqual([asset]); });
		const removal = store.remove(asset.id);
		await vi.waitFor(function _Removing() { expect(gateway.remove).toHaveBeenCalledOnce(); });

		store.open("conversation-2");
		deferred.resolve({ ...asset, state: ConversationAssetLifecycle.Removed, displayName: "Attachment removed", canRemove: false });
		await removal;
		await vi.waitFor(function _LoadedNewScope() { expect(store.assets.value()).toEqual([]); });
	});

	it("rejects a gateway asset for another conversation", async function _RejectsWrongConversation()
	{
		const gateway = { list: vi.fn().mockResolvedValue([]), reserve: vi.fn().mockResolvedValue({ ..._Asset(ConversationAssetLifecycle.Uploading), conversationId: "conversation-2" }), upload: vi.fn(), remove: vi.fn() };
		const store = _Store(gateway);
		store.open("conversation-1");
		await vi.waitFor(function _Loaded() { expect(store.assets.hasValue()).toBe(true); });

		await store.select([_File("brief.pdf", "application/pdf", "brief")]);

		expect(store.assets.value()).toEqual([]);
		expect(gateway.upload).not.toHaveBeenCalled();
		expect(store.pendingUploads()[0]).toMatchObject({ phase: ConversationAssetTransferPhases.Failed, failureCode: "reservation_failed" });
	});
});
