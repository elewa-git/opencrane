import { describe, expect, it, vi } from "vitest";

import { PublicHealthServiceNames, PublicHealthServiceStatuses } from "@opencrane/contracts";

import type { OpenCraneProcessConfig } from "../../../app/config.types";
import { ___CreatePublicHealthReportReader } from "../public-health";

describe("public health production composition", function _Suite()
{
	it("maps configured process targets to the fixed user-visible probes", async function _MapsProductionTargets()
	{
		const findFirst = vi.fn().mockResolvedValue(null);
		const prisma = {
			$transaction: vi.fn(async function _Transaction(run: (transaction: unknown) => Promise<unknown>) { return run({ auditEntry: { findFirst } }); }),
		};
		const config = {
			runtime: {
				channelTargets: {},
				memoryGatewayUrl: "http://memory-gateway.svc:8080",
			},
		} as unknown as OpenCraneProcessConfig;
		const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetch);
		const reader = ___CreatePublicHealthReportReader(prisma as never, config, { warn: vi.fn() }, {
			LITELLM_ENDPOINT: "http://litellm.svc:4000",
			LITELLM_MASTER_KEY: "master-key",
			ARTIFACT_SERVICE_URL: "http://artifact-service.svc:8080",
			CHANNEL_PROXY_URL: "http://channel-proxy.svc:8080",
		});

		const report = await reader.read();
		expect(report.services[PublicHealthServiceNames.Channels]).toBe(PublicHealthServiceStatuses.Available);
		expect(findFirst).toHaveBeenCalledOnce();
		expect(fetch.mock.calls.map(function _Url(call) { return String(call[0]); }).sort()).toEqual([
			"http://artifact-service.svc:8080/readyz",
			"http://channel-proxy.svc:8080/readyz",
			"http://litellm.svc:4000/v1/models",
			"http://memory-gateway.svc:8080/readyz",
		]);
		vi.unstubAllGlobals();
	});
});
