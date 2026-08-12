import { Prisma, type PrismaClient } from "@prisma/client";

import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/backend/observability";

import { PersonalConfigurationProposalCodes, type PersonalConfigurationChangeRepository, type ProposePersonalConfigurationChangeCommand } from "./personal-configuration-proposal.types.js";
import type { PersonalConfigurationProposalTransaction, PersonalConfigurationProposalUnitOfWork, PersonalConfigurationProposalWork } from "./personal-configuration-proposal-unit-of-work.types.js";
import { PrismaPersonalConfigurationProposalRepository } from "./prisma-personal-configuration-proposal-repository.js";

/** Opens the transaction each proposal insert runs in. */
export class PrismaPersonalConfigurationProposalUnitOfWork implements PersonalConfigurationProposalUnitOfWork, PersonalConfigurationChangeRepository
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Logger used for unexpected proposal failures; patch contents are never logged. */
	private readonly logger: Logger;

	/** Creates the proposal unit of work over the canonical database. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Checks the proposal's sources and inserts it in one transaction, turning any failure into a denial. */
	async proposeAtomically(command: ProposePersonalConfigurationChangeCommand): Promise<{ readonly status: PersonalConfigurationProposalCodes.Proposed; readonly changeId: string } | { readonly status: PersonalConfigurationProposalCodes.ProvenanceConflict } | { readonly status: PersonalConfigurationProposalCodes.PersistenceUnavailable }>
	{
		try
		{
			const unitOfWork = this;
			return await ___DoWithTrace("personal_configuration.propose", { siloId: command.siloId, userId: command.userId, sourceRunId: command.sourceRunId }, async function _TraceProposal()
			{
				return unitOfWork.run(async function _Propose(transaction)
				{
					return transaction.proposals.propose(command);
				});
			});
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_configuration.propose", siloId: command.siloId, sourceRunId: command.sourceRunId }, "Personal configuration proposal persistence failed");
			return _IsProvenanceConflict(error)
				? { status: PersonalConfigurationProposalCodes.ProvenanceConflict }
				: { status: PersonalConfigurationProposalCodes.PersistenceUnavailable };
		}
	}

	/** Runs the caller's work in one transaction with the proposal repository. */
	async run<Result>(work: PersonalConfigurationProposalWork<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _RunProposalTransaction(transaction): Promise<Result>
		{
			const repositories: PersonalConfigurationProposalTransaction = {
				proposals: new PrismaPersonalConfigurationProposalRepository(transaction),
			};
			return work(repositories);
		});
	}
}

/** Recognise the database's explicit business-fence rejection without exposing database details. */
function _IsProvenanceConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P0001";
}
