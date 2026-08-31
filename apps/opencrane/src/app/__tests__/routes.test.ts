import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { __CreateSkillAuthoringValidationRoutes } from "../routes";

describe("profile-selected skill validation routes", function _Suite()
{
	const prisma = {} as PrismaClient;
	const workflow = {} as IWorkflowEngine;

	it("omits submission when the profile has no compatible worker", function _OmitsSubmission(): void
	{
		expect(__CreateSkillAuthoringValidationRoutes(prisma, workflow, false)).toEqual([]);
	});

	it("mounts submission when production enables its worker", function _MountsSubmission(): void
	{
		const routes = __CreateSkillAuthoringValidationRoutes(prisma, workflow, true);
		expect(routes).toHaveLength(1);
		expect(routes[0]?.method).toBe("use");
		expect(routes[0]?.path).toBe("/api/v1/skills");
	});
});
