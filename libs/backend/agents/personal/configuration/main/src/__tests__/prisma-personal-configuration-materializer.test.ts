import { AgentRevisionState } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __DigestAgentRevisionContent } from "@opencrane/models/agents";

import { _PrismaPersonalConfigurationMaterializer } from "../materialization/prisma-personal-configuration-materializer.js";

/** Trusted materialization command shared by transaction-level tests. */
function _Command()
{
	return {
		siloId: "silo-1",
		userId: "user-1",
		changeId: "change-1",
		materializedAt: "2026-07-23T00:00:00.000Z",
	};
}

/** Accepted proposal row returned after the profile and proposal locks are held. */
function _AcceptedProposal()
{
	return {
		state: "Accepted",
		personaProfileId: "profile-1",
		agentServiceId: "service-1",
		expectedPersonaRevisionId: "persona-1",
		expectedAgentRevisionId: "agent-1",
		requestedPatch: { kind: "model_alias", modelAlias: " careful-model " },
		appliedAgentRevisionId: null,
	};
}

/** Published personal source revision whose executable content must be copied exactly. */
function _SourceRevision()
{
	return {
		id: "agent-1",
		revision: 1,
		promptPolicyVersion: "prompt-v1",
		personaRevisionId: "persona-1",
		modelDefinitionId: "old-model",
		budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 },
		skillAssignments: [{ skillId: "skill-1", skillRevisionId: "skill-revision-1" }],
		integrationAssignments: [{
			integrationId: "integration-1",
			siloId: "silo-1",
			custodyReferenceId: "custody-1",
			allowedTools: ["calendar.read"],
		}],
		scopeAttachments: [{
			scope: "Personal",
			subjectType: "User",
			subjectId: "user-1",
		}],
	};
}

/** Build a complete transaction mock and record its explicit row-lock order. */
function _Transaction(options: { readonly proposal?: unknown; readonly activePersonaRevisionId?: string; readonly activeAgentRevisionId?: string; readonly latestRevisionId?: string; readonly appliedCount?: number } = {})
{
	const locks: string[] = [];
	let revisionLookup = 0;
	const proposal = options.proposal ?? _AcceptedProposal();
	const findProposal = vi.fn()
		.mockResolvedValueOnce({ personaProfileId: "profile-1" })
		.mockResolvedValueOnce(proposal);
	const transaction = {
		$queryRaw: vi.fn(async function _Lock(query: { readonly sql: string })
		{
			if (query.sql.includes("persona_profiles"))
			{
				locks.push("profile");
				return [{
					activeRevisionId: options.activePersonaRevisionId ?? "persona-1",
				}];
			}
			if (query.sql.includes("personal_configuration_changes"))
			{
				locks.push("proposal");
				return [];
			}
			if (query.sql.includes("agent_services"))
			{
				locks.push("service");
				return [];
			}
			throw new Error(`unexpected lock query: ${query.sql}`);
		}),
		personalConfigurationChange: {
			findFirst: findProposal,
			updateMany: vi.fn(async function _Apply()
			{
				return { count: options.appliedCount ?? 1 };
			}),
		},
		agentService: {
			findFirst: vi.fn(async function _FindService()
			{
				return {
					id: "service-1",
					activeRevisionId: options.activeAgentRevisionId ?? "agent-1",
				};
			}),
			update: vi.fn(async function _Activate()
			{
				return { id: "service-1" };
			}),
		},
		agentRevision: {
			findFirst: vi.fn(async function _FindSource()
			{
				revisionLookup += 1;
				return revisionLookup === 1
					? _SourceRevision()
					: { id: options.latestRevisionId ?? "agent-1" };
			}),
			create: vi.fn(async function _CreateRevision()
			{
				return { id: "agent-2" };
			}),
			update: vi.fn(async function _PublishRevision()
			{
				return { id: "agent-2" };
			}),
		},
		modelDefinition: {
			findMany: vi.fn(async function _ResolveModels()
			{
				return [
					{ id: "global-model", scope: "Global" },
					{ id: "tenant-model", scope: "ClusterTenant" },
				];
			}),
		},
	};
	return { locks, transaction };
}

describe("Prisma personal configuration materializer", function _MaterializerSuite()
{
	it("copies, publishes, activates, and applies one accepted proposal in lock order", async function _AppliesAcceptedProposal()
	{
		const { locks, transaction } = _Transaction();
		const expectedContent = {
			promptPolicyVersion: "prompt-v1",
			personaRevisionId: "persona-1",
			modelDefinitionId: "tenant-model",
			budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 },
			skills: [{ skillId: "skill-1", revisionId: "skill-revision-1" }],
			integrationAssignments: [{
				integrationId: "integration-1",
				custodyReferenceId: "custody-1",
				allowedTools: ["calendar.read"],
			}],
			scopeAttachments: [{
				scope: "personal",
				subjectType: "user",
				subjectId: "user-1",
			}],
		} as const;
		const runTransaction = vi.fn(async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
		{
			return callback(transaction);
		});
		const materializer = new _PrismaPersonalConfigurationMaterializer({ $transaction: runTransaction } as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "applied",
			agentRevisionId: "agent-2",
		});

		expect(runTransaction).toHaveBeenCalledOnce();
		expect(locks).toEqual(["profile", "proposal", "service"]);
		expect(transaction.modelDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ publicModelName: "careful-model" }),
		}));
		expect(transaction.agentRevision.create).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({
				revision: 2,
				parentRevision: { connect: { id: "agent-1" } },
				modelDefinition: { connect: { id: "tenant-model" } },
				changeMessage: "Owner accepted model alias: careful-model",
				promptPolicyVersion: "prompt-v1",
				personaRevisionId: "persona-1",
				budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 },
				skillAssignments: {
					create: [{
						skillId: "skill-1",
						skillRevisionId: "skill-revision-1",
					}],
				},
				integrationAssignments: {
					create: [{
						integrationId: "integration-1",
						siloId: "silo-1",
						custodyReferenceId: "custody-1",
						allowedTools: ["calendar.read"],
					}],
				},
				scopeAttachments: {
					create: [{
						scope: "Personal",
						subjectType: "User",
						subjectId: "user-1",
					}],
				},
				digest: __DigestAgentRevisionContent("service-1", 2, expectedContent),
			}),
		}));
		expect(transaction.agentRevision.update).toHaveBeenCalledWith({
			where: { id: "agent-2" },
			data: {
				state: AgentRevisionState.Published,
				publishedAt: new Date(_Command().materializedAt),
			},
		});
		expect(transaction.agentService.update.mock.invocationCallOrder[0]).toBeLessThan(
			transaction.personalConfigurationChange.updateMany.mock.invocationCallOrder[0],
		);
	});

	it("returns the stored revision when retrying an already-applied proposal", async function _ReplaysAppliedProposal()
	{
		const { transaction } = _Transaction({
			proposal: {
				..._AcceptedProposal(),
				state: "Applied",
				appliedAgentRevisionId: "agent-2",
			},
			activePersonaRevisionId: "persona-2",
		});
		const materializer = new _PrismaPersonalConfigurationMaterializer({
			$transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				return callback(transaction);
			},
		} as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "applied",
			agentRevisionId: "agent-2",
		});
		expect(transaction.agentService.findFirst).not.toHaveBeenCalled();
	});

	it("refuses an accepted proposal after a newer persona becomes active", async function _RejectsStalePersona()
	{
		const { transaction } = _Transaction({ activePersonaRevisionId: "persona-2" });
		const materializer = new _PrismaPersonalConfigurationMaterializer({
			$transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				return callback(transaction);
			},
		} as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "stale_proposal",
		});
		expect(transaction.agentService.findFirst).not.toHaveBeenCalled();
	});

	it("rejects a stale service head before resolving the selected model", async function _RejectsStaleServiceHead()
	{
		const { transaction } = _Transaction({ activeAgentRevisionId: "agent-2" });
		const materializer = new _PrismaPersonalConfigurationMaterializer({
			$transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				return callback(transaction);
			},
		} as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "stale_proposal",
		});
		expect(transaction.modelDefinition.findMany).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
	});

	it("rejects a later retained revision instead of reusing its revision number", async function _RejectsLaterRevision()
	{
		const { transaction } = _Transaction({ latestRevisionId: "agent-2" });
		const materializer = new _PrismaPersonalConfigurationMaterializer({
			$transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				return callback(transaction);
			},
		} as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "stale_proposal",
		});
		expect(transaction.modelDefinition.findMany).not.toHaveBeenCalled();
		expect(transaction.agentRevision.create).not.toHaveBeenCalled();
	});

	it("forces transaction rollback when the final proposal transition loses its fence", async function _RollsBackLostProposalFence()
	{
		const { transaction } = _Transaction({ appliedCount: 0 });
		let rolledBack = false;
		const materializer = new _PrismaPersonalConfigurationMaterializer({
			$transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				try
				{
					return await callback(transaction);
				}
				catch (error)
				{
					rolledBack = true;
					throw error;
				}
			},
		} as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "persistence_unavailable",
		});
		expect(rolledBack).toBe(true);
	});
});
