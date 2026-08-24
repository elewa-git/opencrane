import { describe, expect, it, vi } from "vitest";

import { UPGRADE_SESSION_TOOL_REVISION } from "@opencrane/backend/agents/personal/configuration";
import { PROMPT_COMPILER_VERSION, RunInputSnapshotIdentityKinds, type RunInputSnapshot } from "@opencrane/contracts";
import { PERSONAL_MEMORY_RECALL_TOOL_NAME, PERSONAL_MEMORY_RECALL_TOOL_REVISION } from "@opencrane/models/agents";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { __CreateProductionRunInputCompiler, PERSONAL_MEMORY_RECALL_TOOL } from "../production-runtime-dispatch";

/** Carry legacy private memory fields to prove the production compiler excludes them. */
function _PersonalSnapshot(): RunInputSnapshot
{
	return {
		runId: "run-1",
		siloId: "silo-1",
		agentServiceId: "service-1",
		agentRevisionId: "revision-1",
		snapshotVersion: 1,
		conversationId: "conversation-1",
		messageIds: [],
		personaRevisionId: "persona-1",
		preferenceFactIds: [],
		artifactRevisionIds: [],
		skillRevisionIds: [],
		memoryQueryPolicy: { scope: "personal", datasetId: "dataset-1", cogneeDatasetId: "cognee-1", queryText: "private recall query", maxFacts: 8 },
		integrationAssignments: [],
		modelRoute: { alias: "model-1" },
		budgetPolicy: {},
		identitySnapshot: { kind: RunInputSnapshotIdentityKinds.User, executionIssuer: "https://issuer.test", executionSubjectId: "user-1", principalId: "principal-1", fleetMembershipRevision: 1, fleetMembershipIssuer: "fleet", fleetMembershipIssuerKeyId: "key-1", fleetMembershipAssertionId: "assertion-1", fleetMembershipPayloadDigest: `sha256:${"b".repeat(64)}`, fleetMembershipTrustedUntil: "2026-08-13T00:00:00.000Z" },
		capabilitySetDigest: `sha256:${"c".repeat(64)}`,
		effectiveContractDigest: `sha256:${"d".repeat(64)}`,
		promptCompilerVersion: PROMPT_COMPILER_VERSION,
		digest: `sha256:${"e".repeat(64)}`,
		compiledAt: "2026-08-12T00:00:00.000Z",
	};
}

/** Build the immutable control-plane reads used by the production compiler. */
function _Transaction(): never
{
	return {
		personaRevision: { findUnique: vi.fn().mockResolvedValue({ compiledInstructions: "Be helpful." }) },
		conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
		artifactRevision: { findMany: vi.fn().mockResolvedValue([]) },
		skillRevision: { findMany: vi.fn().mockResolvedValue([]) },
		modelDefinition: { findFirst: vi.fn().mockResolvedValue({ publicModelName: "model-1", generatedOutputCapabilities: [] }) },
	} as never;
}

describe("__CreateProductionRunInputCompiler", function _DescribeProductionRunInputCompiler()
{
	it("exposes memory as an approval-required tool without compiling memory coordinates", async function _DeclaresMemoryToolOnly()
	{
		const compiled = await __CreateProductionRunInputCompiler()(_PersonalSnapshot(), 1, _Transaction());
		const serialized = JSON.stringify(compiled);

		expect(compiled.tools.map(function _Revision(tool): string { return tool.toolRevisionId; })).toEqual([PERSONAL_MEMORY_RECALL_TOOL_REVISION, UPGRADE_SESSION_TOOL_REVISION]);
		expect(compiled.tools[0]).toEqual(PERSONAL_MEMORY_RECALL_TOOL);
		expect(compiled.tools[0]?.name).toBe(PERSONAL_MEMORY_RECALL_TOOL_NAME);
		expect(compiled.tools[0]?.name).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
		expect(PERSONAL_MEMORY_RECALL_TOOL.requiresApproval).toBe(true);
		expect(PERSONAL_MEMORY_RECALL_TOOL.parametersSchemaDigest).toBe(___DigestCanonicalJson(PERSONAL_MEMORY_RECALL_TOOL.parametersSchema));
		expect(serialized).not.toContain("private-fact-reference");
		expect(serialized).not.toContain("private recall query");
	});
});
