import { PersonaInterviewState, PersonaRevisionState, type Prisma } from "@prisma/client";

import { PersonaAggregateInterviewStates, type PersonaAggregateReadRepository, type PersonaDraftRevisionReadCommand, type PersonaDraftRevisionRecord, type PersonaInterviewReadCommand, type PersonaInterviewRecord, type PersonaProfileOwnerReadCommand, type PersonaProfileReadCommand, type PersonaProfileRecord } from "./persona-aggregate-read-repository.types";

/**
 * Reads the profile, interview, and revision rows every persona lifecycle step needs, plus the next
 * revision number.
 *
 * This class takes no row locks. Callers run each read inside a Serializable transaction, so another
 * writer that would invalidate a read makes the transaction fail instead — as a serialization error
 * (P2034) or a unique-key clash (P2002) — and the calling use case reports that as a conflict. The
 * safety comes from PostgreSQL's SERIALIZABLE isolation level, not from anything this class does, so a
 * caller that runs these reads at a weaker isolation level loses the guarantee silently.
 */
export class PrismaPersonaAggregateReadRepository implements PersonaAggregateReadRepository
{
	/** Transaction-scoped ORM client supplied only by the persona unit of work. */
	private readonly transaction: Prisma.TransactionClient;

	/** Binds all aggregate evidence reads to one serializable transaction. */
	constructor(transaction: Prisma.TransactionClient)
	{
		this.transaction = transaction;
	}

	/** Read one owner profile before a dependent interview, draft, or approval mutation. */
	async readProfile(command: PersonaProfileReadCommand): Promise<PersonaProfileRecord | null>
	{
		return this.transaction.personaProfile.findFirst({ where: { id: command.personaProfileId, siloId: command.siloId, userId: command.userId }, select: { siloId: true, activeRevisionId: true } });
	}

	/** Read one owner profile when approval must recover the silo for its bound refresh proposal. */
	async readProfileForOwner(command: PersonaProfileOwnerReadCommand): Promise<PersonaProfileRecord | null>
	{
		return this.transaction.personaProfile.findFirst({ where: { id: command.personaProfileId, userId: command.userId }, select: { siloId: true, activeRevisionId: true } });
	}

	/** Reads one owner's interview, so the answer and completion paths see the same fields. */
	async readInterview(command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId }, select: { questionSetId: true, questionSetVersion: true, state: true } });
		return interview === null ? null : { ...interview, state: _InterviewState(interview.state) };
	}

	/** Reads a completed interview before its template and insights are derived. */
	async readCompletedInterview(command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId, state: PersonaInterviewState.Completed }, select: { questionSetId: true, questionSetVersion: true, state: true } });
		return interview === null ? null : { ...interview, state: _InterviewState(interview.state) };
	}

	/** Read one still-draft revision before changing its state or active profile pointer. */
	async readDraftRevision(command: PersonaDraftRevisionReadCommand): Promise<PersonaDraftRevisionRecord | null>
	{
		return this.transaction.personaRevision.findFirst({ where: { id: command.personaRevisionId, personaProfileId: command.personaProfileId, state: PersonaRevisionState.Draft }, select: { interviewId: true } });
	}

	/** Returns the next revision number for a profile. If two callers pick the same number, the unique (profile, revision) key rejects the second insert. */
	async readNextRevision(personaProfileId: string): Promise<number>
	{
		const latest = await this.transaction.personaRevision.findFirst({ where: { personaProfileId }, select: { revision: true }, orderBy: { revision: "desc" } });
		return (latest?.revision ?? 0) + 1;
	}
}

/** Converts Prisma's interview state into this repository's enum. */
function _InterviewState(state: PersonaInterviewState): PersonaAggregateInterviewStates
{
	return state === PersonaInterviewState.Completed ? PersonaAggregateInterviewStates.Completed : PersonaAggregateInterviewStates.InProgress;
}
