import { describe, expect, it, vi } from "vitest";

import type { AuthorizationAuthority } from "@opencrane/backend/server/iam/authorization";

import { DefaultGlobalModelRoutingDefaultCommandPort } from "../global-model-routing-default-command";
import { ProviderEffectCommandKinds, ProviderEffectExecutionStatuses, type ProviderEffectCommandExecutor, type ProviderEffectCommandRepository } from "../provider-effect-command.types";
import type { ProviderGatewayUnitOfWork } from "../provider-gateway-authority.types";

/** Builds one committed alias child returned by the provider repository. */
function _child()
{
	return { id: "command-auto", siloId: "acme", principalId: "principal-1", payload: { kind: ProviderEffectCommandKinds.RegisterModel, value: { modelDefinitionId: "model-auto" } }, resourceKind: "model-definition", resourceId: "model-auto" } as never;
}

describe("DefaultGlobalModelRoutingDefaultCommandPort", function _Suite()
{
	it("delivers the exact child only after its selection transaction commits", async function _PostCommitDelivery()
	{
		const order: string[] = [];
		const effects = { reconcileGlobalRoutingDefault: vi.fn(async function _Reconcile() { order.push("selection-written"); return { value: { id: "routing-1", scope: "global", clusterTenant: null, defaultModel: "openai/gpt-5.5", autoConfig: null, createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z" }, child: _child() }; }) } as unknown as ProviderEffectCommandRepository;
		const unitOfWork = { runDatabaseMutation: vi.fn(async function _Transaction(operation) { const value = await operation({}, {} as AuthorizationAuthority, effects); order.push("transaction-committed"); return value; }) } as unknown as ProviderGatewayUnitOfWork<unknown>;
		const executor = { execute: vi.fn(async function _Execute() { order.push("external-delivered"); return { status: ProviderEffectExecutionStatuses.Succeeded, result: null }; }), reconcileNext: vi.fn() } as unknown as ProviderEffectCommandExecutor;
		const port = new DefaultGlobalModelRoutingDefaultCommandPort(unitOfWork, executor);

		await expect(port.upsert({ siloId: "acme", principalId: "principal-1" }, { defaultModel: "openai/gpt-5.5", autoConfig: null })).resolves.toMatchObject({ status: "succeeded", value: { defaultModel: "openai/gpt-5.5" } });
		expect(order).toEqual(["selection-written", "transaction-committed", "external-delivered"]);
		expect(executor.execute).toHaveBeenCalledWith("command-auto", undefined, expect.objectContaining({ siloId: "acme", resourceId: "model-auto" }));
	});

	it("returns the exact pending command when delivery does not converge", async function _PendingChild()
	{
		const effects = { reconcileGlobalRoutingDefault: vi.fn(async function _Reconcile() { return { value: { id: "routing-1" }, child: _child() }; }) } as unknown as ProviderEffectCommandRepository;
		const unitOfWork = { runDatabaseMutation: vi.fn(async function _Transaction(operation) { return operation({}, {} as AuthorizationAuthority, effects); }) } as unknown as ProviderGatewayUnitOfWork<unknown>;
		const executor = { execute: vi.fn(async function _Execute() { return { status: ProviderEffectExecutionStatuses.Busy, result: null }; }), reconcileNext: vi.fn() } as unknown as ProviderEffectCommandExecutor;

		await expect(new DefaultGlobalModelRoutingDefaultCommandPort(unitOfWork, executor).upsert({ siloId: "acme", principalId: "principal-1" }, { defaultModel: "openai/gpt-5.5", autoConfig: null })).resolves.toEqual({ status: "pending", commandId: "command-auto" });
	});
});
