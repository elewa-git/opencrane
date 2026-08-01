import { Prisma } from "@prisma/client";

import type { PersonaAggregateLockRepository, PersonaDraftRevisionLock, PersonaDraftRevisionLockCommand, PersonaInterviewLock, PersonaInterviewLockCommand, PersonaProfileLock, PersonaProfileLockCommand, PersonaProfileOwnerLockCommand } from "./persona-aggregate-lock-repository.types.js";

/** Owns every persona-aggregate row lock and latest-revision read used by lifecycle authorities. */
export class PrismaPersonaAggregateLockRepository implements PersonaAggregateLockRepository
{
	/** Lock one owner profile before a dependent interview, draft, or approval mutation. */
	async lockProfile(client: Prisma.TransactionClient, command: PersonaProfileLockCommand): Promise<PersonaProfileLock | null>
	{
		const rows = await client.$queryRaw<readonly { readonly siloId: string; readonly activeRevisionId: string | null }[]>(Prisma.sql`SELECT "silo_id" AS "siloId", "active_revision_id" AS "activeRevisionId" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
		return rows[0] ?? null;
	}

	/** Lock one owner profile when approval must recover the silo for its bound refresh proposal. */
	async lockProfileForOwner(client: Prisma.TransactionClient, command: PersonaProfileOwnerLockCommand): Promise<PersonaProfileLock | null>
	{
		const rows = await client.$queryRaw<readonly { readonly siloId: string; readonly activeRevisionId: string | null }[]>(Prisma.sql`SELECT "silo_id" AS "siloId", "active_revision_id" AS "activeRevisionId" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
		return rows[0] ?? null;
	}

	/** Lock one owner interview so answer and completion transitions share the same mutation fence. */
	async lockInterview(client: Prisma.TransactionClient, command: PersonaInterviewLockCommand): Promise<PersonaInterviewLock | null>
	{
		const rows = await client.$queryRaw<readonly PersonaInterviewLock[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion", "state" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} FOR UPDATE`);
		return rows[0] ?? null;
	}

	/** Lock a completed owner interview before deriving its immutable template and insight evidence. */
	async lockCompletedInterview(client: Prisma.TransactionClient, command: PersonaInterviewLockCommand): Promise<PersonaInterviewLock | null>
	{
		const rows = await client.$queryRaw<readonly PersonaInterviewLock[]>(Prisma.sql`SELECT "question_set_id" AS "questionSetId", "question_set_version" AS "questionSetVersion", "state" FROM "persona_interviews" WHERE "id" = ${command.interviewId} AND "persona_profile_id" = ${command.personaProfileId} AND "user_id" = ${command.userId} AND "state" = 'completed' FOR UPDATE`);
		return rows[0] ?? null;
	}

	/** Lock one still-draft revision before changing its state or active profile pointer. */
	async lockDraftRevision(client: Prisma.TransactionClient, command: PersonaDraftRevisionLockCommand): Promise<PersonaDraftRevisionLock | null>
	{
		const rows = await client.$queryRaw<readonly PersonaDraftRevisionLock[]>(Prisma.sql`SELECT "interview_id" AS "interviewId" FROM "persona_revisions" WHERE "id" = ${command.personaRevisionId} AND "persona_profile_id" = ${command.personaProfileId} AND "state" = 'draft' FOR UPDATE`);
		return rows[0] ?? null;
	}

	/** Read the next profile-local revision while the caller holds its profile lock. */
	async readNextRevision(client: Prisma.TransactionClient, personaProfileId: string): Promise<number>
	{
		const latest = await client.personaRevision.findFirst({ where: { personaProfileId }, select: { revision: true }, orderBy: { revision: "desc" } });
		return (latest?.revision ?? 0) + 1;
	}
}
