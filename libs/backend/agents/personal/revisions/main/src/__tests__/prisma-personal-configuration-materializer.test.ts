import type { RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import { describe, expect, it, vi } from "vitest";

import { PrismaPersonalConfigurationMaterializer } from "../prisma-personal-configuration-materializer.js";

/** Fixed admission command that identifies one personal interactive request. */
const _COMMAND = { runId: "run-2", siloId: "silo-1", agentServiceId: "service-1", threadId: "thread-2", executionSubjectId: "user-1", requestIdempotencyKey: "request-2" } as const;

/** Builds a materialisation transaction with one accepted model-alias request and current revision. */
function _Transaction(patch: unknown = { kind: "model_alias", modelAlias: "careful" }, budget: unknown = { maxTurns: 4, maxTokens: 1000, maxCostUsdMicros: 500_000, maxDurationMs: 60_000 })
{
	const create = vi.fn(async function _create() { return { id: "revision-2" }; });
	const update = vi.fn(async function _update() { return {}; });
	let queryNumber = 0;
	const prisma = {
		$queryRaw: vi.fn(async function _queryRaw() { queryNumber += 1; return queryNumber === 3 ? [{ id: "change-1" }] : queryNumber === 5 ? [{ id: "model-definition-2" }] : []; }),
		personaProfile: { findUnique: vi.fn(async function _profile() { return { id: "profile-1", activeRevisionId: "persona-1" }; }) },
		personalConfigurationChange: { findUnique: vi.fn(async function _change() { return { id: "change-1", agentServiceId: "service-1", expectedPersonaRevisionId: "persona-1", expectedAgentRevisionId: "revision-1", requestedPatch: patch }; }), update },
		agentService: { findFirst: vi.fn(async function _service() { return { id: "service-1", activeRevisionId: "revision-1" }; }), update: vi.fn(async function _updateService() { return {}; }) },
		agentRevision: { findFirst: vi.fn(async function _revision() { return { id: "revision-1", agentServiceId: "service-1", revision: 1, promptPolicyVersion: "prompt-v1", personaRevisionId: "persona-1", modelDefinitionId: "model-a", budget, skillAssignments: [{ skillId: "skill-1", skillRevisionId: "skill-revision-1" }], integrationAssignments: [{ integrationId: "integration-1", siloId: "silo-1", custodyReferenceId: "custody-1", allowedTools: ["search"] }], scopeAttachments: [{ scope: "Personal", subjectType: "User", subjectId: "user-1" }] }; }), create, update: vi.fn(async function _publish() { return {}; }) },
	};
	return { prisma, create, update, transaction: { prisma, admittedAt: "2026-07-23T12:00:00.000Z", admittedAtEpochMs: Date.parse("2026-07-23T12:00:00.000Z") } as unknown as RunAdmissionTransaction };
}

describe("Prisma personal configuration materializer", function _describeMaterializer()
{
	it("clones all active revision assignments before publishing exactly one selected model", async function _materializesModelAlias()
	{
		const fixture = _Transaction();
		const result = await new PrismaPersonalConfigurationMaterializer().materialize(_COMMAND, fixture.transaction);

		expect(result).toEqual({ outcome: "loaded", value: { state: "materialized" } });
		expect(fixture.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revision: 2, parentRevision: { connect: { id: "revision-1" } }, modelDefinition: { connect: { id: "model-definition-2" } }, personaRevisionId: "persona-1", skillAssignments: { create: [{ skillId: "skill-1", skillRevisionId: "skill-revision-1" }] } }) }));
		expect(fixture.prisma.agentService.update).toHaveBeenCalledWith({ where: { id: "service-1" }, data: expect.objectContaining({ activeRevisionId: "revision-2" }) });
		expect(fixture.update).toHaveBeenCalledWith({ where: { id: "change-1" }, data: { state: "Applied", appliedPersonaRevisionId: "persona-1", appliedAgentRevisionId: "revision-2" } });
	});

	it("leaves a persona refresh accepted until the interview and approval authorities finish it", async function _leavesRefreshPending()
	{
		const fixture = _Transaction({ kind: "persona_refresh" });
		const result = await new PrismaPersonalConfigurationMaterializer().materialize(_COMMAND, fixture.transaction);

		expect(result).toEqual({ outcome: "loaded", value: { state: "unchanged" } });
		expect(fixture.create).not.toHaveBeenCalled();
		expect(fixture.update).not.toHaveBeenCalled();
	});

	it("supersedes a model change rather than publishing from an incomplete active budget", async function _invalidBudget()
	{
		const fixture = _Transaction(undefined, { maxTurns: 4, maxTokens: 1000, maxDurationMs: 60_000 });
		const result = await new PrismaPersonalConfigurationMaterializer().materialize(_COMMAND, fixture.transaction);

		expect(result).toEqual({ outcome: "loaded", value: { state: "unchanged" } });
		expect(fixture.create).not.toHaveBeenCalled();
		expect(fixture.update).toHaveBeenCalledWith({ where: { id: "change-1" }, data: { state: "Superseded" } });
	});
});
