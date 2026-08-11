import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { ExternalActionApprovalOpener, ExternalActionWorker } from "@opencrane/backend/agents/execution/protocol";
import type { Logger } from "@opencrane/backend/observability";
import type { MemoryGatewayClient } from "@opencrane/backend/server/infra/memory-gateway-client";
import type { ObotMcpInvocationPort } from "@opencrane/backend/server/infra/obot-custody";

import { _CreateExternalActionWorker } from "../external-action-composition.js";

/** Hoisted production-factory doubles used to inspect the app-owned composition edge. */
const _factories = vi.hoisted(function _factoryMocks()
{
	return {
		approval: vi.fn(function _approval(): ExternalActionApprovalOpener { return { open: vi.fn(async function _open() { return true; }) }; }),
		worker: vi.fn(function _worker(): ExternalActionWorker { return {} as ExternalActionWorker; }),
	};
});

vi.mock("@opencrane/backend/agents/execution/protocol", async function _mockProtocol(importOriginal)
{
	const original = await importOriginal<typeof import("@opencrane/backend/agents/execution/protocol")>();
	return { ...original, __CreateProductionExternalActionApprovalOpener: _factories.approval, __CreateProductionExternalActionWorker: _factories.worker };
});

describe("external-action app composition", function _suite()
{
	it("supplies the production worker with the approval opener and existing server transports", function _composes()
	{
		_factories.approval.mockClear();
		_factories.worker.mockClear();
		const prisma = {} as PrismaClient;
		const memoryGateway = {} as MemoryGatewayClient;
		const obotInvocation = {} as ObotMcpInvocationPort;
		const log = { warn: vi.fn(), error: vi.fn() } as unknown as Logger;

		const worker = _CreateExternalActionWorker(prisma, memoryGateway, obotInvocation, log);

		expect(_factories.approval).toHaveBeenCalledWith(prisma, log);
		expect(_factories.worker).toHaveBeenCalledWith(expect.objectContaining({ approvals: _factories.approval.mock.results[0]?.value, transports: expect.objectContaining({ memoryGateway, obotMcpInvocation: obotInvocation }), log }));
		expect(worker).toBe(_factories.worker.mock.results[0]?.value);
	});
});
