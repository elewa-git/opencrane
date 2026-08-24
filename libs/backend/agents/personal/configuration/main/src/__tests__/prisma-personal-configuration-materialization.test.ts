import { AgentRevisionState, Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { __DigestAgentRevisionContent, RevisionBoundaryCoverages, RevisionBoundaryKinds } from "@opencrane/models/agents";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { _PersonalConfigurationMaterializer } from "../materialization/personal-configuration-materializer";
import { PrismaPersonalConfigurationMaterializationUnitOfWork } from "../materialization/prisma-personal-configuration-materialization-unit-of-work";

/** Builds a tool definition that materialisation must copy to the new revision. */
function _Tool()
{
	const parametersSchema = { type: "object", additionalProperties: false } as const;
	return { name: "calendar.read", description: "Read a calendar", parametersSchema, parametersSchemaDigest: ___DigestCanonicalJson(parametersSchema) };
}

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

/** Builds the accepted proposal row the repository's lookup returns. */
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

/** Builds the source revision whose content the new revision must copy exactly. */
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
			toolDefinitions: [_Tool()],
		}],
		boundaryAttachments: [{
			boundaryKind: "Personal",
			boundaryGroupId: null,
			boundaryPrincipalId: "principal-1",
			boundaryCoverage: "Exact",
		}],
	};
}

/** Composes the application materializer with its Prisma unit-of-work adapter. */
function _Materializer(prisma: never, logger?: never): _PersonalConfigurationMaterializer
{
	return new _PersonalConfigurationMaterializer(new PrismaPersonalConfigurationMaterializationUnitOfWork(prisma), logger);
}

/** Build a complete transaction mock for one serializable materialization attempt. */
function _Transaction(options: { readonly proposal?: unknown; readonly activePersonaRevisionId?: string; readonly activeAgentRevisionId?: string; readonly latestRevisionId?: string; readonly appliedCount?: number } = {})
{
	let revisionLookup = 0;
	const proposal = options.proposal ?? _AcceptedProposal();
	const transaction = {
		personalConfigurationChange: {
			findFirst: vi.fn(async function _FindProposal()
			{
				return proposal;
			}),
			updateMany: vi.fn(async function _Apply()
			{
				return { count: options.appliedCount ?? 1 };
			}),
		},
		personaProfile: {
			findFirst: vi.fn(async function _FindProfile()
			{
				return { activeRevisionId: options.activePersonaRevisionId ?? "persona-1" };
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
	return { transaction };
}

describe("Prisma-backed personal configuration materialization", function _MaterializationSuite()
{
	it("copies, publishes, activates, and applies one accepted proposal from a serializable snapshot", async function _AppliesAcceptedProposal()
	{
		const { transaction } = _Transaction();
		const expectedContent = {
			promptPolicyVersion: "prompt-v1",
			personaRevisionId: "persona-1",
			modelDefinitionId: "tenant-model",
			budget: { maxTurns: 5, maxTokens: 1000, maxDurationMs: 30000 },
			skills: [{ skillId: "skill-1", revisionId: "skill-revision-1" }],
			integrationAssignments: [{
				integrationId: "integration-1",
				custodyReferenceId: "custody-1",
				toolDefinitions: [_Tool()],
			}],
			boundaryAttachments: [{
				boundaryKind: RevisionBoundaryKinds.Personal,
				boundaryId: "principal-1",
				boundaryCoverage: RevisionBoundaryCoverages.Exact,
			}],
		} as const;
		const runTransaction = vi.fn(async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
		{
			return callback(transaction);
		});
		const materializer = _Materializer({ $transaction: runTransaction } as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "applied",
			agentRevisionId: "agent-2",
		});

		expect(runTransaction).toHaveBeenCalledOnce();
		expect(runTransaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
		});
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
						toolDefinitions: [_Tool()],
					}],
				},
				boundaryAttachments: {
					create: [{
						siloId: "silo-1",
						boundaryKind: "Personal",
						boundaryPrincipalId: "principal-1",
						boundaryCoverage: "Exact",
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

	it.each(["P0001", "P2002", "P2004", "P2034"])("retries rolled-back %s conflicts into an idempotent replay", async function _RetriesConflict(code)
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("concurrent materialization", { code, clientVersion: "test" });
		const { transaction } = _Transaction({
			proposal: {
				..._AcceptedProposal(),
				state: "Applied",
				appliedAgentRevisionId: "agent-2",
			},
		});
		const runTransaction = vi.fn()
			.mockRejectedValueOnce(conflict)
			.mockImplementation(async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				return callback(transaction);
			});
		const materializer = _Materializer({ $transaction: runTransaction } as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "applied",
			agentRevisionId: "agent-2",
		});
		expect(runTransaction).toHaveBeenCalledTimes(2);
		expect(transaction.agentService.findFirst).not.toHaveBeenCalled();
	});

	it("stops after three rolled-back conflict attempts", async function _BoundsConflictRetries()
	{
		const conflict = new Prisma.PrismaClientKnownRequestError("concurrent materialization", { code: "P2034", clientVersion: "test" });
		const runTransaction = vi.fn().mockRejectedValue(conflict);
		const logger = { error: vi.fn() };
		const materializer = _Materializer({ $transaction: runTransaction } as never, logger as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "persistence_unavailable",
		});
		expect(runTransaction).toHaveBeenCalledTimes(3);
		expect(logger.error).toHaveBeenCalledOnce();
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
		const materializer = _Materializer({
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

	it("leaves an accepted persona refresh with the persona approval authority", async function _LeavesPersonaRefreshToPersonaApproval()
	{
		const { transaction } = _Transaction({
			proposal: {
				..._AcceptedProposal(),
				requestedPatch: { kind: "persona_refresh" },
			},
		});
		const materializer = _Materializer({
			$transaction: async function _RunTransaction(callback: (value: unknown) => Promise<unknown>)
			{
				return callback(transaction);
			},
		} as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "not_applicable",
		});
		expect(transaction.personaProfile.findFirst).not.toHaveBeenCalled();
		expect(transaction.agentService.findFirst).not.toHaveBeenCalled();
	});

	it("refuses an accepted proposal after a newer persona becomes active", async function _RejectsStalePersona()
	{
		const { transaction } = _Transaction({ activePersonaRevisionId: "persona-2" });
		const materializer = _Materializer({
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
		const materializer = _Materializer({
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
		const materializer = _Materializer({
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
		const materializer = _Materializer({
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
