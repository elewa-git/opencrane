// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ControlPlaneApiService } from "@opencrane/core";
import { ToolApprovalScopeStates } from "@opencrane/contracts";

import { OpenCraneToolApprovalScopeGateway } from "../opencrane-tool-approval-scope.gateway";
import { ToolApprovalScopeGatewayErrorKinds } from "../tool-approval-scope.errors";

/** Safe generated response fixture. */
const _SCOPE = { id: "scope-1", state: ToolApprovalScopeStates.Active, action: "Create event", target: "Calendar", connectionOwnerLabel: "Amina", createdAt: "2026-09-25T08:00:00.000Z" };

/** Build the adapter over a generated-client double. */
function _Gateway(client: { GET: ReturnType<typeof vi.fn>; POST: ReturnType<typeof vi.fn> }): OpenCraneToolApprovalScopeGateway
{
	TestBed.configureTestingModule({ providers: [OpenCraneToolApprovalScopeGateway, { provide: ControlPlaneApiService, useValue: { client } }] });
	return TestBed.inject(OpenCraneToolApprovalScopeGateway);
}

beforeAll(function _InitializeAngularTesting() { TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting()); });
afterEach(function _ResetTestBed() { TestBed.resetTestingModule(); });
afterAll(function _ResetAngularTesting() { TestBed.resetTestEnvironment(); });

describe("OpenCraneToolApprovalScopeGateway", function _ToolApprovalScopeGatewaySuite()
{
	it("passes only the opaque server cursor and exact generated revocation body", async function _GeneratedPaths()
	{
		const revoked = { ..._SCOPE, state: ToolApprovalScopeStates.Revoked, revokedAt: "2026-09-25T09:00:00.000Z" };
		const client = { GET: vi.fn().mockResolvedValue({ data: { scopes: [{ ..._SCOPE, reviewedArguments: { secret: true } }], nextCursor: "next" }, error: undefined, response: { ok: true, status: 200 } }), POST: vi.fn().mockResolvedValue({ data: { scope: { ...revoked, credentialMetadata: "private" }, idempotent: false }, error: undefined, response: { ok: true, status: 200 } }) };
		const gateway = _Gateway(client);
		await expect(gateway.list("cursor-a")).resolves.toEqual({ scopes: [_SCOPE], nextCursor: "next" });
		await expect(gateway.revoke("scope-1", "key-1")).resolves.toEqual({ scope: revoked, idempotent: false });
		expect(client.GET).toHaveBeenCalledWith("/me/tool-approval-scopes", { params: { query: { cursor: "cursor-a" } }, signal: undefined });
		expect(client.POST).toHaveBeenCalledWith("/me/tool-approval-scopes/{scopeId}/revocation", { params: { path: { scopeId: "scope-1" } }, body: { idempotencyKey: "key-1" } });
	});

	it("classifies an unconfirmed write as uncertain without exposing its response body", async function _Uncertain()
	{
		const gateway = _Gateway({ GET: vi.fn(), POST: vi.fn().mockRejectedValue(new Error("provider secret")) });
		await expect(gateway.revoke("scope-1", "key-1")).rejects.toMatchObject({ kind: ToolApprovalScopeGatewayErrorKinds.Uncertain });
	});
});
