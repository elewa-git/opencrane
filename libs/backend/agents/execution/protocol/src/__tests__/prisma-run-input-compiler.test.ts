import { describe, expect, it, vi } from "vitest";

import { PROMPT_COMPILER_VERSION } from "@opencrane/backend/agents/runtime/prompt-compiler";

import { __CreatePrismaRunInputCompiler } from "../prisma-run-input-compiler.js";

/** Builds the smallest sealed snapshot that reaches the model-route compiler boundary. */
function _Snapshot(modelRoute: object): never
{
	return {
		runId: "run-1",
		snapshotVersion: 1,
		personaRevisionId: null,
		messageIds: [],
		integrationAssignments: [],
		memoryFacts: [],
		artifactRevisionIds: [],
		skillRevisionIds: [],
		modelRoute,
		budgetPolicy: {},
		promptCompilerVersion: PROMPT_COMPILER_VERSION,
		digest: "sha256:snapshot",
	} as never;
}

/** Builds the transaction reads required by an empty-context snapshot compilation. */
function _Transaction(litellmModelId: string): never
{
	return { modelDefinition: { findUnique: vi.fn().mockResolvedValue({ litellmModelId }) } } as never;
}

describe("Prisma run-input compiler model routes", function _DescribePrismaRunInputCompilerModelRoutes()
{
	it("uses the deployment sealed in the snapshot after checking the exact definition has not changed", async function _UsesSealedDeployment()
	{
		const compile = __CreatePrismaRunInputCompiler();
		await expect(compile(_Snapshot({ modelDefinitionId: "model-1", litellmModelId: "deployment-a" }), _Transaction("deployment-a"))).resolves.toMatchObject({ model: { modelAlias: "deployment-a" } });
	});

	it("refuses a route whose registered definition now points to another deployment", async function _RefusesRouteDrift()
	{
		const compile = __CreatePrismaRunInputCompiler();
		await expect(compile(_Snapshot({ modelDefinitionId: "model-1", litellmModelId: "deployment-a" }), _Transaction("deployment-b"))).rejects.toThrow("changed or unavailable model definition");
	});
});
