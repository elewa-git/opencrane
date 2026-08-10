import { AgentConfigPatchKinds } from "@opencrane/contracts";
import { describe, expect, it, vi } from "vitest";

import { PersonalConfigurationChangeViewStates } from "../query/personal-configuration-view.types.js";
import { PrismaPersonalConfigurationViewRepository } from "../query/prisma-personal-configuration-view-repository.js";

describe("Prisma personal configuration view repository", function _PrismaPersonalConfigurationViewRepositorySuite()
{
	it("lists only the selected owner's bounded newest-first proposal history", async function _ListsOwned()
	{
		const findMany = vi.fn(async function _find() { return [{ id: "change-1", requestedPatch: { kind: "model_alias", modelAlias: "careful-model" }, state: "Proposed", sourceConversationId: "conversation-1", sourceRunId: "run-1", proposedAt: new Date("2026-07-23T00:00:00.000Z"), decidedAt: null, rejectionReason: null }]; });
		const repository = new PrismaPersonalConfigurationViewRepository({ personalConfigurationChange: { findMany } } as never);
		await expect(repository.listOwned("silo-1", "user-1")).resolves.toEqual([{ changeId: "change-1", requestedPatch: { kind: AgentConfigPatchKinds.ModelAlias, modelAlias: "careful-model" }, state: PersonalConfigurationChangeViewStates.Proposed, sourceConversationId: "conversation-1", sourceRunId: "run-1", proposedAt: "2026-07-23T00:00:00.000Z", decidedAt: null, rejectionReason: null }]);
		expect(findMany).toHaveBeenCalledWith({ where: { siloId: "silo-1", userId: "user-1" }, orderBy: [{ proposedAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, requestedPatch: true, state: true, sourceConversationId: true, sourceRunId: true, proposedAt: true, decidedAt: true, rejectionReason: true } });
	});
});
