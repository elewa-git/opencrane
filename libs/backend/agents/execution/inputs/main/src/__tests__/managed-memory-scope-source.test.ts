import { AuthorizationScopeKind, GrantSubjectType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ManagedMemoryScopeSource } from "../managed-memory-scope-source.js";

/** Builds one transaction whose memory catalogue returns the supplied active rows. */
function _Transaction(datasets: readonly unknown[])
{
	return { prisma: { memoryDataset: { findMany: vi.fn().mockResolvedValue(datasets) } } };
}

/** Builds a managed identity whose effective attachments already passed the grant-intersection fence. */
function _Identity()
{
	return {
		kind: "service",
		agentServiceId: "service-1",
		organizationId: "org-1",
		effectiveScopeAttachments: [
			{ scope: "team", subjectType: "group", subjectId: "team-1" },
			{ scope: "project", subjectType: "group", subjectId: "project-1" },
		],
	};
}

describe("ManagedMemoryScopeSource", function _DescribeManagedMemoryScopeSource()
{
	it("freezes every catalogued effective scope in canonical order", async function _FreezesDatasetSet()
	{
		const transaction = _Transaction([
			{ id: "dataset-team", cogneeDatasetId: "cognee-team", scopeKind: AuthorizationScopeKind.Team, subjectType: GrantSubjectType.Group, scopeResourceId: "team-1" },
			{ id: "dataset-project", cogneeDatasetId: "cognee-project", scopeKind: AuthorizationScopeKind.Project, subjectType: GrantSubjectType.Group, scopeResourceId: "project-1" },
		]);
		const source = new ManagedMemoryScopeSource();

		await expect(source.load({ siloId: "silo-1" } as never, { agentKind: "managed", agentServiceId: "service-1" } as never, _Identity() as never, transaction as never)).resolves.toEqual({
			outcome: "loaded",
			value: {
				memoryQueryPolicy: {
					scope: "attached",
					datasets: [
						{ datasetId: "dataset-project", cogneeDatasetId: "cognee-project", scope: "project", subjectType: "group", subjectId: "project-1" },
						{ datasetId: "dataset-team", cogneeDatasetId: "cognee-team", scope: "team", subjectType: "group", subjectId: "team-1" },
					],
				},
				memoryFacts: [],
			},
		});
		expect(transaction.prisma.memoryDataset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ siloId: "silo-1", organizationId: "org-1" }) }));
	});

	it("fails closed when any effective scope lacks its own active catalogue mapping", async function _DeniesMissingDataset()
	{
		const transaction = _Transaction([{ id: "dataset-team", cogneeDatasetId: "cognee-team", scopeKind: AuthorizationScopeKind.Team, subjectType: GrantSubjectType.Group, scopeResourceId: "team-1" }]);

		await expect(new ManagedMemoryScopeSource().load({ siloId: "silo-1" } as never, { agentKind: "managed", agentServiceId: "service-1" } as never, _Identity() as never, transaction as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
	});

	it("refuses attachments from another managed service", async function _DeniesMismatchedService()
	{
		await expect(new ManagedMemoryScopeSource().load({ siloId: "silo-1" } as never, { agentKind: "managed", agentServiceId: "service-2" } as never, _Identity() as never, _Transaction([]) as never)).resolves.toEqual({ outcome: "denied", reason: "memory_scope_unavailable" });
	});
});
