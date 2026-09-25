import { AgentRevisionState, Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { AgentRevisionModelSelectionMaterializationCodes } from "../../../../revisions/agent-revision-model-selection.types";
import { AgentRevisionPersonaSelectionMaterializationCodes } from "../../../../revisions/agent-revision-persona-selection.types";
import { PrismaAgentRevisionModelSelectionRepository } from "../../../../revisions/db/prisma-agent-revision-model-selection";
import { PrismaAgentRevisionPersonaSelectionRepository } from "../../../../revisions/db/prisma-agent-revision-persona-selection";
import { PersonalAgentToolsConflict, PersonalAgentToolsDenied } from "../../personal-agent-tools.errors";
import { PrismaPersonalAgentToolsUnitOfWork } from "../prisma-personal-agent-tools-unit-of-work";
import { _GrantIndependentPersonalToolUse, _RemovePersonalManagerToolGrants, _SeedPersonalAgentToolsSqlFixture } from "./personal-agent-tools.sql-fixture";

/** First process connection owns the operation being tested. */
const _First = new PrismaClient();
/** Second process connection observes committed rows and competes in races. */
const _Second = new PrismaClient();

/** Creates the production personal tool-selection transaction owner. */
function _Authority(client: PrismaClient): PrismaPersonalAgentToolsUnitOfWork
{
	return new PrismaPersonalAgentToolsUnitOfWork(client);
}

/** Loads one revision with every nested executable assignment. */
function _Revision(client: PrismaClient, revisionId: string)
{
	return client.agentRevision.findUniqueOrThrow({ where: { id: revisionId }, include: { skillAssignments: true, mcpToolAssignments: true, boundaryAttachments: true } });
}

/** Projects all immutable content except the selected MCP tools. */
function _NonToolContent(revision: Awaited<ReturnType<typeof _Revision>>)
{
	return {
		promptPolicyVersion: revision.promptPolicyVersion,
		personaRevisionId: revision.personaRevisionId,
		modelDefinitionId: revision.modelDefinitionId,
		budget: revision.budget,
		skillAssignments: revision.skillAssignments.map(function _Skill(assignment) { return { skillId: assignment.skillId, skillRevisionId: assignment.skillRevisionId }; }),
		boundaryAttachments: revision.boundaryAttachments.map(function _Boundary(attachment) { return { siloId: attachment.siloId, boundaryKind: attachment.boundaryKind, boundaryGroupId: attachment.boundaryGroupId, boundaryPrincipalId: attachment.boundaryPrincipalId, boundaryCoverage: attachment.boundaryCoverage }; }),
	};
}

/** Counts rows that would reveal a partially committed selection attempt. */
async function _Residue(client: PrismaClient, siloId: string, agentServiceId: string)
{
	return {
		revisions: await client.agentRevision.count({ where: { siloId, agentServiceId } }),
		assignments: await client.agentRevisionMcpToolAssignment.count({ where: { siloId, agentServiceId } }),
		ownerToolGrants: await client.authorizationGrant.count({ where: { siloId, managerId: { startsWith: "personal-agent-owner-access:" }, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision } }),
		toolDecisions: await client.auditDecision.count({ where: { siloId, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision } }),
	};
}

describe("personal MCP tool selection on the fresh PostgreSQL baseline", function _Suite()
{
	beforeAll(async function _Connect()
	{
		if (!process.env.DATABASE_URL)
			throw new Error("Personal tool SQL proof requires DATABASE_URL and the fresh target baseline");
		await Promise.all([_First.$connect(), _Second.$connect()]);
	});
	afterAll(async function _Disconnect() { await Promise.all([_First.$disconnect(), _Second.$disconnect()]); });

	it("publishes one immutable successor and keeps its non-tool content through model selection", async function _ImmutableSuccessors()
	{
		const fixture = await _SeedPersonalAgentToolsSqlFixture(_First);
		const caller = { siloId: fixture.siloId, subjectId: fixture.subjectId };
		const sourceBefore = await _Revision(_Second, fixture.sourceRevisionId);
		const selectedIds = [fixture.secondTool.toolRevisionId, fixture.firstTool.toolRevisionId].sort();
		const selected = await _Authority(_First).setTools(caller, { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [fixture.secondTool.toolRevisionId, fixture.firstTool.toolRevisionId] });
		expect(selected.toolRevisionIds).toEqual(selectedIds);
		expect(await _Revision(_Second, fixture.sourceRevisionId)).toEqual(sourceBefore);

		const successor = await _Revision(_Second, selected.activeRevisionId);
		expect(successor).toMatchObject({ agentServiceId: fixture.agentServiceId, parentRevisionId: fixture.sourceRevisionId, revision: 2, state: AgentRevisionState.Published });
		expect(_NonToolContent(successor)).toEqual(_NonToolContent(sourceBefore));
		expect(successor.mcpToolAssignments.map(function _ToolId(assignment) { return assignment.toolRevisionId; }).sort()).toEqual(selectedIds);

		const modelResult = await _First.$transaction(async function _SelectModel(transaction)
		{
			const repository = new PrismaAgentRevisionModelSelectionRepository(transaction);
			return repository.materialize({ siloId: fixture.siloId, agentServiceId: fixture.agentServiceId, expectedSourceRevisionId: selected.activeRevisionId, expectedPersonaRevisionId: fixture.personaRevisionId, modelAlias: fixture.targetModelAlias, authoredBy: fixture.subjectId, materializedAt: new Date(), changeMessage: "Owner selected another model" });
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
		expect(modelResult.status).toBe(AgentRevisionModelSelectionMaterializationCodes.Materialized);
		if (modelResult.status !== AgentRevisionModelSelectionMaterializationCodes.Materialized)
			throw new Error("Personal tool SQL proof expected model materialization");
		const modelSuccessor = await _Revision(_Second, modelResult.agentRevisionId);
		expect(modelSuccessor).toMatchObject({ parentRevisionId: selected.activeRevisionId, revision: 3, modelDefinitionId: fixture.targetModelId, state: AgentRevisionState.Published });
		expect(modelSuccessor.mcpToolAssignments.map(function _ToolId(assignment) { return assignment.toolRevisionId; }).sort()).toEqual(selectedIds);

		const personaResult = await _First.$transaction(async function _SelectPersona(transaction)
		{
			const repository = new PrismaAgentRevisionPersonaSelectionRepository(transaction);
			return repository.materialize({ siloId: fixture.siloId, subjectId: fixture.subjectId, principalId: fixture.principalId, agentServiceId: fixture.agentServiceId, expectedSourceRevisionId: modelResult.agentRevisionId, targetPersonaRevisionId: fixture.targetPersonaRevisionId, authoredBy: fixture.subjectId, materializedAt: new Date(), changeMessage: "Owner selected another persona" });
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
		expect(personaResult.status).toBe(AgentRevisionPersonaSelectionMaterializationCodes.Materialized);
		if (personaResult.status !== AgentRevisionPersonaSelectionMaterializationCodes.Materialized)
			throw new Error("Personal tool SQL proof expected persona materialization");
		const personaSuccessor = await _Revision(_Second, personaResult.agentRevisionId);
		expect(personaSuccessor).toMatchObject({ parentRevisionId: modelResult.agentRevisionId, revision: 4, modelDefinitionId: fixture.targetModelId, personaRevisionId: fixture.targetPersonaRevisionId, state: AgentRevisionState.Published });
		expect(personaSuccessor.mcpToolAssignments.map(function _ToolId(assignment) { return assignment.toolRevisionId; }).sort()).toEqual(selectedIds);
	});

	it("rolls back every selection effect when Assign is denied", async function _DeniedAssign()
	{
		const fixture = await _SeedPersonalAgentToolsSqlFixture(_First);
		await _Second.authorizationGrant.updateMany({ where: { siloId: fixture.siloId, subjectPrincipalId: fixture.principalId, resourceId: fixture.firstTool.toolRevisionId, capabilityId: "mcp-tool-revision:assign", revokedAt: null }, data: { revokedAt: new Date() } });
		const before = await _Residue(_Second, fixture.siloId, fixture.agentServiceId);
		await expect(_Authority(_First).setTools({ siloId: fixture.siloId, subjectId: fixture.subjectId }, { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [fixture.firstTool.toolRevisionId] })).rejects.toBeInstanceOf(PersonalAgentToolsDenied);
		expect(await _Residue(_Second, fixture.siloId, fixture.agentServiceId)).toEqual(before);
		await expect(_Authority(_Second).getTools({ siloId: fixture.siloId, subjectId: fixture.subjectId })).resolves.toMatchObject({ activeRevisionId: fixture.sourceRevisionId, toolRevisionIds: [] });
	});

	it("removes sorted personal Use and Invoke grants without touching another manager", async function _GrantReplacement()
	{
		const fixture = await _SeedPersonalAgentToolsSqlFixture(_First);
		const caller = { siloId: fixture.siloId, subjectId: fixture.subjectId };
		const initial = await _Authority(_First).setTools(caller, { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [fixture.secondTool.toolRevisionId, fixture.firstTool.toolRevisionId] });
		await _GrantIndependentPersonalToolUse(_Second, fixture, fixture.firstTool.toolRevisionId);
		const replacement = await _Authority(_First).setTools(caller, { expectedActiveRevisionId: initial.activeRevisionId, toolRevisionIds: [fixture.secondTool.toolRevisionId] });
		expect(replacement.toolRevisionIds).toEqual([fixture.secondTool.toolRevisionId]);

		const managerId = `personal-agent-owner-access:${fixture.principalId}`;
		const current = await _Second.authorizationGrant.findMany({ where: { siloId: fixture.siloId, managerId, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, revokedAt: null } });
		expect(current.map(function _GrantCoordinate(grant) { return [grant.resourceId, grant.capabilityId]; }).sort()).toEqual([ProductAuthorizationActions.Invoke, ProductAuthorizationActions.Use].map(function _Capability(action) { return [fixture.secondTool.toolRevisionId, `mcp-tool-revision:${action}`]; }).sort());
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId, resourceId: fixture.firstTool.toolRevisionId, revokedAt: null } })).toBe(0);
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId: "personal-tools-sql-independent", resourceId: fixture.firstTool.toolRevisionId, revokedAt: null } })).toBe(1);
	});

	it("repairs identical-selection grants only while Assign remains allowed", async function _IdenticalSelectionRepair()
	{
		const fixture = await _SeedPersonalAgentToolsSqlFixture(_First);
		const caller = { siloId: fixture.siloId, subjectId: fixture.subjectId };
		const toolRevisionId = fixture.firstTool.toolRevisionId;
		const managerId = `personal-agent-owner-access:${fixture.principalId}`;
		const command = { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [toolRevisionId] };
		const selected = await _Authority(_First).setTools(caller, command);
		await _GrantIndependentPersonalToolUse(_Second, fixture, toolRevisionId);
		await _RemovePersonalManagerToolGrants(_Second, fixture, toolRevisionId);
		const beforeRepair = await _Residue(_Second, fixture.siloId, fixture.agentServiceId);
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId, resourceId: toolRevisionId, revokedAt: null } })).toBe(0);

		const repaired = await _Authority(_First).setTools(caller, { expectedActiveRevisionId: selected.activeRevisionId, toolRevisionIds: [toolRevisionId] });
		expect(repaired).toEqual(selected);
		const afterRepair = await _Residue(_Second, fixture.siloId, fixture.agentServiceId);
		expect({ revisions: afterRepair.revisions, assignments: afterRepair.assignments }).toEqual({ revisions: beforeRepair.revisions, assignments: beforeRepair.assignments });
		const repairedCapabilities = await _Second.authorizationGrant.findMany({ where: { siloId: fixture.siloId, managerId, resourceId: toolRevisionId, revokedAt: null }, select: { capabilityId: true } });
		expect(repairedCapabilities.map(function _Capability(grant) { return grant.capabilityId; }).sort()).toEqual([`mcp-tool-revision:${ProductAuthorizationActions.Invoke}`, `mcp-tool-revision:${ProductAuthorizationActions.Use}`]);
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId: "personal-tools-sql-independent", resourceId: toolRevisionId, revokedAt: null } })).toBe(1);

		await _RemovePersonalManagerToolGrants(_Second, fixture, toolRevisionId);
		await _Second.authorizationGrant.updateMany({ where: { siloId: fixture.siloId, subjectPrincipalId: fixture.principalId, resourceId: toolRevisionId, capabilityId: "mcp-tool-revision:assign", revokedAt: null }, data: { revokedAt: new Date() } });
		const beforeDeniedRepair = await _Residue(_Second, fixture.siloId, fixture.agentServiceId);
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId, resourceId: toolRevisionId, revokedAt: null } })).toBe(0);
		await expect(_Authority(_First).setTools(caller, { expectedActiveRevisionId: selected.activeRevisionId, toolRevisionIds: [toolRevisionId] })).rejects.toBeInstanceOf(PersonalAgentToolsDenied);
		expect(await _Residue(_Second, fixture.siloId, fixture.agentServiceId)).toEqual(beforeDeniedRepair);
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId, resourceId: toolRevisionId, revokedAt: null } })).toBe(0);
		expect(await _Second.authorizationGrant.count({ where: { siloId: fixture.siloId, managerId: "personal-tools-sql-independent", resourceId: toolRevisionId, revokedAt: null } })).toBe(1);
	});

	it("commits one of two same-source writers without loser residue", async function _ConcurrentWriters()
	{
		const fixture = await _SeedPersonalAgentToolsSqlFixture(_First);
		const caller = { siloId: fixture.siloId, subjectId: fixture.subjectId };
		const results = await Promise.allSettled([
			_Authority(_First).setTools(caller, { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [fixture.firstTool.toolRevisionId] }),
			_Authority(_Second).setTools(caller, { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [fixture.secondTool.toolRevisionId] }),
		]);
		const fulfilled = results.filter(function _Fulfilled(result) { return result.status === "fulfilled"; });
		const rejected = results.find(function _Rejected(result) { return result.status === "rejected"; });
		expect(fulfilled).toHaveLength(1);
		expect(rejected?.status === "rejected" && rejected.reason instanceof PersonalAgentToolsConflict).toBe(true);
		const current = await _Authority(_Second).getTools(caller);
		expect(current).toEqual(fulfilled[0]?.status === "fulfilled" ? fulfilled[0].value : null);
		expect(await _Second.agentRevision.count({ where: { siloId: fixture.siloId, agentServiceId: fixture.agentServiceId } })).toBe(2);
		expect(await _Second.agentRevision.count({ where: { siloId: fixture.siloId, agentServiceId: fixture.agentServiceId, state: AgentRevisionState.Draft } })).toBe(0);
		expect(await _Second.agentRevisionMcpToolAssignment.count({ where: { siloId: fixture.siloId, agentServiceId: fixture.agentServiceId } })).toBe(1);
		const grants = await _Second.authorizationGrant.findMany({ where: { siloId: fixture.siloId, managerId: `personal-agent-owner-access:${fixture.principalId}`, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, revokedAt: null } });
		expect(grants).toHaveLength(2);
		expect(grants.every(function _WinningTool(grant) { return current.toolRevisionIds.includes(grant.resourceId!); })).toBe(true);
		const decisions = await _Second.auditDecision.findMany({ where: { siloId: fixture.siloId, resourceKind: ProductAuthorizationResourceKinds.McpToolRevision, action: ProductAuthorizationActions.Assign } });
		expect(decisions.map(function _Resource(decision) { return decision.resourceId; })).toEqual(current.toolRevisionIds);
	});

	it("returns a committed selection after restart and conflicts a lost-response replay", async function _LostResponse()
	{
		const fixture = await _SeedPersonalAgentToolsSqlFixture(_First);
		const caller = { siloId: fixture.siloId, subjectId: fixture.subjectId };
		const command = { expectedActiveRevisionId: fixture.sourceRevisionId, toolRevisionIds: [fixture.secondTool.toolRevisionId, fixture.firstTool.toolRevisionId] };
		await _Authority(_First).setTools(caller, command);
		const beforeReplay = await _Residue(_Second, fixture.siloId, fixture.agentServiceId);

		const restarted = new PrismaClient();
		await restarted.$connect();
		try
		{
			const selection = await _Authority(restarted).getTools(caller);
			expect(selection.toolRevisionIds).toEqual([...command.toolRevisionIds].sort());
			expect(selection.activeRevisionId).not.toBe(command.expectedActiveRevisionId);
		}
		finally
		{
			await restarted.$disconnect();
		}

		await expect(_Authority(_Second).setTools(caller, command)).rejects.toBeInstanceOf(PersonalAgentToolsConflict);
		expect(await _Residue(_Second, fixture.siloId, fixture.agentServiceId)).toEqual(beforeReplay);
	});
});
