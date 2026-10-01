// @vitest-environment jsdom
import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { McpConnectionCredentialKinds, McpConnectionFailureCodes } from "@opencrane/contracts";
import { McpApprovalStatus, McpConnectionStatus, McpCredentialRequirement, McpInstallStates, McpServerType, type McpConnectionProjection, type McpInstalledServer, type McpServer } from "@opencrane/core";
import { MCP_GATEWAY, McpConnectionCommandError, McpConnectionCommandFailureKinds, type McpGateway } from "@opencrane/state/mcp/adapter";

import { PersonalMcpConnectionControlStates, PersonalMcpCredentialInputKinds } from "../../my-tools/personal-mcp-connection-control/personal-mcp-connection-control.types";
import { _PersonalMcpConnectionView } from "../personal-mcp-connection.mapper";
import { PersonalMcpConnectionStore } from "../personal-mcp-connection.store";
import { ToolsInventoryStore } from "../tools-inventory.store";
import type { InstalledToolRow } from "../tools-inventory.types";

beforeAll(function _Initialize() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _Reset() { vi.useRealTimers(); TestBed.resetTestingModule(); });
afterAll(function _ResetEnvironment() { TestBed.resetTestEnvironment(); });

/** Browser-safe server fixture with independently varied type and credential requirement. */
function _Server(requirement = McpCredentialRequirement.PrincipalCredential, type = McpServerType.SingleUser): McpServer
{
	return { id: "remote", name: "Remote reports", description: "Farm reporting", publisher: "Elewa", glyph: "RR", type, credentialRequirement: requirement, approvalStatus: McpApprovalStatus.Published, credentialSchema: [], entitlementSummary: "Workspace" };
}

/** Current installed projection for one server. */
function _Installed(connectionStatus = McpConnectionStatus.NeedsCredential, connectionGeneration: number | null = null): McpInstalledServer
{
	return { serverId: "remote", lifecycleState: McpInstallStates.Installed, connectionStatus, connectionGeneration, credentialUpdatedAt: null, failureCode: null, lastUsed: null };
}

/** Safe successful command projection. */
function _Projection(connectionStatus = McpConnectionStatus.Active, connectionGeneration: number | null = 1): McpConnectionProjection
{
	return { connectionStatus, connectionGeneration, credentialUpdatedAt: "2026-09-12T12:00:00.000Z", failureCode: null };
}

/** Creates the complete gateway while each test controls connection operations. */
function _Gateway(server: McpServer = _Server(), installed: McpInstalledServer = _Installed()): McpGateway
{
	return {
		listEntitledCatalogue: vi.fn().mockResolvedValue([server]),
		listInstalled: vi.fn().mockResolvedValue([installed]),
		install: vi.fn(), uninstall: vi.fn(),
		activatePersonalConnection: vi.fn(), revokePersonalConnection: vi.fn(),
		listCatalogue: vi.fn().mockResolvedValue([]), approve: vi.fn(), publish: vi.fn(), reject: vi.fn(), setEnabled: vi.fn()
	};
}

/** Builds the two route-scoped stores and waits for their authoritative join. */
async function _Stores(gateway: McpGateway): Promise<{ inventory: ToolsInventoryStore; connections: PersonalMcpConnectionStore }>
{
	TestBed.configureTestingModule({ providers: [ToolsInventoryStore, PersonalMcpConnectionStore, { provide: MCP_GATEWAY, useValue: gateway }] });
	const inventory = TestBed.inject(ToolsInventoryStore);
	const connections = TestBed.inject(PersonalMcpConnectionStore);
	TestBed.flushEffects();
	await vi.waitFor(function _Loaded() { expect(inventory.rows()).toHaveLength(1); });
	return { inventory, connections };
}

/** Supplies a controllable asynchronous completion. */
function _Deferred<T>()
{
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>(function _Pending(accept, fail) { resolve = accept; reject = fail; });
	return { promise, resolve, reject };
}

describe("PersonalMcpConnectionStore", function _StoreSuite()
{
	it("keeps one exact bearer retry and blocks uninstall until the retry resolves", async function _AmbiguousRetry()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.activatePersonalConnection)
			.mockRejectedValueOnce(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain))
			.mockResolvedValueOnce(_Projection());
		const { inventory, connections } = await _Stores(gateway);
		connections.setDraft("remote", "private-token");

		await connections.submit("remote");

		const first = vi.mocked(gateway.activatePersonalConnection).mock.calls[0][1];
		expect(first).toMatchObject({ expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.Bearer, token: "private-token" } });
		expect(connections.view(inventory.rows()[0])?.state).toBe(PersonalMcpConnectionControlStates.Ambiguous);
		expect(connections.busy("remote")).toBe(false);
		expect(inventory.commandReserved("remote")).toBe(true);
		await inventory.uninstall("remote");
		expect(gateway.uninstall).not.toHaveBeenCalled();

		vi.mocked(gateway.listInstalled).mockResolvedValue([_Installed(McpConnectionStatus.Active, 1)]);
		inventory.reloadInstalled();
		TestBed.flushEffects();
		await vi.waitFor(function _SavedGenerationVisible() { expect(inventory.installed("remote")?.connectionGeneration).toBe(1); });
		expect(connections.view(inventory.rows()[0])?.state).toBe(PersonalMcpConnectionControlStates.Ambiguous);
		await connections.submit("remote");

		const second = vi.mocked(gateway.activatePersonalConnection).mock.calls[1][1];
		expect(second).toEqual(first);
		expect(inventory.commandReserved("remote")).toBe(false);
		await vi.waitFor(function _Adopted() { expect(inventory.installed("remote")?.connectionStatus).toBe(McpConnectionStatus.Active); });
		expect(connections.view(inventory.rows()[0])?.draft).toBe("");
	});

	it("sends no credential for an explicitly credentialless remote connection", async function _Credentialless()
	{
		const gateway = _Gateway(_Server(McpCredentialRequirement.Credentialless, McpServerType.MultiUser));
		vi.mocked(gateway.activatePersonalConnection).mockResolvedValue(_Projection());
		const { connections } = await _Stores(gateway);

		await connections.submit("remote");

		expect(vi.mocked(gateway.activatePersonalConnection).mock.calls[0][1]).toMatchObject({ expectedGeneration: null, credential: { kind: McpConnectionCredentialKinds.None } });
	});

	it("uses bearer input for either credential requirement independent of presentation type", function _CredentialMapping()
	{
		const requirements = [McpCredentialRequirement.PrincipalCredential, McpCredentialRequirement.SharedCredential];
		const types = [McpServerType.SingleUser, McpServerType.MultiUser, McpServerType.RemoteOauth];
		for (const requirement of requirements)
		{
			for (const type of types)
			{
				const row: InstalledToolRow = { server: _Server(requirement, type), installed: _Installed() };
				const view = _PersonalMcpConnectionView(row, { draft: "", replacing: false, attempt: null, error: null });
				expect(view?.credentialInput).toBe(PersonalMcpCredentialInputKinds.Bearer);
			}
		}
	});

	it("discards a definite attempt and gives changed material a new request key", async function _DefiniteFailure()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.activatePersonalConnection)
			.mockRejectedValueOnce(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Rejected))
			.mockResolvedValueOnce(_Projection());
		const { connections } = await _Stores(gateway);
		connections.setDraft("remote", "first-token");
		await connections.submit("remote");
		const first = vi.mocked(gateway.activatePersonalConnection).mock.calls[0][1];
		expect(connections.error("remote")).toContain("rejected");

		connections.setDraft("remote", "second-token");
		await connections.submit("remote");

		const second = vi.mocked(gateway.activatePersonalConnection).mock.calls[1][1];
		expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
		expect(second.credential).toEqual({ kind: McpConnectionCredentialKinds.Bearer, token: "second-token" });
	});

	it("purges every private attempt on an authenticated inventory read denial", async function _AccessLoss()
	{
		const gateway = _Gateway();
		const pending = _Deferred<McpConnectionProjection>();
		vi.mocked(gateway.activatePersonalConnection).mockReturnValue(pending.promise);
		const { inventory, connections } = await _Stores(gateway);
		const visibleRow = inventory.rows()[0];
		connections.setDraft("remote", "must-disappear");
		void connections.submit("remote");
		await vi.waitFor(function _Started() { expect(gateway.activatePersonalConnection).toHaveBeenCalledOnce(); });
		vi.mocked(gateway.listInstalled).mockRejectedValue(new McpConnectionCommandError(McpConnectionCommandFailureKinds.AccessChanged));

		inventory.reloadInstalled();
		TestBed.flushEffects();
		await vi.waitFor(function _Purged() { expect(connections.error("remote")).toContain("access changed"); });

		expect(connections.view(visibleRow)?.draft).toBe("");
		expect(inventory.commandReserved("remote")).toBe(false);
		pending.resolve(_Projection());
		await pending.promise;
		expect(inventory.installed("remote")?.connectionStatus).not.toBe(McpConnectionStatus.Active);
	});

	it("purges an ambiguous bearer when a successful catalogue refresh removes entitlement", async function _EntitlementRemoved()
	{
		const gateway = _Gateway();
		const retry = _Deferred<McpConnectionProjection>();
		vi.mocked(gateway.activatePersonalConnection)
			.mockRejectedValueOnce(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain))
			.mockReturnValueOnce(retry.promise);
		const { inventory, connections } = await _Stores(gateway);
		const visibleRow = inventory.rows()[0];
		connections.setDraft("remote", "must-disappear");
		await connections.submit("remote");
		const retried = connections.submit("remote");
		await vi.waitFor(function _RetryStarted() { expect(gateway.activatePersonalConnection).toHaveBeenCalledTimes(2); });
		vi.mocked(gateway.listEntitledCatalogue).mockResolvedValue([]);

		inventory.refresh();
		TestBed.flushEffects();
		await vi.waitFor(function _Hidden() { expect(inventory.rows()).toHaveLength(0); });
		await vi.waitFor(function _Purged() { expect(inventory.commandReserved("remote")).toBe(false); });

		expect(connections.view(visibleRow)?.draft).toBe("");
		retry.resolve(_Projection());
		await retried;
		expect(inventory.installed("remote")?.connectionStatus).toBe(McpConnectionStatus.NeedsCredential);
	});

	it("retains an ambiguous bearer while an entitlement refresh is pending or fails", async function _EntitlementUnknown()
	{
		const gateway = _Gateway();
		const catalogue = _Deferred<McpServer[]>();
		vi.mocked(gateway.activatePersonalConnection).mockRejectedValue(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain));
		const { inventory, connections } = await _Stores(gateway);
		const visibleRow = inventory.rows()[0];
		connections.setDraft("remote", "retry-token");
		await connections.submit("remote");
		vi.mocked(gateway.listEntitledCatalogue).mockReturnValueOnce(catalogue.promise);

		inventory.refresh();
		TestBed.flushEffects();
		await vi.waitFor(function _RefreshStarted() { expect(gateway.listEntitledCatalogue).toHaveBeenCalledTimes(2); });
		expect(inventory.commandReserved("remote")).toBe(true);
		expect(connections.view(visibleRow)?.draft).toBe("retry-token");

		catalogue.reject(new Error("temporary read failure"));
		await vi.waitFor(function _Failed() { expect(inventory.readError()).not.toBeNull(); });
		expect(inventory.commandReserved("remote")).toBe(true);
		expect(connections.view(visibleRow)?.draft).toBe("retry-token");
	});

	it("does not release an inventory command when access loss purges only a replacement draft", async function _ClaimOwnership()
	{
		const gateway = _Gateway(_Server(), _Installed(McpConnectionStatus.Active, 1));
		const pendingRemoval = _Deferred<void>();
		vi.mocked(gateway.uninstall).mockReturnValue(pendingRemoval.promise);
		const { inventory, connections } = await _Stores(gateway);
		connections.replace("remote");
		connections.setDraft("remote", "private-token");
		const removal = inventory.uninstall("remote");
		await vi.waitFor(function _Started() { expect(gateway.uninstall).toHaveBeenCalledOnce(); });
		vi.mocked(gateway.listInstalled).mockRejectedValue(new McpConnectionCommandError(McpConnectionCommandFailureKinds.AccessChanged));

		inventory.reloadInstalled();
		TestBed.flushEffects();
		await vi.waitFor(function _Purged() { expect(connections.error("remote")).toContain("access changed"); });

		expect(inventory.busy().has("remote")).toBe(true);
		pendingRemoval.resolve();
		await removal;
	});

	it("clears a lost-admission retry when a newer generation makes its expectation conflict", async function _LostAdmissionConflict()
	{
		const gateway = _Gateway();
		vi.mocked(gateway.activatePersonalConnection)
			.mockRejectedValueOnce(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain))
			.mockRejectedValueOnce(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Conflict));
		const { inventory, connections } = await _Stores(gateway);
		connections.setDraft("remote", "private-token");
		await connections.submit("remote");
		const first = vi.mocked(gateway.activatePersonalConnection).mock.calls[0][1];
		vi.mocked(gateway.listInstalled).mockResolvedValue([_Installed(McpConnectionStatus.Active, 2)]);

		inventory.reloadInstalled();
		TestBed.flushEffects();
		await vi.waitFor(function _Refreshed() { expect(inventory.installed("remote")?.connectionGeneration).toBe(2); });
		expect(connections.view(inventory.rows()[0])?.state).toBe(PersonalMcpConnectionControlStates.Ambiguous);
		expect(inventory.commandReserved("remote")).toBe(true);

		await connections.submit("remote");

		expect(vi.mocked(gateway.activatePersonalConnection).mock.calls[1][1]).toEqual(first);
		expect(first.expectedGeneration).toBeNull();
		expect(inventory.commandReserved("remote")).toBe(false);
		expect(connections.view(inventory.rows()[0])?.state).toBe(PersonalMcpConnectionControlStates.Active);
		expect(connections.view(inventory.rows()[0])?.draft).toBe("");
	});

	it("retries an ambiguous revoke with its original key and no credential draft", async function _RevokeRetry()
	{
		const gateway = _Gateway(_Server(), _Installed(McpConnectionStatus.RecoveryRequired, 4));
		vi.mocked(gateway.revokePersonalConnection)
			.mockRejectedValueOnce(new McpConnectionCommandError(McpConnectionCommandFailureKinds.Uncertain))
			.mockResolvedValueOnce(_Projection(McpConnectionStatus.NeedsCredential, 4));
		const { inventory, connections } = await _Stores(gateway);
		await connections.revoke("remote");
		const firstKey = vi.mocked(gateway.revokePersonalConnection).mock.calls[0][1];

		expect(connections.view(inventory.rows()[0])?.state).toBe(PersonalMcpConnectionControlStates.Ambiguous);
		expect(connections.view(inventory.rows()[0])?.credentialInput).toBe(PersonalMcpCredentialInputKinds.None);
		vi.mocked(gateway.listInstalled).mockResolvedValue([_Installed(McpConnectionStatus.NeedsCredential, 4)]);
		inventory.reloadInstalled();
		TestBed.flushEffects();
		await vi.waitFor(function _RevokedGenerationVisible() { expect(inventory.installed("remote")?.connectionStatus).toBe(McpConnectionStatus.NeedsCredential); });
		expect(connections.view(inventory.rows()[0])?.state).toBe(PersonalMcpConnectionControlStates.Ambiguous);
		await connections.submit("remote");

		expect(vi.mocked(gateway.revokePersonalConnection).mock.calls[1][1]).toBe(firstKey);
		expect(vi.mocked(gateway.revokePersonalConnection).mock.calls.map(call => call[2])).toEqual([4, 4]);
	});

	it("renders bounded server failure evidence without provider text", function _FailurePresentation()
	{
		const row: InstalledToolRow = { server: _Server(), installed: { ..._Installed(McpConnectionStatus.RecoveryRequired, 1), failureCode: McpConnectionFailureCodes.AuthenticationRejected } };
		const view = _PersonalMcpConnectionView(row, { draft: "", replacing: false, attempt: null, error: null });
		expect(view?.failureMessage).toContain("rejected the saved credential");
	});
});

describe("ToolsInventoryStore connection polling", function _PollingSuite()
{
	it("rejects stale immediate response adoption after the generation changes", async function _StaleAdoption()
	{
		const gateway = _Gateway(_Server(), _Installed(McpConnectionStatus.Active, 2));
		const { inventory } = await _Stores(gateway);

		const adopted = inventory.adoptConnection("remote", _Projection(McpConnectionStatus.RecoveryRequired, 1), { lifecycleState: McpInstallStates.Installed, connectionGeneration: 1 });

		expect(adopted).toBe(false);
		expect(inventory.installed("remote")?.connectionStatus).toBe(McpConnectionStatus.Active);
		expect(inventory.installed("remote")?.connectionGeneration).toBe(2);
	});

	it("polls an activating generation until it becomes Active", async function _PollUntilActive()
	{
		vi.useFakeTimers();
		const gateway = _Gateway();
		vi.mocked(gateway.listInstalled)
			.mockResolvedValueOnce([_Installed(McpConnectionStatus.Activating, 1)])
			.mockResolvedValue([_Installed(McpConnectionStatus.Active, 1)]);
		TestBed.configureTestingModule({ providers: [ToolsInventoryStore, { provide: MCP_GATEWAY, useValue: gateway }] });
		const inventory = TestBed.inject(ToolsInventoryStore);
		TestBed.flushEffects();
		await vi.waitFor(function _Loaded() { expect(inventory.installed("remote")?.connectionStatus).toBe(McpConnectionStatus.Activating); });

		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(function _Active() { expect(inventory.installed("remote")?.connectionStatus).toBe(McpConnectionStatus.Active); });
		await vi.advanceTimersByTimeAsync(60_000);

		expect(gateway.listInstalled).toHaveBeenCalledTimes(2);
	});

	it("does not schedule polling when an inventory response arrives after destroy", async function _LateResponseAfterDestroy()
	{
		vi.useFakeTimers();
		const gateway = _Gateway();
		const installed = _Deferred<McpInstalledServer[]>();
		vi.mocked(gateway.listInstalled).mockReturnValue(installed.promise);
		TestBed.configureTestingModule({ providers: [ToolsInventoryStore, { provide: MCP_GATEWAY, useValue: gateway }] });
		TestBed.inject(ToolsInventoryStore);
		TestBed.flushEffects();
		await vi.waitFor(function _Started() { expect(gateway.listInstalled).toHaveBeenCalledOnce(); });

		TestBed.resetTestingModule();
		installed.resolve([_Installed(McpConnectionStatus.Activating, 1)]);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(gateway.listInstalled).toHaveBeenCalledOnce();
	});
});
