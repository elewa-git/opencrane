import { PreferenceFactConsentState, PreferenceFactProvenanceKind, PreferenceFactSensitivity, PreferenceFactState, Prisma, type PrismaClient } from "@prisma/client";
import { ___CanonicalizeJson, type JsonValue } from "@opencrane/util";
import { ___CreateLogger, ___DoWithTrace, type Logger } from "@opencrane/observability";

import type { AcceptPreferenceFactCommand, AtomicAcceptPreferenceFactResult, AtomicForgetPreferenceFactResult, AtomicRecordPreferenceFactResult, ForgetPreferenceFactCommand, PreferenceFactRepository, RecordPreferenceFactCommand } from "./preference-fact-authority.types.js";

/** Prisma authority for owner-scoped preference recording, correction, and forgetting. */
export class PrismaPreferenceFactRepository implements PreferenceFactRepository
{
	/** Canonical OpenCrane product database. */
	private readonly prisma: PrismaClient;
	/** Redacted structured failure logger for this persistence seam. */
	private readonly logger: Logger;

	/** Creates the preference authority over canonical Postgres. */
	constructor(prisma: PrismaClient, logger: Logger = ___CreateLogger("personal-preferences"))
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Records one idempotent fact while the profile lock and baseline trigger fence the correction chain. */
	async recordAtomically(command: RecordPreferenceFactCommand): Promise<AtomicRecordPreferenceFactResult>
	{
		const prisma = this.prisma;
		try
		{
			return await ___DoWithTrace("personal_preferences.record", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId }, async function _traceRecord()
			{
				return prisma.$transaction(async function _record(transaction)
				{
				// 1. Lock the exact owner profile before any same-owner correction can advance.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "profile_unavailable" } as const;

				// 2. Reuse a prior successful delivery before attempting an immutable insert.
				const existing = await transaction.preferenceFact.findUnique({ where: { siloId_userId_idempotencyKey: { siloId: command.siloId, userId: command.userId, idempotencyKey: command.idempotencyKey } }, select: { id: true, personaProfileId: true, preferenceKey: true, statement: true, state: true, consentState: true, provenanceKind: true, provenance: true, confidence: true, sensitivity: true, sourceMessageId: true, sourceInterviewId: true, supersedesFactId: true, recordedBy: true, acceptedBy: true } });
				if (existing !== null) return _matchesIdempotentCommand(existing, command) ? { status: "idempotent", preferenceFactId: existing.id } as const : { status: "correction_conflict" } as const;

				// 3. Insert the new immutable statement; the database validates source ownership and correction lineage.
				const fact = await transaction.preferenceFact.create({ data: { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, preferenceKey: command.preferenceKey, statement: command.statement.trim(), state: command.state === "accepted" ? PreferenceFactState.Accepted : PreferenceFactState.Candidate, consentState: _consent(command.consentState), provenanceKind: _provenanceKind(command.provenance.kind), provenance: command.provenance.detail as Prisma.InputJsonValue, confidence: command.confidence, sensitivity: command.sensitivity === "sensitive" ? PreferenceFactSensitivity.Sensitive : PreferenceFactSensitivity.Ordinary, sourceMessageId: command.provenance.messageId, sourceInterviewId: command.provenance.interviewId, supersedesFactId: command.supersedesFactId, recordedBy: command.recordedBy, acceptedBy: command.acceptedBy, idempotencyKey: command.idempotencyKey, acceptedAt: command.state === "accepted" ? new Date() : null }, select: { id: true } });
				return { status: "recorded", preferenceFactId: fact.id } as const;
				});
			});
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_preferences.record", siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId }, "Preference fact recording persistence failed");
			return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? { status: "correction_conflict" } : { status: "persistence_unavailable" };
		}
	}

	/** Promotes one owner candidate with explicit confirmation without changing its retained provenance. */
	async acceptAtomically(command: AcceptPreferenceFactCommand): Promise<AtomicAcceptPreferenceFactResult>
	{
		const prisma = this.prisma;
		try
		{
			return await ___DoWithTrace("personal_preferences.accept", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, preferenceFactId: command.preferenceFactId }, async function _traceAccept()
			{
				return prisma.$transaction(async function _accept(transaction)
				{
				// 1. Lock the profile so concurrent correction, forget, and acceptance decisions serialize.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "preference_unavailable" } as const;

				// 2. Promote only the exact in-progress candidate; the database rejects an invalid reactivation.
				const updated = await transaction.preferenceFact.updateMany({ where: { id: command.preferenceFactId, siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, state: PreferenceFactState.Candidate }, data: { state: PreferenceFactState.Accepted, consentState: _consent(command.consentState), acceptedBy: command.acceptedBy, acceptedAt: new Date(command.acceptedAt) } });
				return updated.count === 1 ? { status: "accepted" } as const : { status: "preference_unavailable" } as const;
				});
			});
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_preferences.accept", siloId: command.siloId, userId: command.userId, preferenceFactId: command.preferenceFactId }, "Preference fact acceptance persistence failed");
			return { status: "persistence_unavailable" };
		}
	}

	/** Explicitly forgets one current owner fact without deleting its retained prompt evidence. */
	async forgetAtomically(command: ForgetPreferenceFactCommand): Promise<AtomicForgetPreferenceFactResult>
	{
		const prisma = this.prisma;
		try
		{
			return await ___DoWithTrace("personal_preferences.forget", { siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, preferenceFactId: command.preferenceFactId }, async function _traceForget()
			{
				return prisma.$transaction(async function _forget(transaction)
				{
				// 1. Lock the profile to serialize owner actions against a concurrent correction or admission.
				const profiles = await transaction.$queryRaw<readonly { readonly id: string }[]>(Prisma.sql`SELECT "id" FROM "persona_profiles" WHERE "id" = ${command.personaProfileId} AND "silo_id" = ${command.siloId} AND "user_id" = ${command.userId} FOR UPDATE`);
				if (profiles.length !== 1) return { status: "preference_unavailable" } as const;

				// 2. Transition only a current candidate or accepted fact; history remains available to old snapshots.
				const updated = await transaction.preferenceFact.updateMany({ where: { id: command.preferenceFactId, siloId: command.siloId, userId: command.userId, personaProfileId: command.personaProfileId, state: { in: [PreferenceFactState.Candidate, PreferenceFactState.Accepted] } }, data: { state: PreferenceFactState.Forgotten, forgottenAt: new Date(command.forgottenAt) } });
				return updated.count === 1 ? { status: "forgotten" } as const : { status: "preference_unavailable" } as const;
				});
			});
		}
		catch (error)
		{
			this.logger.error({ err: error, operation: "personal_preferences.forget", siloId: command.siloId, userId: command.userId, preferenceFactId: command.preferenceFactId }, "Preference fact forget persistence failed");
			return { status: "persistence_unavailable" };
		}
	}
}

/** Maps the public consent vocabulary to the generated Prisma enum. */
function _consent(value: RecordPreferenceFactCommand["consentState"]): PreferenceFactConsentState
{
	return value === "explicit" ? PreferenceFactConsentState.Explicit : value === "confirmed" ? PreferenceFactConsentState.Confirmed : PreferenceFactConsentState.Pending;
}

/** Maps the public provenance vocabulary to the generated Prisma enum. */
function _provenanceKind(value: RecordPreferenceFactCommand["provenance"]["kind"]): PreferenceFactProvenanceKind
{
	return value === "explicit_statement" ? PreferenceFactProvenanceKind.ExplicitStatement : value === "conversation_message" ? PreferenceFactProvenanceKind.ConversationMessage : value === "interview" ? PreferenceFactProvenanceKind.Interview : PreferenceFactProvenanceKind.Inferred;
}

/** Returns whether a retried idempotency key carries precisely the same durable preference request. */
function _matchesIdempotentCommand(existing: { readonly personaProfileId: string; readonly preferenceKey: string; readonly statement: string; readonly state: PreferenceFactState; readonly consentState: PreferenceFactConsentState; readonly provenanceKind: PreferenceFactProvenanceKind; readonly provenance: Prisma.JsonValue; readonly confidence: Prisma.Decimal; readonly sensitivity: PreferenceFactSensitivity; readonly sourceMessageId: string | null; readonly sourceInterviewId: string | null; readonly supersedesFactId: string | null; readonly recordedBy: string; readonly acceptedBy: string | null }, command: RecordPreferenceFactCommand): boolean
{
	return existing.personaProfileId === command.personaProfileId && existing.preferenceKey === command.preferenceKey && existing.statement === command.statement.trim() && existing.state === (command.state === "accepted" ? PreferenceFactState.Accepted : PreferenceFactState.Candidate) && existing.consentState === _consent(command.consentState) && existing.provenanceKind === _provenanceKind(command.provenance.kind) && ___CanonicalizeJson(existing.provenance as unknown as JsonValue) === ___CanonicalizeJson(command.provenance.detail as unknown as JsonValue) && Number(existing.confidence) === command.confidence && existing.sensitivity === (command.sensitivity === "sensitive" ? PreferenceFactSensitivity.Sensitive : PreferenceFactSensitivity.Ordinary) && existing.sourceMessageId === command.provenance.messageId && existing.sourceInterviewId === command.provenance.interviewId && existing.supersedesFactId === command.supersedesFactId && existing.recordedBy === command.recordedBy && existing.acceptedBy === command.acceptedBy;
}
