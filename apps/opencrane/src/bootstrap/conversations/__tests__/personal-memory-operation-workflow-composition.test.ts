import type { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";

import { PERSONAL_MEMORY_OPERATION_TASK, type SelfConversationHistoryAuthority } from "@opencrane/backend/server/conversations";
import { __UnavailableMemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import { ___IsRolledBackConflict } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import { _CreateAbsurdWorkflowEngine } from "@opencrane/backend/server/infra/workflows/infra_absurd";
import type { IWorkflowEngine, IWorkflowTaskContext, IWorkflowTaskDefinition } from "@opencrane/backend/server/infra/workflows/contract";

import { _CreateMcpWorkflowComposition } from "../../workflows/mcp-workflow-composition";
import { _CreatePersonalMemoryOperationWorkflowComposition } from "../personal-memory-operation-workflow-composition";

vi.mock("@opencrane/backend/server/infra/workflows/infra_absurd", async function _CaptureComposition(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/infra/workflows/infra_absurd")>();
	return { ...actual, _CreateAbsurdWorkflowEngine: vi.fn(actual._CreateAbsurdWorkflowEngine) };
});

it("registers the existing identifier-only memory task and refuses a foreign silo before database access", async function _Compose()
{
	const register = vi.fn();
	const prisma = { $transaction: vi.fn() } as unknown as PrismaClient;
	const history = { read: vi.fn() } as unknown as Pick<SelfConversationHistoryAuthority, "read">;
	_CreatePersonalMemoryOperationWorkflowComposition(prisma, history, { register } as unknown as IWorkflowEngine, { siloId: "silo-one", gateway: new __UnavailableMemoryGatewayClient() });
	expect(register).toHaveBeenCalledTimes(1);
	const definition = register.mock.calls[0][0] as IWorkflowTaskDefinition<unknown, unknown>;
	expect(definition).toMatchObject(PERSONAL_MEMORY_OPERATION_TASK);
	const operationId = "c70d9ca3-c5df-4c45-bf92-1c2c466776b0";
	const context = { task: { taskId: "task-one", taskName: PERSONAL_MEMORY_OPERATION_TASK.taskName, idempotencyKey: operationId }, attempt: 1 } as IWorkflowTaskContext;
	await expect(definition.run(context, { siloId: "silo-two", operationId })).rejects.toThrow();
	expect(prisma.$transaction).not.toHaveBeenCalled();
	expect(history.read).not.toHaveBeenCalled();
});

it("keeps personal memory on the existing control-plane engine and registers its handler once", async function _SharedEngine()
{
	const prisma = { $transaction: vi.fn() } as unknown as PrismaClient;
	const history = { read: vi.fn() } as unknown as Pick<SelfConversationHistoryAuthority, "read">;
	const composition = _CreateMcpWorkflowComposition(prisma, {
		databaseUrl: "postgresql://synthetic@127.0.0.1:1/unused",
		databasePoolSize: 1,
		mcpRemoteMaximumResponseBytes: 1_048_576,
		mcpRemoteTimeoutMilliseconds: 30_000,
		ociRegistryAuthorizationFilePath: undefined,
		ociRegistryBaseUrl: "https://registry.example.invalid",
		ociRegistryRepository: "mcp",
		ociRegistryTimeoutMilliseconds: 30_000,
		pollIntervalMilliseconds: 1_000,
		siloId: "silo-one",
		workerConcurrency: 1,
	}, 300_000);
	try
	{
		const register = vi.spyOn(composition.execution, "register");
		_CreatePersonalMemoryOperationWorkflowComposition(prisma, history, composition.execution, { siloId: "silo-one", gateway: new __UnavailableMemoryGatewayClient() });
		const options = vi.mocked(_CreateAbsurdWorkflowEngine).mock.calls.at(-1)![0];
		expect(options).toHaveProperty("isRolledBackConflict", ___IsRolledBackConflict);
		expect(options.queueAuthority.queueForTask(PERSONAL_MEMORY_OPERATION_TASK.taskName)).toBe("control-plane");
		expect(options.checkpointOperationLeaseSeconds).toBe(360);
		expect(register).toHaveBeenCalledTimes(1);
		expect(register.mock.calls[0][0].taskName).toBe(PERSONAL_MEMORY_OPERATION_TASK.taskName);
		expect(prisma.$transaction).not.toHaveBeenCalled();
		expect(history.read).not.toHaveBeenCalled();
	}
	finally
	{
		await composition.runtime.close();
	}
});
