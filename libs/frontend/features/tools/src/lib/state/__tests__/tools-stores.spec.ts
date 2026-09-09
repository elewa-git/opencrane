// @vitest-environment jsdom
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { McpApprovalStatus, McpConnectionStatus, McpServerType, type McpServer } from "@opencrane/core";
import { MCP_GATEWAY, type McpGateway } from "@opencrane/state/mcp/adapter";
import { ModelProvider, PROVIDER_KEY_GATEWAY, type ProviderKeyGateway } from "@opencrane/state/provider-key/adapter";
import { SessionStore } from "@opencrane/state/core";
import { ToolsInventoryStore } from "../tools-inventory.store";
import { _FilterCatalogue, _InstalledToolRows } from "../tools-inventory.mapper";
import { ToolCatalogueFilters } from "../tools-inventory.types";
import { CatalogueAdminStore } from "../../admin/catalogue-admin/state/catalogue-admin.store";
import { ModelKeysAdminStore } from "../../admin/model-keys-admin/state/model-keys-admin.store";

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset() { TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

/** Produces server-owned status without credentials. */
function _Server(id: string): McpServer
{
	return { id, name: id, description: "Farm reporting", publisher: "Elewa", glyph: "FR", type: McpServerType.MultiUser, approvalStatus: McpApprovalStatus.PendingReview, credentialSchema: [], entitlementSummary: "Workspace" };
}

/** Creates the complete gateway while each test controls its asynchronous command. */
function _Gateway(): McpGateway
{
	return { listEntitledCatalogue: vi.fn().mockResolvedValue([]), listInstalled: vi.fn().mockResolvedValue([]), install: vi.fn(), uninstall: vi.fn(), listCatalogue: vi.fn().mockResolvedValue([]), approve: vi.fn(), publish: vi.fn(), reject: vi.fn(), setEnabled: vi.fn() };
}

/** Creates the write-only provider port used by the key store. */
function _KeyGateway(): ProviderKeyGateway { return { list: vi.fn().mockResolvedValue([]), setKey: vi.fn(), deleteKey: vi.fn() }; }

/** Supplies a controllable asynchronous completion. */
function _Deferred<T>()
{
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>(function _Pending(accept, fail) { resolve = accept; reject = fail; });
	return { promise, resolve, reject };
}

/** Session capability is a presentation guard; gateway authorization remains mandatory. */
function _Session(customerAdmin = true) { return { capabilities: signal({ customerAdmin }) }; }

describe("tools route stores", function _Stores()
{
	it("rejects duplicate install admission while allowing independent targets", async function _InstallConcurrency()
	{
		const gateway = _Gateway();
		const first = _Deferred<Awaited<ReturnType<McpGateway["install"]>>>();
		const second = _Deferred<Awaited<ReturnType<McpGateway["install"]>>>();
		vi.mocked(gateway.install).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		TestBed.configureTestingModule({ providers: [ToolsInventoryStore, { provide: MCP_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ToolsInventoryStore);
		const a = store.install("a");
		const b = store.install("b");
		await store.install("a");
		expect(gateway.install).toHaveBeenCalledTimes(2);
		first.resolve({ serverId: "a", connectionStatus: McpConnectionStatus.SharedKey, lastUsed: null });
		await a;
		expect(store.busy().has("a")).toBe(false);
		expect(store.busy().has("b")).toBe(true);
		second.resolve({ serverId: "b", connectionStatus: McpConnectionStatus.SharedKey, lastUsed: null });
		await b;
		expect(store.busy().size).toBe(0);
	});

	it("retains a retryable command error and releases failed removal", async function _RemovalFailure()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.uninstall).mockRejectedValue(new Error("Unavailable"));
		TestBed.configureTestingModule({ providers: [ToolsInventoryStore, { provide: MCP_GATEWAY, useValue: gateway }] });
		const store = TestBed.inject(ToolsInventoryStore);
		await store.uninstall("a");
		expect(store.error()).toContain("could not be removed");
		expect(store.busy().size).toBe(0);
	});

	it("serialises competing governance actions for the same server", async function _GovernanceConcurrency()
	{
		const gateway = _Gateway();
		const pending = _Deferred<McpServer>();
		vi.mocked(gateway.approve).mockReturnValue(pending.promise);
		TestBed.configureTestingModule({ providers: [CatalogueAdminStore, { provide: MCP_GATEWAY, useValue: gateway }, { provide: SessionStore, useValue: _Session() }] });
		const store = TestBed.inject(CatalogueAdminStore);
		const server = _Server("a");
		const approval = store.approve(server);
		await store.reject(server);
		expect(gateway.reject).not.toHaveBeenCalled();
		pending.resolve({ ...server, approvalStatus: McpApprovalStatus.Approved });
		await approval;
		expect(store.busy().size).toBe(0);
	});

	it("does not dispatch governance commands after administration access changes", async function _DeniedGovernance()
	{
		const gateway = _Gateway();
		TestBed.configureTestingModule({ providers: [CatalogueAdminStore, { provide: MCP_GATEWAY, useValue: gateway }, { provide: SessionStore, useValue: _Session(false) }] });
		const store = TestBed.inject(CatalogueAdminStore);
		await store.approve(_Server("a"));
		await store.publish(_Server("a"));
		await store.setEnabled(_Server("a"), true);
		expect(gateway.approve).not.toHaveBeenCalled();
		expect(gateway.publish).not.toHaveBeenCalled();
		expect(gateway.setEnabled).not.toHaveBeenCalled();
	});

	it("preserves a newer key draft and another provider's busy state after completion", async function _KeyConcurrency()
	{
		const gateway = _KeyGateway();
		const pending = _Deferred<Awaited<ReturnType<ProviderKeyGateway["setKey"]>>>();
		const other = _Deferred<Awaited<ReturnType<ProviderKeyGateway["setKey"]>>>();
		vi.mocked(gateway.setKey).mockReturnValueOnce(pending.promise).mockReturnValueOnce(other.promise);
		TestBed.configureTestingModule({ providers: [ModelKeysAdminStore, { provide: PROVIDER_KEY_GATEWAY, useValue: gateway }, { provide: SessionStore, useValue: _Session() }] });
		const store = TestBed.inject(ModelKeysAdminStore);
		store.setDraft(ModelProvider.OpenAi, " original ");
		store.setDraft(ModelProvider.Anthropic, "other");
		const first = store.submit(ModelProvider.OpenAi);
		const second = store.submit(ModelProvider.Anthropic);
		await store.submit(ModelProvider.OpenAi);
		await store.remove(ModelProvider.OpenAi);
		expect(gateway.setKey).toHaveBeenCalledTimes(2);
		expect(gateway.deleteKey).not.toHaveBeenCalled();
		store.setDraft(ModelProvider.OpenAi, "newer");
		pending.resolve({ provider: ModelProvider.OpenAi, configured: true, litellmRegistered: true, updatedAt: null });
		await first;
		expect(store.draft(ModelProvider.OpenAi)).toBe("newer");
		expect(store.isBusy(ModelProvider.Anthropic)).toBe(true);
		other.resolve({ provider: ModelProvider.Anthropic, configured: true, litellmRegistered: true, updatedAt: null });
		await second;
		expect(store.draft(ModelProvider.Anthropic)).toBe("");
	});

	it("retains a failed key draft without rendering private gateway diagnostic text", async function _KeyFailure()
	{
		const gateway = _KeyGateway();
		vi.mocked(gateway.setKey).mockRejectedValue(new Error("private upstream diagnostic"));
		TestBed.configureTestingModule({ providers: [ModelKeysAdminStore, { provide: PROVIDER_KEY_GATEWAY, useValue: gateway }, { provide: SessionStore, useValue: _Session() }] });
		const store = TestBed.inject(ModelKeysAdminStore);
		store.setDraft(ModelProvider.OpenAi, "retry-me");
		await store.submit(ModelProvider.OpenAi);
		expect(store.draft(ModelProvider.OpenAi)).toBe("retry-me");
		expect(store.error()).not.toContain("private upstream");
		expect(store.isBusy(ModelProvider.OpenAi)).toBe(false);
	});
});

describe("tools presentation mapping", function _Mapping()
{
	it("joins only currently entitled catalogue records", function _AuthorizedJoin()
	{
		const records = ["visible", "hidden"].map(serverId => ({ serverId, connectionStatus: McpConnectionStatus.SharedKey, lastUsed: null }));
		expect(_InstalledToolRows([_Server("visible")], records).map(row => row.server.id)).toEqual(["visible"]);
	});
	it("combines browser text and connection filters without changing source data", function _Filters()
	{
		const server = _Server("farm");
		expect(_FilterCatalogue([server], " REPORTING ", ToolCatalogueFilters.All)).toEqual([server]);
		expect(_FilterCatalogue([server], "", McpServerType.RemoteOauth)).toEqual([]);
	});
});
