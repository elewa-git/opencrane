import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _StartChannelTargetRouteReconciler } from "../channel-target-composition";

describe("channel target route reconciliation", function _ChannelTargetRouteReconciliationSuite()
{
	afterEach(function _RestoreTimers()
	{
		vi.useRealTimers();
	});

	it("discovers an AgentService created after the startup snapshot without restarting", async function _DiscoversLaterService()
	{
		vi.useFakeTimers();
		const findMany = vi.fn()
			.mockResolvedValueOnce([{ id: "service-1", siloId: "silo-1" }])
			.mockResolvedValueOnce([{ id: "service-1", siloId: "silo-1" }, { id: "service-2", siloId: "silo-1" }]);
		const upsert = vi.fn().mockResolvedValue({});
		const transaction = {
			agentService: { findMany },
			channelRuntimeRoute: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), upsert },
		};
		const prisma = {
			$transaction: vi.fn(async function _Transaction(work: (client: unknown) => Promise<unknown>) { return work(transaction); }),
		} as unknown as PrismaClient;
		const config = { channelProxyServiceAccountName: "channel-proxy", invocationContextTtlMilliseconds: 60_000, receiverEndpoint: "http://opencrane-server.silo-1.svc.cluster.local:8081/api/internal/conversation-replay", receiverId: "conversation-replay-v1", siloId: "silo-1", trustedHost: "acme.example.com" };
		const worker = _StartChannelTargetRouteReconciler(prisma, config, 10);

		await vi.advanceTimersByTimeAsync(10);
		await vi.advanceTimersByTimeAsync(10);

		expect(findMany).toHaveBeenCalledTimes(2);
		expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { receiverId_siloId_agentServiceId_action: expect.objectContaining({ agentServiceId: "service-2" }) } }));
		await worker.stop();
	});
});
