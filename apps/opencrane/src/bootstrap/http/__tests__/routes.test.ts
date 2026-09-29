import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";
import type { RoutineHttpAuthority } from "@opencrane/backend/server/agents/scheduling";

import { _RegisterRoutes } from "../routes";

const _CreateRoutineRouter = vi.hoisted(function _RoutineRouterMock()
{
	return vi.fn(function _CreateRoutineRouter() { return express.Router(); });
});

vi.mock("@opencrane/backend/server/agents/scheduling", async function _MockScheduling(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/agents/scheduling")>();
	return { ...actual, __CreateRoutineRouter: _CreateRoutineRouter };
});

vi.mock("@opencrane/backend/server/conversation-assets", async function _MockConversationAssets(importOriginal)
{
	const actual = await importOriginal<typeof import("@opencrane/backend/server/conversation-assets")>();
	return { ...actual, _CreateConversationAssetAuthority: function _CreateConversationAssetAuthority() { return express.Router(); } };
});

function _RoutineAuthority(): RoutineHttpAuthority
{
	return {
		create: vi.fn(),
		readProposal: vi.fn(),
		cancelProposal: vi.fn(),
		read: vi.fn(),
		revise: vi.fn(),
		pause: vi.fn(),
		resume: vi.fn(),
		retire: vi.fn(),
		runNow: vi.fn(),
		list: vi.fn(),
		firings: vi.fn(),
		creationOptions: vi.fn(),
		preview: vi.fn(),
	};
}

describe("public routine route composition", function _PublicRoutineRouteCompositionSuite()
{
	afterEach(function _RestoreEnvironment()
	{
		vi.unstubAllEnvs();
	});

	it("mounts the routine command router at the authenticated personal path", function _MountsRoutineCommands()
	{
		vi.stubEnv("ARTIFACT_SERVICE_URL", "http://artifact-service.opencrane.svc.cluster.local:8080");
		const app = express();
		const authority = _RoutineAuthority();
		const mounts: string[] = [];
		app.use = vi.fn(function _Use(path: string) { mounts.push(path); return app; }) as unknown as typeof app.use;
		app.get = vi.fn(function _Get(path: string) { mounts.push(path); return app; }) as unknown as typeof app.get;
		_RegisterRoutes(app, {} as PrismaClient, false, express.Router(), {} as never, {} as never, {} as never, {} as never, authority, undefined, undefined, {
			profileRevisionId: "profile-revision",
			profileName: "developer",
			warmPoolName: "pool",
			namespace: "silo-one",
			serviceAccountName: "computer",
			leaseTtlMilliseconds: 60_000,
			maximumTurnCostUsdMicros: 75_000,
		});

		expect(mounts).toContain("/api/v1/me/routines");
		expect(_CreateRoutineRouter).toHaveBeenCalledWith(authority, expect.anything());
	});
});
