import { Prisma, type PrismaClient } from "@prisma/client";

import type { RunInputSnapshot } from "@opencrane/contracts";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/backend/observability";

import { PrismaPersonalConfigurationProposalRepository } from "../proposal/prisma-personal-configuration-proposal-repository";
import { PersonalConfigurationProposalCodes, type ProposePersonalConfigurationChangeResult } from "../proposal/personal-configuration-proposal.types";
import { PrismaUpgradeSessionProfileRepository } from "./prisma-upgrade-session-profile-repository";
import { _ProposeUpgradeSession, _RequirePersonalUpgradeSessionCandidate, _RequirePersonalUpgradeSessionSnapshot } from "./upgrade-session-proposal";
import type { UpgradeSessionProposalUnitOfWork } from "./upgrade-session-proposal-unit-of-work.types";
import type { PersonalUpgradeSessionCandidate, PersonalUpgradeSessionSnapshot, UpgradeSessionInvocation, UpgradeSessionProposalReceipt } from "./upgrade-session.types";

/** Prisma transaction owner for one provenance-bound runtime upgrade-session proposal. */
export class PrismaUpgradeSessionProposalUnitOfWork implements UpgradeSessionProposalUnitOfWork
{
	/** Canonical product-authority database client. */
	private readonly prisma: PrismaClient;
	/** Redacted structured logger for unexpected proposal persistence failures. */
	private readonly logger: Logger;

	/** Creates the upgrade-session proposal transaction owner. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-configuration"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Validate runtime evidence, resolve its owner profile, and insert one immutable proposal atomically. */
	async proposeUpgradeSession(candidate: UpgradeSessionInvocation, snapshot: RunInputSnapshot, now: string): Promise<UpgradeSessionProposalReceipt>
	{
		// 1. Reject invalid runtime evidence before opening a database transaction.
		_RequirePersonalUpgradeSessionSnapshot(snapshot);
		_RequirePersonalUpgradeSessionCandidate(candidate);

		// 2. Resolve the profile and insert the proposal under one traced transaction snapshot.
		const result = await this.persist(candidate, snapshot, now);

		// 3. Preserve the runtime-facing profile, denial, and receipt outcomes after commit.
		return _resolveProposal(result);
	}

	/** Run the upgrade-session transaction under the stable proposal trace and denial mapping. */
	private async persist(candidate: PersonalUpgradeSessionCandidate, snapshot: PersonalUpgradeSessionSnapshot, now: string): Promise<ProposePersonalConfigurationChangeResult | null>
	{
		const unitOfWork = this;
		try
		{
			return await ___DoWithTrace("personal_configuration.propose", { siloId: snapshot.siloId, userId: snapshot.identitySnapshot.executionSubjectId, sourceRunId: snapshot.runId }, async function _TraceProposal()
			{
				return unitOfWork.runTransaction(candidate, snapshot, now);
			});
		}
		catch (error)
		{
			throw _proposalDenied(_persistenceDenialReason(error));
		}
	}

	/** Construct both repositories from one transaction and keep failures inside the active trace. */
	private async runTransaction(candidate: PersonalUpgradeSessionCandidate, snapshot: PersonalUpgradeSessionSnapshot, now: string): Promise<ProposePersonalConfigurationChangeResult | null>
	{
		try
		{
			return await this.prisma.$transaction(async function _RunProposalTransaction(transaction)
			{
				const profiles = new PrismaUpgradeSessionProfileRepository(transaction);
				const proposals = new PrismaPersonalConfigurationProposalRepository(transaction);
				return _ProposeUpgradeSession(profiles, proposals, candidate, snapshot, now);
			});
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_configuration.propose", siloId: snapshot.siloId, sourceRunId: snapshot.runId }, "Personal configuration proposal persistence failed");
			throw error;
		}
	}
}

/** Maps the database trigger fence and all other persistence failures to stable denial reasons. */
function _persistenceDenialReason(error: unknown): PersonalConfigurationProposalCodes
{
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P0001"
		? PersonalConfigurationProposalCodes.ProvenanceConflict
		: PersonalConfigurationProposalCodes.PersistenceUnavailable;
}

/** Creates the unchanged runtime-facing denial error without exposing database details. */
function _proposalDenied(reason: PersonalConfigurationProposalCodes): Error
{
	return new Error(`upgrade_session proposal denied: ${reason}`);
}

/** Resolves the committed transaction outcome into the unchanged runtime-facing contract. */
function _resolveProposal(result: ProposePersonalConfigurationChangeResult | null): UpgradeSessionProposalReceipt
{
	if (result === null) throw new Error("upgrade_session personal profile is unavailable");
	if (result.outcome !== PersonalConfigurationProposalCodes.Proposed) throw _proposalDenied(result.reason);
	return _receipt(result.changeId);
}

/** Initializes the durable tool receipt returned after a successful transaction commit. */
function _receipt(changeId: string): UpgradeSessionProposalReceipt
{
	const receipt: UpgradeSessionProposalReceipt = { changeId };
	return receipt;
}
