import type { PrismaClient } from "@prisma/client";

import { ___CreateLogger, type Logger } from "@opencrane/observability";

import type { MaterializePersonalConfigurationChangeCommand, PersonalConfigurationChangeMaterializationRepository, PersonalConfigurationMaterializationPersistenceResult } from "../personal-configuration-materialization.types.js";
import { _MaterializePersonalConfigurationWithinTransaction } from "./prisma-personal-configuration-materialization.js";

/** Prisma adapter that applies accepted personal model selections without owning proposal journaling. */
export class _PrismaPersonalConfigurationMaterializer implements PersonalConfigurationChangeMaterializationRepository
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Redacted structured failure logger for the materialization transaction. */
	private readonly logger: Logger;

	/**
	 * Creates the dedicated materialization adapter.
	 * @param prisma - Canonical product-authority database client.
	 * @param logger - Structured logger supplied by the composition root.
	 */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/**
	 * Applies one accepted proposal through a documented, retry-safe transaction.
	 *
	 * The transaction coordinator owns lock ordering and proposal state. Agent-services owns
	 * revision persistence, while this adapter owns activation plus the configuration-journal
	 * transition. Any exception rolls the complete procedure back.
	 */
	async materializeAtomically(command: MaterializePersonalConfigurationChangeCommand): Promise<PersonalConfigurationMaterializationPersistenceResult>
	{
		try
		{
			return await this.prisma.$transaction(async function _Materialize(transaction)
			{
				return _MaterializePersonalConfigurationWithinTransaction(transaction, command);
			});
		}
		catch (err)
		{
			this.logger.error({
				err,
				operation: "personal_configuration.materialize",
				siloId: command.siloId,
				changeId: command.changeId,
			}, "Personal configuration materialization failed");
			return { status: "persistence_unavailable" };
		}
	}
}
