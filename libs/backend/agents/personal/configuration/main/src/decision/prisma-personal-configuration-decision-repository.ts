import { PersonalConfigurationChangeState, type PrismaClient } from "@prisma/client";

import { ___CreateLogger, type Logger } from "@opencrane/observability";

import { PersonalConfigurationDecisionCodes, type DecidePersonalConfigurationChangeCommand, type PersonalConfigurationChangeDecisionRepository } from "./personal-configuration-decision.types.js";

/** Prisma repository for the proposal owner's explicit accept-or-reject decision. */
export class PrismaPersonalConfigurationDecisionRepository implements PersonalConfigurationChangeDecisionRepository
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Redacted structured logger for handled persistence failures. */
	private readonly logger: Logger;

	/** Creates the decision repository over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Compare-and-set an owner decision while retaining immutable proposal provenance. */
	async decideAtomically(command: DecidePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationDecisionCodes.Accepted | PersonalConfigurationDecisionCodes.Rejected } | { readonly status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner | PersonalConfigurationDecisionCodes.AlreadyDecided | PersonalConfigurationDecisionCodes.PersistenceUnavailable }>
	{
		try
		{
			// 1. Transition only the exact still-proposed owner record.
			const state = command.decision === PersonalConfigurationDecisionCodes.Accepted ? PersonalConfigurationChangeState.Accepted : PersonalConfigurationChangeState.Rejected;
			const updated = await this.prisma.personalConfigurationChange.updateMany({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId, state: PersonalConfigurationChangeState.Proposed }, data: { state, decidedAt: new Date(command.decidedAt), decidedBy: command.userId, rejectionReason: command.rejectionReason } });
			if (updated.count === 1) return { status: command.decision };

			// 2. Hide non-owned records while distinguishing an already-terminal owner proposal.
			const existing = await this.prisma.personalConfigurationChange.findFirst({ where: { id: command.changeId, siloId: command.siloId, userId: command.userId }, select: { state: true } });
			return existing === null ? { status: PersonalConfigurationDecisionCodes.NotFoundOrNotOwner } : { status: PersonalConfigurationDecisionCodes.AlreadyDecided };
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_configuration.decide", siloId: command.siloId, changeId: command.changeId }, "Personal configuration decision persistence failed");
			return { status: PersonalConfigurationDecisionCodes.PersistenceUnavailable };
		}
	}
}
