import { Prisma, type PrismaClient } from "@prisma/client";

import type { Logger } from "@opencrane/backend/observability";

import { PersonaApprovalTransactionConflict, PrismaPersonaAuthorityRepository } from "../approval/prisma-persona-authority-repository.js";
import { PersonaApprovalPersistenceStatuses, type ApprovePersonaCommand, type AtomicApprovePersonaCommand, type AtomicApprovePersonaResult, type PersonaApprovalSnapshot } from "../approval/persona-authority.types.js";
import { PersonaDraftDenialReasons, type CreatePersonaDraftCommand, type CreatePersonaDraftPersistenceResult } from "../drafting/persona-draft-authority.types.js";
import { PrismaPersonaDraftRepository } from "../drafting/prisma-persona-draft-repository.js";
import { PrismaPersonaInterviewRepository } from "../interview/prisma-persona-interview-repository.js";
import type { CompletePersonaInterviewCommand, PersonaInterviewQuestionReader, RecordPersonaInterviewAnswerCommand, ResolvePersonaInterviewTieCommand, StartPersonaInterviewCommand } from "../interview/persona-interview-authority.types.js";
import { _DoPersonaPersistenceWithTrace } from "../persona-persistence-observability.js";
import { PersonaInterviewDenialReasons, PersonaLifecycleOutcomes } from "./persona-lifecycle.types.js";
import { PersonaOnboardingDenialReasons, type EnsurePersonaOnboardingCommand, type EnsurePersonaOnboardingResult } from "./persona-onboarding-authority.types.js";
import type { PersonaOnboardingStatus } from "./persona-onboarding-status.types.js";
import type { PersonaPersistenceUnitOfWork } from "./persona-persistence-unit-of-work.types.js";
import { PrismaPersonaOnboardingRepository } from "./prisma-persona-onboarding-repository.js";
import { PrismaPersonaOnboardingStatusRepository } from "./prisma-persona-onboarding-status-repository.js";

/** Runs each persona operation in its own Serializable Prisma transaction. */
export class PrismaPersonaPersistenceUnitOfWork implements PersonaPersistenceUnitOfWork
{
	/** Prisma client for the product database. */
	private readonly prisma: PrismaClient;
	/** Logger used when a persistence failure is turned into a denial. */
	private readonly logger: Logger;

	/** Creates the transaction boundary over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger)
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Verify the reviewed baseline source and create the authenticated owner's profile exactly once. */
	async ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.onboarding.provision", { siloId: command.siloId }, "Persona onboarding provisioning is unavailable", () => this._runOnboarding(async function _Ensure(repository)
			{
				return repository.ensureAtomically(command);
			}));
		}
		catch
		{
			return { outcome: PersonaLifecycleOutcomes.Denied, reason: PersonaOnboardingDenialReasons.PersistenceUnavailable };
		}
	}

	/** Read only the exact question-set revision frozen into one owner interview. */
	async getQuestions(interviewId: string, personaProfileId: string, userId: string): ReturnType<PersonaInterviewQuestionReader["getQuestions"]>
	{
		return this._runInterview(async function _Questions(repository)
		{
			return repository.getQuestions(interviewId, personaProfileId, userId);
		});
	}

	/** Start one reviewed interview in one serializable persona/configuration transaction. */
	async startAtomically(command: StartPersonaInterviewCommand): ReturnType<PrismaPersonaInterviewRepository["startAtomically"]>
	{
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.start", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId }, "Persona interview start persistence failed", () => this._runInterview(async function _Start(repository)
			{
				return repository.startAtomically(command);
			}), _IsInterviewConflict);
		}
		catch (error)
		{
			return { status: _IsInterviewConflict(error) ? PersonaInterviewDenialReasons.Conflict : PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}

	/** Append one answer in one serializable persona transaction. */
	async recordAnswerAtomically(command: RecordPersonaInterviewAnswerCommand): ReturnType<PrismaPersonaInterviewRepository["recordAnswerAtomically"]>
	{
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.answer", { userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona interview answer persistence failed", () => this._runInterview(async function _Answer(repository)
			{
				return repository.recordAnswerAtomically(command);
			}), _IsInterviewConflict);
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: PersonaInterviewDenialReasons.AlreadyAnswered };
			return { status: _IsInterviewConflict(error) ? PersonaInterviewDenialReasons.Conflict : PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}

	/** Complete one fully answered interview in one serializable persona transaction. */
	async completeAtomically(command: CompletePersonaInterviewCommand): ReturnType<PrismaPersonaInterviewRepository["completeAtomically"]>
	{
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.complete", { userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona interview completion persistence failed", () => this._runInterview(async function _Complete(repository)
			{
				return repository.completeAtomically(command);
			}), _IsInterviewConflict);
		}
		catch (error)
		{
			return { status: _IsInterviewConflict(error) ? PersonaInterviewDenialReasons.Conflict : PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}

	/** Append one exact tie resolution inside the serializable persona transaction. */
	async resolveTieAtomically(command: ResolvePersonaInterviewTieCommand): ReturnType<PrismaPersonaInterviewRepository["resolveTieAtomically"]>
	{
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.interview.resolve_tie", { userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona tie resolution persistence failed", () => this._runInterview(async function _Resolve(repository)
			{
				return repository.resolveTieAtomically(command);
			}), _IsInterviewConflict);
		}
		catch (error)
		{
			if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: PersonaInterviewDenialReasons.AlreadyResolved };
			return { status: _IsInterviewConflict(error) ? PersonaInterviewDenialReasons.Conflict : PersonaInterviewDenialReasons.PersistenceUnavailable };
		}
	}

	/** Derive and persist one reviewable draft in one serializable persona transaction. */
	async createFromInterviewAtomically(command: CreatePersonaDraftCommand): Promise<CreatePersonaDraftPersistenceResult>
	{
		try
		{
			return await _DoPersonaPersistenceWithTrace(this.logger, "persona.draft.create", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, interviewId: command.interviewId }, "Persona draft persistence failed", () => this._runDraft(async function _Draft(repository)
			{
				return repository.createFromInterviewAtomically(command);
			}), _IsPersonaConflict);
		}
		catch (error)
		{
			return { status: _IsPersonaConflict(error) ? PersonaDraftDenialReasons.Conflict : PersonaDraftDenialReasons.PersistenceUnavailable };
		}
	}

	/** Load one consistent approval snapshot from a serializable transaction. */
	async getApprovalSnapshot(command: ApprovePersonaCommand): Promise<PersonaApprovalSnapshot | null>
	{
		return this._runApproval(async function _ApprovalSnapshot(repository)
		{
			return repository.getApprovalSnapshot(command);
		});
	}

	/** Approve and activate one draft in one serializable persona/configuration transaction. */
	async approveAndActivateAtomically(command: AtomicApprovePersonaCommand): Promise<AtomicApprovePersonaResult>
	{
		try
		{
			return await this._runApproval(async function _Approve(repository)
			{
				return repository.approveAndActivateAtomically(command);
			});
		}
		catch (error)
		{
			if (error instanceof PersonaApprovalTransactionConflict || _IsPersonaConflict(error)) return { status: PersonaApprovalPersistenceStatuses.Conflict };
			throw error;
		}
	}

	/** Read the owner's resumable onboarding status from one transaction snapshot. */
	async readStatus(siloId: string, userId: string): Promise<PersonaOnboardingStatus>
	{
		return this._runStatus(async function _Status(repository)
		{
			return repository.readStatus(siloId, userId);
		});
	}

	/** Runs one approval operation in a Serializable transaction, giving the callback only its repository. */
	private async _runApproval<Result>(work: (repository: PrismaPersonaAuthorityRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _RunApprovalTransaction(transaction): Promise<Result>
		{
			return work(new PrismaPersonaAuthorityRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Runs one draft operation in a Serializable transaction, giving the callback only its repository. */
	private async _runDraft<Result>(work: (repository: PrismaPersonaDraftRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _RunDraftTransaction(transaction): Promise<Result>
		{
			return work(new PrismaPersonaDraftRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Runs one interview operation in a Serializable transaction, giving the callback only its repository. */
	private async _runInterview<Result>(work: (repository: PrismaPersonaInterviewRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _RunInterviewTransaction(transaction): Promise<Result>
		{
			return work(new PrismaPersonaInterviewRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Runs one onboarding operation in a Serializable transaction, giving the callback only its repository. */
	private async _runOnboarding<Result>(work: (repository: PrismaPersonaOnboardingRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _RunOnboardingTransaction(transaction): Promise<Result>
		{
			return work(new PrismaPersonaOnboardingRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}

	/** Runs one status read in a Serializable transaction, giving the callback only its repository. */
	private async _runStatus<Result>(work: (repository: PrismaPersonaOnboardingStatusRepository) => Promise<Result>): Promise<Result>
	{
		return this.prisma.$transaction(async function _RunStatusTransaction(transaction): Promise<Result>
		{
			return work(new PrismaPersonaOnboardingStatusRepository(transaction));
		}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
	}
}

/**
 * Returns whether the error is a unique-key clash (P2002) or a serialization failure (P2034) — the only
 * two errors treated as an interview conflict.
 *
 * Both codes are defined by Prisma's client error reference (Prisma 6, `PrismaClientKnownRequestError`).
 * Any other error is a real fault and must keep propagating, so widening this check would silently turn
 * a bug into a retry the owner sees as a conflict.
 */
function _IsInterviewConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
}

/**
 * Returns whether the error is a unique-key clash (P2002) or a serialization failure (P2034) — the only
 * two errors treated as a persona conflict.
 *
 * Both codes are defined by Prisma's client error reference (Prisma 6, `PrismaClientKnownRequestError`).
 * Any other error is a real fault and must keep propagating.
 */
function _IsPersonaConflict(error: unknown): boolean
{
	return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
}
