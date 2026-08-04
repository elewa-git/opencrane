import { PersonaInterviewState, PersonaRevisionState, type Prisma } from "@prisma/client";

import { PersonaAggregateInterviewStates, type PersonaAggregateReadRepository, type PersonaDraftRevisionReadCommand, type PersonaDraftRevisionRecord, type PersonaInterviewReadCommand, type PersonaInterviewRecord, type PersonaProfileOwnerReadCommand, type PersonaProfileReadCommand, type PersonaProfileRecord } from "./persona-aggregate-read-repository.types.js";

/**
 * Owns every persona-aggregate evidence read and latest-revision read used by lifecycle authorities.
 *
 * The repository takes no row locks. Callers run each read inside a Serializable transaction, so a
 * concurrent writer that invalidates the read aborts with a serialization or unique-key failure
 * (P2034/P2002) that the owning authority reports as its explicit conflict outcome.
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

	/** Read one owner interview so answer and completion transitions share the same evidence view. */
	async readInterview(command: PersonaInterviewReadCommand): Promise<PersonaInterviewRecord | null>
	{
		const interview = await this.transaction.personaInterview.findFirst({ where: { id: command.interviewId, personaProfileId: command.personaProfileId, userId: command.userId }, select: { questionSetId: true, questionSetVersion: true, state: true } });
		return interview === null ? null : { ...interview, state: _InterviewState(interview.state) };
	}

	/** Read a completed owner interview before deriving its immutable template and insight evidence. */
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

	/** Read the next profile-local revision; the unique profile-revision key backstops concurrent allocation. */
	async readNextRevision(personaProfileId: string): Promise<number>
	{
		const latest = await this.transaction.personaRevision.findFirst({ where: { personaProfileId }, select: { revision: true }, orderBy: { revision: "desc" } });
		return (latest?.revision ?? 0) + 1;
	}
}

/** Map Prisma's generated lifecycle state into the repository-owned contract. */
function _InterviewState(state: PersonaInterviewState): PersonaAggregateInterviewStates
{
	return state === PersonaInterviewState.Completed ? PersonaAggregateInterviewStates.Completed : PersonaAggregateInterviewStates.InProgress;
}
