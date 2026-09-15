import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { _CreateConversationAssetRoutes } from "../routes";

/** Restore process settings after each route-availability test. */
afterEach(function _RestoreEnvironment(): void
{
	vi.unstubAllEnvs();
});

describe("conversation-file route availability", function _Suite(): void
{
	it("omits byte routes when Tier 2 has no ArtifactStore or keys", function _OmitsDevelopmentFiles(): void
	{
		vi.stubEnv("ARTIFACT_SERVICE_URL", "");
		vi.stubEnv("ARTIFACT_LEASE_PRIVATE_KEY_PATH", "");
		const prisma = {} as PrismaClient;
		const routes = _CreateConversationAssetRoutes(prisma, false, false);

		expect(routes).toEqual([]);
	});

	it("keeps production file routes fail-closed even when scanning is unavailable", function _RequiresProductionFiles(): void
	{
		vi.stubEnv("ARTIFACT_SERVICE_URL", "");
		const prisma = {} as PrismaClient;
		expect(function _ComposeWithoutService(): void { _CreateConversationAssetRoutes(prisma, false, true); }).toThrow("Invalid URL");

		vi.stubEnv("ARTIFACT_SERVICE_URL", "http://opencrane-artifact-service.default.svc.cluster.local:8080");
		vi.stubEnv("ARTIFACT_LEASE_PRIVATE_KEY_PATH", "");
		expect(function _ComposeWithoutKeys(): void { _CreateConversationAssetRoutes(prisma, false, true); }).toThrow("ARTIFACT_LEASE_PRIVATE_KEY_PATH must identify an absolute mounted key path");
	});
});
