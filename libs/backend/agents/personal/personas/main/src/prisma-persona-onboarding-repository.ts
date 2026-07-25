import { PersonaQuestionSetState, Prisma, type PrismaClient } from "@prisma/client";

import { ___DoWithTrace } from "@opencrane/observability";
import type { Logger } from "@opencrane/observability";

import { PERSONA_ONBOARDING_QUESTION_SET_ID, PERSONA_ONBOARDING_QUESTION_SET_VERSION, PERSONA_ONBOARDING_QUESTIONS, PERSONA_ONBOARDING_SOUL_TEMPLATES } from "./persona-onboarding-catalogue.js";
import type { EnsurePersonaOnboardingCommand, EnsurePersonaOnboardingResult, PersonaOnboardingRepository } from "./persona-onboarding-authority.types.js";

/** Prisma authority that provisions only the product-owned onboarding source and caller's profile. */
export class PrismaPersonaOnboardingRepository implements PersonaOnboardingRepository
{
	/** Canonical per-silo product database. */
	private readonly prisma: PrismaClient;
	/** App-owned structured logger for handled provisioning failures. */
	private readonly logger: Logger;

	/** Create the onboarding provisioning authority over the canonical product database. */
	constructor(prisma: PrismaClient, logger: Logger)
	{
		this.prisma = prisma;
		this.logger = logger;
	}

	/** Serialize product-source provisioning and create the authenticated owner's profile exactly once. */
	async ensureAtomically(command: EnsurePersonaOnboardingCommand): Promise<EnsurePersonaOnboardingResult>
	{
		const prisma = this.prisma;
		const logger = this.logger;
		try
		{
			return await ___DoWithTrace("persona.onboarding.provision", { siloId: command.siloId }, async function _provision()
			{
				try
				{
					return await prisma.$transaction(async function _ensure(transaction)
					{
						await transaction.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('opencrane:persona-onboarding-catalogue:v1'))`);
						const catalogue = await _ensureCatalogue(transaction, command.provisionedAt);
						if (catalogue === "conflict") return { outcome: "denied", reason: "catalogue_conflict" } as const;
						const profile = await transaction.personaProfile.upsert({ where: { siloId_userId: { siloId: command.siloId, userId: command.userId } }, create: { siloId: command.siloId, userId: command.userId, createdAt: new Date(command.provisionedAt), updatedAt: new Date(command.provisionedAt) }, update: {}, select: { id: true } });
						return { outcome: "ready", personaProfileId: profile.id, questionSet: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } } as const;
					});
				}
				catch (err)
				{
					logger.error({ err, siloId: command.siloId }, "Persona onboarding provisioning is unavailable");
					throw err;
				}
			});
		}
		catch
		{
			return { outcome: "denied", reason: "persistence_unavailable" };
		}
	}
}

/** Create the initial reviewed sources once, or reject an unexpected source occupying their immutable identity. */
async function _ensureCatalogue(transaction: Prisma.TransactionClient, provisionedAt: string): Promise<"ready" | "conflict">
{
	const existing = await transaction.personaQuestionSet.findUnique({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, select: { state: true } });
	if (existing !== null && existing.state !== PersonaQuestionSetState.Reviewed) return "conflict";
	if (existing !== null && !await _matchesQuestions(transaction)) return "conflict";
	const existingTemplates = await Promise.all(PERSONA_ONBOARDING_SOUL_TEMPLATES.map(async function _load(template)
	{
		return { template, source: await transaction.personaSoulTemplate.findUnique({ where: { id_version: { id: template.id, version: template.version } }, select: { digest: true, content: true, selectionRules: true } }) };
	}));
	if (existingTemplates.some(function _conflicts(item) { return item.source !== null && !_sameTemplateSource(item.source, item.template); })) return "conflict";
	if (existing === null)
	{
		await transaction.personaQuestionSet.create({ data: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION, createdAt: new Date(provisionedAt) } });
		await transaction.personaQuestion.createMany({ data: PERSONA_ONBOARDING_QUESTIONS.map(function _question(question) { return { questionSetId: PERSONA_ONBOARDING_QUESTION_SET_ID, questionSetVersion: PERSONA_ONBOARDING_QUESTION_SET_VERSION, ...question }; }) });
		await transaction.personaQuestionSet.update({ where: { id_version: { id: PERSONA_ONBOARDING_QUESTION_SET_ID, version: PERSONA_ONBOARDING_QUESTION_SET_VERSION } }, data: { state: PersonaQuestionSetState.Reviewed, reviewedBy: "opencrane-product", reviewedAt: new Date(provisionedAt) } });
	}
	for (const item of existingTemplates)
	{
		if (item.source === null) await transaction.personaSoulTemplate.create({ data: { id: item.template.id, version: item.template.version, digest: item.template.digest, content: item.template.content, selectionRules: item.template.selectionRules, reviewedBy: "opencrane-product", reviewedAt: new Date(provisionedAt), createdAt: new Date(provisionedAt) } });
	}
	return "ready";
}

/** Compare every immutable template coordinate that can change deterministic answer selection. */
function _sameTemplateSource(source: { readonly digest: string; readonly content: string; readonly selectionRules: Prisma.JsonValue }, template: (typeof PERSONA_ONBOARDING_SOUL_TEMPLATES)[number]): boolean
{
	return source.digest === template.digest && source.content === template.content && _canonicalJson(source.selectionRules) === _canonicalJson(template.selectionRules);
}

/** Produce stable JSON for source equality without trusting object-key insertion order from a database driver. */
function _canonicalJson(value: unknown): string
{
	if (Array.isArray(value)) return `[${value.map(function _render(item) { return _canonicalJson(item); }).join(",")}]`;
	if (value !== null && typeof value === "object")
	{
		const entries = Object.entries(value).sort(function _byKey(left, right) { return left[0].localeCompare(right[0]); });
		return `{${entries.map(function _render(entry) { return `${JSON.stringify(entry[0])}:${_canonicalJson(entry[1])}`; }).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Confirm that an already-reviewed source has the exact product-owned question IDs, categories, prompts, and order. */
async function _matchesQuestions(transaction: Prisma.TransactionClient): Promise<boolean>
{
	const questions = await transaction.personaQuestion.findMany({ where: { questionSetId: PERSONA_ONBOARDING_QUESTION_SET_ID, questionSetVersion: PERSONA_ONBOARDING_QUESTION_SET_VERSION }, select: { id: true, category: true, prompt: true, ordinal: true }, orderBy: { ordinal: "asc" } });
	return questions.length === PERSONA_ONBOARDING_QUESTIONS.length && questions.every(function _matches(question, index)
	{
		const expected = PERSONA_ONBOARDING_QUESTIONS[index];
		return expected !== undefined && question.id === expected.id && question.category === expected.category && question.prompt === expected.prompt && question.ordinal === expected.ordinal;
	});
}
