import { PersonaColour, PersonaRevisionState, type Prisma, type PrismaClient } from "@prisma/client";

import { PersonaWorkflowColours, type PersonaWorkflowApprovedBootstrapEvidence, type PersonaWorkflowApprovedEvidence, type PersonaWorkflowEvidenceRepository, type PersonaWorkflowOwner } from "./persona-workflow-evidence.types.js";

/** Builds the persona workflow evidence reader over a Prisma client. */
export function _CreatePersonaWorkflowEvidenceRepository(prisma: PrismaClient): PersonaWorkflowEvidenceRepository
{
	return new PrismaPersonaWorkflowEvidenceRepository(prisma);
}

/** Prisma adapter whose every query is filtered to the given owner's silo and subject. */
export class PrismaPersonaWorkflowEvidenceRepository implements PersonaWorkflowEvidenceRepository
{
	/** Prisma client for the product database. */
	private readonly prisma: Prisma.TransactionClient;

	/** Stores the Prisma client that every read below uses. */
	constructor(prisma: Prisma.TransactionClient)
	{
		this.prisma = prisma;
	}

	/** @inheritdoc */
	async ownsInterview(owner: PersonaWorkflowOwner, interviewId: string): Promise<boolean>
	{
		const interview = await this.prisma.personaInterview.findFirst({ where: { id: interviewId, userId: owner.subjectId, profile: { siloId: owner.siloId, userId: owner.subjectId } }, select: { id: true } });
		return interview !== null;
	}

	/** @inheritdoc */
	async readApprovedPersona(owner: PersonaWorkflowOwner, evidence: PersonaWorkflowApprovedEvidence): Promise<PersonaWorkflowApprovedEvidence | null>
	{
		const revision = await this.prisma.personaRevision.findFirst({ where: { id: evidence.personaRevisionId, interviewId: evidence.interviewId, state: PersonaRevisionState.Approved, profile: { siloId: owner.siloId, userId: owner.subjectId } }, select: { id: true, interviewId: true } });
		return revision === null ? null : { interviewId: revision.interviewId, personaRevisionId: revision.id };
	}

	/** @inheritdoc */
	async readLatestApprovedPersona(owner: PersonaWorkflowOwner, interviewId: string): Promise<PersonaWorkflowApprovedEvidence | null>
	{
		const revision = await this.prisma.personaRevision.findFirst({ where: { interviewId, state: PersonaRevisionState.Approved, profile: { siloId: owner.siloId, userId: owner.subjectId } }, orderBy: [{ approvedAt: "desc" }, { revision: "desc" }], select: { id: true, interviewId: true } });
		return revision === null ? null : { interviewId: revision.interviewId, personaRevisionId: revision.id };
	}

	/** @inheritdoc */
	async readApprovedBootstrapEvidence(owner: PersonaWorkflowOwner, personaRevisionId: string): Promise<PersonaWorkflowApprovedBootstrapEvidence | null>
	{
		const revision = await this.prisma.personaRevision.findFirst({ where: { id: personaRevisionId, state: PersonaRevisionState.Approved, profile: { siloId: owner.siloId, userId: owner.subjectId } }, select: { id: true, primaryColour: true, soulTemplate: { select: { displayName: true } } } });
		return revision === null ? null : { personaRevisionId: revision.id, displayName: revision.soulTemplate.displayName, primaryColour: _WorkflowColour(revision.primaryColour) };
	}
}

/** Converts a Prisma colour into the workflow colour this package exposes. */
function _WorkflowColour(colour: PersonaColour): PersonaWorkflowColours
{
	const colours: Record<PersonaColour, PersonaWorkflowColours> = { [PersonaColour.Red]: PersonaWorkflowColours.Red, [PersonaColour.Yellow]: PersonaWorkflowColours.Yellow, [PersonaColour.Green]: PersonaWorkflowColours.Green, [PersonaColour.Blue]: PersonaWorkflowColours.Blue };
	return colours[colour];
}
