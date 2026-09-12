import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationAssetDisposition, ConversationAssetLifecycle, ConversationAssetProvenance } from "@opencrane/models/conversation-assets";

import { ConversationAssetContentStore } from "../conversation-asset-content.store";
import { CONVERSATION_ASSETS_GATEWAY, type ConversationAssetsGateway } from "../conversation-assets-gateway.types";
import { ConversationAssetContentCommandStates, type ConversationAsset } from "../conversation-assets.types";

/** Build one authorized Ready asset projection. */
function _Asset(id = "asset-1", overrides: Partial<ConversationAsset> = {}): ConversationAsset
{
	return { id, conversationId: "conversation-1", messageId: null, artifactId: null, artifactRevisionId: null, provenance: ConversationAssetProvenance.ParticipantUpload, state: ConversationAssetLifecycle.Ready, displayName: `${id}.pdf`, mediaType: "application/pdf", byteLength: 5, disposition: ConversationAssetDisposition.Preview, failureCode: null, canRemove: false, createdAt: "2026-09-12T08:00:00.000Z", ...overrides };
}

/** Controlled promise for read and selection race tests. */
function _Deferred<Value>(): { readonly promise: Promise<Value>; readonly resolve: (value: Value) => void; readonly reject: (reason: unknown) => void }
{
	let resolvePromise: ((value: Value) => void) | undefined;
	let rejectPromise: ((reason: unknown) => void) | undefined;
	const promise = new Promise<Value>(function _Create(resolve, reject) { resolvePromise = resolve; rejectPromise = reject; });
	return {
		promise,
		resolve: function _Resolve(value) { if (resolvePromise === undefined)
			throw new Error("Deferred promise is unavailable."); resolvePromise(value); },
		reject: function _Reject(reason) { if (rejectPromise === undefined)
			throw new Error("Deferred promise is unavailable."); rejectPromise(reason); }
	};
}

/** Build one component-scoped content store with a controlled gateway. */
function _Store(read: ConversationAssetsGateway["read"]): ConversationAssetContentStore
{
	const gateway: ConversationAssetsGateway = { list: vi.fn(), read, reserve: vi.fn(), upload: vi.fn(), remove: vi.fn() };
	TestBed.configureTestingModule({ providers: [ConversationAssetContentStore, { provide: CONVERSATION_ASSETS_GATEWAY, useValue: gateway }] });
	return TestBed.inject(ConversationAssetContentStore);
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });

describe("ConversationAssetContentStore", function _Suite()
{
	it("returns verified bytes without retaining them in command state", async function _Reads()
	{
		const read = vi.fn().mockResolvedValue(new Blob(["brief"], { type: "application/pdf" }));
		const store = _Store(read);
		const assets = [_Asset()];
		store.open("conversation-1", function _Assets() { return assets; });

		const result = await store.read("asset-1");

		expect(read).toHaveBeenCalledWith("conversation-1", "asset-1");
		expect(result).toMatchObject({ displayName: "asset-1.pdf", mediaType: "application/pdf", byteLength: 5, disposition: ConversationAssetDisposition.Preview });
		expect(result?.blob).toBeInstanceOf(Blob);
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Idle);
	});

	it("refuses a duplicate before transport while independent assets continue", async function _Duplicate()
	{
		const first = _Deferred<Blob>();
		const read = vi.fn().mockImplementation(function _Read(_conversationId: string, assetId: string)
		{
			return assetId === "asset-1" ? first.promise : Promise.resolve(new Blob(["other"], { type: "application/pdf" }));
		});
		const store = _Store(read);
		store.open("conversation-1", function _Assets() { return [_Asset(), _Asset("asset-2")]; });

		const pending = store.read("asset-1");
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Loading);
		expect(await store.read("asset-1")).toBeNull();
		expect(await store.read("asset-2")).not.toBeNull();
		expect(read).toHaveBeenCalledTimes(2);
		first.resolve(new Blob(["brief"], { type: "application/pdf" }));
		expect(await pending).not.toBeNull();
	});

	it("keeps a safe per-asset failure and admits an explicit retry", async function _Retries()
	{
		const read = vi.fn().mockRejectedValueOnce(new Error("private transport detail")).mockResolvedValueOnce(new Blob(["brief"], { type: "application/pdf" }));
		const store = _Store(read);
		store.open("conversation-1", function _Assets() { return [_Asset()]; });

		expect(await store.read("asset-1")).toBeNull();
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Failed);
		expect(await store.read("asset-1")).not.toBeNull();
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Idle);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("drops a late result after clear and reopening the same conversation", async function _StaleScope()
	{
		const deferred = _Deferred<Blob>();
		const store = _Store(vi.fn().mockReturnValue(deferred.promise));
		store.open("conversation-1", function _Assets() { return [_Asset()]; });
		const pending = store.read("asset-1");

		store.clear();
		store.open("conversation-1", function _Assets() { return [_Asset()]; });
		deferred.resolve(new Blob(["brief"], { type: "application/pdf" }));

		expect(await pending).toBeNull();
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Idle);
	});

	it("fails closed when bytes or current metadata differ from admission", async function _MetadataMismatch()
	{
		let assets: readonly ConversationAsset[] = [_Asset()];
		const read = vi.fn().mockResolvedValue(new Blob(["wrong-size"], { type: "application/pdf" }));
		const store = _Store(read);
		store.open("conversation-1", function _Assets() { return assets; });

		expect(await store.read("asset-1")).toBeNull();
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Failed);

		const deferred = _Deferred<Blob>();
		read.mockReturnValueOnce(deferred.promise);
		const pending = store.read("asset-1");
		assets = [_Asset("asset-1", { displayName: "replaced.pdf" })];
		deferred.resolve(new Blob(["brief"], { type: "application/pdf" }));
		expect(await pending).toBeNull();
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Idle);
	});

	it("releases Loading when a rejected read outlives an asset lifecycle change", async function _RejectedAfterLifecycleChange()
	{
		let assets: readonly ConversationAsset[] = [_Asset()];
		const deferred = _Deferred<Blob>();
		const read = vi.fn().mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(new Blob(["brief"], { type: "application/pdf" }));
		const store = _Store(read);
		store.open("conversation-1", function _Assets() { return assets; });
		const pending = store.read("asset-1");

		assets = [_Asset("asset-1", { state: ConversationAssetLifecycle.Removed })];
		deferred.reject(new Error("private transport detail"));
		expect(await pending).toBeNull();
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Idle);

		assets = [_Asset()];
		expect(await store.read("asset-1")).not.toBeNull();
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("does not let Blob metadata or an unsafe projection grant Preview", async function _SafeDisposition()
	{
		const read = vi.fn().mockResolvedValue(new Blob(["brief"], { type: "application/pdf" }));
		const store = _Store(read);
		let assets: readonly ConversationAsset[] = [_Asset("asset-1", { mediaType: "text/html", disposition: ConversationAssetDisposition.Preview })];
		store.open("conversation-1", function _Assets() { return assets; });

		expect(store.disposition("asset-1")).toBeNull();
		expect(await store.read("asset-1")).toBeNull();
		expect(read).not.toHaveBeenCalled();

		assets = [_Asset("asset-1", { disposition: ConversationAssetDisposition.Download })];
		expect(store.disposition("asset-1")).toBeNull();
		expect(await store.read("asset-1")).toBeNull();
		expect(read).not.toHaveBeenCalled();
	});

	it("does not read a retained list row from another conversation scope", async function _ConversationFence()
	{
		const read = vi.fn();
		const store = _Store(read);
		store.open("conversation-2", function _Assets() { return [_Asset()]; });

		expect(store.disposition("asset-1")).toBeNull();
		expect(await store.read("asset-1")).toBeNull();
		expect(read).not.toHaveBeenCalled();
	});

	it("records a platform failure only for a current Ready asset", function _PlatformFailure()
	{
		let assets: readonly ConversationAsset[] = [_Asset()];
		const store = _Store(vi.fn());
		store.open("conversation-1", function _Assets() { return assets; });
		store.markFailed("asset-1");
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Failed);

		assets = [_Asset("asset-1", { state: ConversationAssetLifecycle.Removed })];
		store.clear();
		store.open("conversation-1", function _Assets() { return assets; });
		store.markFailed("asset-1");
		expect(store.state("asset-1")).toBe(ConversationAssetContentCommandStates.Idle);
	});
});
