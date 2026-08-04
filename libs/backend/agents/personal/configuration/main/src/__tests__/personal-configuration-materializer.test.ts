import { describe, expect, it, vi } from "vitest";

import { AgentRevisionModelSelectionMaterializationCodes } from "@opencrane/backend/server/agents/agent-services";

import { PersonalConfigurationMaterializationResolutionOutcomes } from "../materialization/personal-configuration-materialization-state.types.js";
import { _PersonalConfigurationMaterializer } from "../materialization/personal-configuration-materializer.js";

/** Trusted owner command for repository-orchestration tests. */
function _Command()
{
	return {
		siloId: "silo-1",
		userId: "user-1",
		changeId: "change-1",
		materializedAt: "2026-07-23T00:00:00.000Z",
	};
}

describe("personal configuration materializer", function _MaterializerSuite()
{
	it("coordinates capability repositories in evidence, service, then proposal order", async function _CoordinatesRepositories()
	{
		const order: string[] = [];
		const proposals = {
			resolve: vi.fn(async function _Resolve()
			{
				order.push("resolve");
				return {
					outcome: PersonalConfigurationMaterializationResolutionOutcomes.Ready,
					proposal: {
						agentServiceId: "service-1",
						expectedAgentRevisionId: "revision-1",
						expectedPersonaRevisionId: "persona-1",
						modelAlias: "careful-model",
					},
				} as const;
			}),
			apply: vi.fn(async function _Apply()
			{
				order.push("apply");
				return { status: "applied", agentRevisionId: "revision-2" } as const;
			}),
		};
		const agentRevisions = {
			materialize: vi.fn(async function _Materialize()
			{
				order.push("materialize");
				return { status: AgentRevisionModelSelectionMaterializationCodes.Materialized, agentRevisionId: "revision-2" } as const;
			}),
		};
		const unitOfWork = {
			run: vi.fn(async function _Run(work: (transaction: never) => Promise<unknown>)
			{
				return work({ proposals, agentRevisions } as never);
			}),
		};
		const materializer = new _PersonalConfigurationMaterializer(unitOfWork as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({
			status: "applied",
			agentRevisionId: "revision-2",
		});
		expect(order).toEqual(["resolve", "materialize", "apply"]);
		expect(agentRevisions.materialize).toHaveBeenCalledWith({
			siloId: "silo-1",
			agentServiceId: "service-1",
			expectedSourceRevisionId: "revision-1",
			expectedPersonaRevisionId: "persona-1",
			modelAlias: "careful-model",
			changeMessage: "Owner accepted model alias: careful-model",
			authoredBy: "user-1",
			materializedAt: new Date("2026-07-23T00:00:00.000Z"),
		});
	});

	it("returns terminal proposal outcomes without entering agent-services", async function _ReturnsTerminalProposal()
	{
		const agentRevisions = { materialize: vi.fn() };
		const unitOfWork = {
			run: async function _Run(work: (transaction: never) => Promise<unknown>)
			{
				return work({
					proposals: {
						resolve: async function _Resolve() { return { outcome: PersonalConfigurationMaterializationResolutionOutcomes.Terminal, result: { status: "stale_proposal" } } as const; },
						apply: vi.fn(),
					},
					agentRevisions,
				} as never);
			},
		};
		const materializer = new _PersonalConfigurationMaterializer(unitOfWork as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({ status: "stale_proposal" });
		expect(agentRevisions.materialize).not.toHaveBeenCalled();
	});

	it("translates an exhausted unit-of-work failure once at the application boundary", async function _TranslatesFailure()
	{
		const failure = new Error("database unavailable");
		const logger = { error: vi.fn() };
		const unitOfWork = { run: vi.fn().mockRejectedValue(failure) };
		const materializer = new _PersonalConfigurationMaterializer(unitOfWork as never, logger as never);

		await expect(materializer.materializeAtomically(_Command())).resolves.toEqual({ status: "persistence_unavailable" });
		expect(logger.error).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: failure }), expect.any(String));
	});
});
