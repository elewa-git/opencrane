import { PersonalConfigurationChangeState, Prisma, type PrismaClient } from "@prisma/client";

import { _IsPersonalConfigurationPatch } from "../proposal/personal-configuration-patch.js";
import { PersonalConfigurationChangeViewStates, type PersonalConfigurationChangeView, type PersonalConfigurationChangeViewRepository } from "./personal-configuration-view.types.js";

/** Selected Prisma proposal row before mapping to the owner-visible product shape. */
interface PersonalConfigurationViewRow
{
	/** Durable proposal identifier. */
	readonly id: string;
	/** Persisted closed patch payload. */
	readonly requestedPatch: Prisma.JsonValue;
	/** Database lifecycle state. */
	readonly state: PersonalConfigurationChangeState;
	/** Conversation provenance. */
	readonly sourceConversationId: string;
	/** Run provenance. */
	readonly sourceRunId: string;
	/** Trusted creation instant. */
	readonly proposedAt: Date;
	/** Trusted decision instant, when decided. */
	readonly decidedAt: Date | null;
	/** Owner rejection reason, when rejected. */
	readonly rejectionReason: string | null;
}

/** Prisma read repository for bounded owner-visible proposal history. */
export class PrismaPersonalConfigurationViewRepository implements PersonalConfigurationChangeViewRepository
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;

	/** Creates the read repository over the canonical product database. */
	constructor(prisma: PrismaClient)
	{
		this.prisma = prisma;
	}

	/** List the latest fifty proposals belonging to one exact owner and silo. */
	async listOwned(siloId: string, userId: string): Promise<readonly PersonalConfigurationChangeView[]>
	{
		const changes = await this.prisma.personalConfigurationChange.findMany({ where: { siloId, userId }, orderBy: [{ proposedAt: "desc" }, { id: "desc" }], take: 50, select: { id: true, requestedPatch: true, state: true, sourceConversationId: true, sourceRunId: true, proposedAt: true, decidedAt: true, rejectionReason: true } });
		return changes.map(_toChangeView);
	}
}

/** Map one selected proposal row into the closed owner-visible product shape. */
function _toChangeView(change: PersonalConfigurationViewRow): PersonalConfigurationChangeView
{
	if (!_IsPersonalConfigurationPatch(change.requestedPatch)) throw new Error("personal configuration change has unsupported patch shape");
	return { changeId: change.id, requestedPatch: change.requestedPatch, state: _viewState(change.state), sourceConversationId: change.sourceConversationId, sourceRunId: change.sourceRunId, proposedAt: change.proposedAt.toISOString(), decidedAt: change.decidedAt?.toISOString() ?? null, rejectionReason: change.rejectionReason };
}

/** Convert the database lifecycle enum to its stable owner-visible vocabulary. */
function _viewState(state: PersonalConfigurationChangeState): PersonalConfigurationChangeViewStates
{
	if (state === PersonalConfigurationChangeState.Proposed) return PersonalConfigurationChangeViewStates.Proposed;
	if (state === PersonalConfigurationChangeState.Accepted) return PersonalConfigurationChangeViewStates.Accepted;
	if (state === PersonalConfigurationChangeState.Applied) return PersonalConfigurationChangeViewStates.Applied;
	if (state === PersonalConfigurationChangeState.Rejected) return PersonalConfigurationChangeViewStates.Rejected;
	return PersonalConfigurationChangeViewStates.Superseded;
}
