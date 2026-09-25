import { randomUUID } from "node:crypto";

import { AgentRevisionState, AgentServiceKind, AgentServiceState, McpApprovalStatus, McpCredentialRequirement, McpServerRevisionState, McpServerStatus, McpServerTransport, ModelRoutingScope, OciImageValidationState, OrgMemberStatus, OrgRole, PersonaColour, PersonaInterviewCategory, PersonaInterviewState, PersonaOpennessModifier, PersonaRevisionState, PrincipalProvenance, Prisma, type PrismaClient } from "@prisma/client";

import { PrismaManagedAuthorizationGrantRepository } from "@opencrane/backend/server/iam/authorization";
import { RevisionBoundaryCoverages, RevisionBoundaryKinds, type AgentRevisionContent } from "@opencrane/models/agents";
import { AuthorizationBoundaryCoverages, AuthorizationBoundaryKinds, AuthorizationSubjectKinds, ProductAuthorizationActions, ProductAuthorizationResourceKinds, __ProductAuthorizationCapability, type ProductAuthorizationResourceLocator } from "@opencrane/models/authorization";
import { ___DigestCanonicalJson } from "@opencrane/util";

import { PrismaPersonalAgentProductEffectsAuthority } from "../../../db/prisma-personal-agent-product-effects";
import { PrismaAgentRevisionWriterRepository } from "../../../../revisions/db/prisma-agent-revision-writer";

/** Budget whose distinct limits make content-copy failures visible in PostgreSQL. */
const _BUDGET = { maxTurns: 7, maxTokens: 12_345, maxCostUsdMicros: null, maxToolInvocations: 3, maxDurationMs: 98_765, maxLoopIterations: 3 };

/** Adds managed grants through the production grant writer and installed capability catalogue. */
async function _GrantActions(transaction: Prisma.TransactionClient, siloId: string, principalId: string, resource: ProductAuthorizationResourceLocator, actions: readonly ProductAuthorizationActions[], managerId: string): Promise<void>
{
	const grants = actions.map(function _Grant(action)
	{
		const capability = __ProductAuthorizationCapability(resource.kind, action);
		if (capability === null)
			throw new Error("Personal tool SQL proof requires the installed product catalogue");
		return { subject: { kind: AuthorizationSubjectKinds.Principal, principalId }, boundary: { kind: AuthorizationBoundaryKinds.Personal, principalId }, boundaryCoverage: AuthorizationBoundaryCoverages.Exact, capability, resource, priority: 0, createdByPrincipalId: principalId } as const;
	});
	const writer = new PrismaManagedAuthorizationGrantRepository(transaction);
	await writer.reconcileManagedResourceGrants({ siloId, managerId, resource, grants, now: new Date() });
}

/** Creates a Ready tool on an Active Published credential-free OCI MCP server. */
async function _SeedTool(transaction: Prisma.TransactionClient, siloId: string, principalId: string, name: string): Promise<{ readonly serverId: string; readonly toolRevisionId: string }>
{
	const serverId = randomUUID();
	const validationId = randomUUID();
	const serverRevisionId = randomUUID();
	const toolRevisionId = randomUUID();
	const contentAddress = ___DigestCanonicalJson({ toolRevisionId });
	const registryReference = `registry.example.test/personal-tool-proof/image@${contentAddress}`;
	const now = new Date();
	await transaction.mcpServer.create({ data: { id: serverId, siloId, name: serverId, endpoint: registryReference, transport: McpServerTransport.OciImage, credentialRequirement: McpCredentialRequirement.Credentialless, status: McpServerStatus.Active, approvalStatus: McpApprovalStatus.Published } });
	await transaction.ociImageValidation.create({ data: { id: validationId, siloId, artifactId: randomUUID(), artifactRevisionId: randomUUID(), contentAddress, byteLength: 1, mediaType: "application/vnd.oci.image.layout.v1+tar", submissionKeyDigest: contentAddress, submissionDigest: contentAddress, state: OciImageValidationState.Imported, indexDigest: contentAddress, imageManifestDigest: contentAddress, configDigest: contentAddress, registryReference, createdByPrincipalId: principalId, completedAt: now } });
	await transaction.mcpServerRevision.create({ data: { id: serverRevisionId, siloId, mcpServerId: serverId, ociImageValidationId: validationId, revision: 1, registryReference } });
	const inputSchema = { type: "object", properties: {}, additionalProperties: false };
	await transaction.mcpToolRevision.create({ data: { id: toolRevisionId, siloId, serverRevisionId, name, inputSchema, inputSchemaDigest: ___DigestCanonicalJson(inputSchema) } });
	await transaction.mcpServerRevision.update({ where: { id: serverRevisionId }, data: { state: McpServerRevisionState.Ready, protocolVersion: "2026-07-28", completedAt: now } });
	await _GrantActions(transaction, siloId, principalId, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId }, [ProductAuthorizationActions.Assign], "personal-tools-sql-assign");
	return { serverId, toolRevisionId };
}

/** Creates an approved owner persona from the reviewed definitions installed by the target baseline. */
async function _SeedApprovedPersona(transaction: Prisma.TransactionClient, siloId: string, principalId: string): Promise<{ readonly personaProfileId: string; readonly personaRevisionId: string }>
{
	const personaProfileId = randomUUID();
	const personaRevisionId = randomUUID();
	const interviewId = randomUUID();
	const scoringDigest = "sha256:dd84a619e9a465cce882e63e523946502a325dd5b0dcb56fd7d33da6fd072af9";
	const templateDigest = "sha256:8cf1b0a5180d7e1176efe7ebc857c1c2775ff0b3cd8591d07a3a42dc3c936efe";
	const interpolationDigest = "sha256:3fe36e4967254849da2aa91b474510633bdc8c896a67febc24494b708a77f1d6";
	const questions = ["q1-decision-speed", "q2-response-preference", "q3-feedback-preference", "q4-meeting-energy", "q5-new-ideas", "q6-risk-appetite", "q7-suggestion-cadence", "q8-challenge-preference", "q9-relationship-model", "q10-tone-preference"];
	const answerIds = questions.map(function _AnswerId() { return randomUUID(); });
	const choiceIds = questions.map(function _ChoiceId(question, index) { return `${question}:${index === 8 ? "b" : "a"}`; });
	await transaction.personaProfile.create({ data: { id: personaProfileId, siloId, userId: principalId } });
	await transaction.personaInterview.create({ data: { id: interviewId, personaProfileId, userId: principalId, questionSetId: "personal-agent-onboarding", questionSetVersion: 1, scoringPolicyId: "personal-agent-scoring", scoringPolicyVersion: 1, interpolationMapId: "personal-agent-interpolation", interpolationMapVersion: 1 } });
	for (const [index, questionId] of questions.entries())
	{
		await transaction.personaInterviewAnswer.create({ data: { id: answerIds[index], interviewId, questionSetId: "personal-agent-onboarding", questionSetVersion: 1, questionId, choiceId: index === 8 ? "b" : "a" } });
	}
	await transaction.personaInterview.update({ where: { id: interviewId }, data: { state: PersonaInterviewState.Completed, completedAt: new Date() } });
	await transaction.personaInterviewScore.create({ data: { interviewId, scoringPolicyId: "personal-agent-scoring", scoringPolicyVersion: 1, scoringPolicyDigest: scoringDigest, orderedAnswerIds: answerIds, orderedChoiceIds: choiceIds, red: 21, yellow: 6, green: 0, blue: 5, colourTotal: 32, explorer: 7, guardian: 0, opennessTotal: 7, primaryCandidates: [PersonaColour.Red], secondaryCandidates: [PersonaColour.Yellow], modifierCandidates: [PersonaOpennessModifier.Explorer] } });
	const scoringEvidence = { orderedAnswerIds: answerIds, orderedChoiceIds: choiceIds, colours: { red: 21, yellow: 6, green: 0, blue: 5, total: 32 }, openness: { explorer: 7, guardian: 0, total: 7 }, tieResolutions: [], primary: "red", secondary: "yellow", modifier: "explorer" };
	await transaction.personaRevision.create({ data: { id: personaRevisionId, personaProfileId, revision: 1, soulTemplateId: "commander-explorer", soulTemplateVersion: 1, soulTemplateDigest: templateDigest, interviewId, scoringPolicyId: "personal-agent-scoring", scoringPolicyVersion: 1, scoringPolicyDigest: scoringDigest, interpolationMapId: "personal-agent-interpolation", interpolationMapVersion: 1, interpolationMapDigest: interpolationDigest, scoringEvidence, primaryColour: PersonaColour.Red, secondaryColour: PersonaColour.Yellow, modifier: PersonaOpennessModifier.Explorer, compiledInstructions: "# Compiled personal tool SQL persona", authoredBy: principalId } });
	for (const [index, category] of [[1, PersonaInterviewCategory.Response], [2, PersonaInterviewCategory.Feedback], [7, PersonaInterviewCategory.Challenge]] as const)
	{
		await transaction.personaInsight.create({ data: { id: randomUUID(), personaRevisionId, category, statement: "Personal tool SQL fixture preference", interviewId, questionSetId: "personal-agent-onboarding", questionSetVersion: 1, questionId: questions[index]!, answerId: answerIds[index]! } });
	}
	const now = new Date();
	await transaction.personaRevision.update({ where: { id: personaRevisionId }, data: { state: PersonaRevisionState.Approved, approvedBy: principalId, approvedAt: now } });
	await transaction.personaProfile.update({ where: { id: personaProfileId }, data: { activeRevisionId: personaRevisionId } });
	return { personaProfileId, personaRevisionId };
}

/** Copies the fixture persona through its real Draft to Approved lifecycle for a later selection. */
async function _SeedApprovedPersonaSuccessor(transaction: Prisma.TransactionClient, personaRevisionId: string, principalId: string): Promise<string>
{
	const source = await transaction.personaRevision.findUniqueOrThrow({ where: { id: personaRevisionId }, include: { insights: true } });
	const successorId = randomUUID();
	await transaction.personaRevision.create({ data: { id: successorId, personaProfileId: source.personaProfileId, revision: source.revision + 1, soulTemplateId: source.soulTemplateId, soulTemplateVersion: source.soulTemplateVersion, soulTemplateDigest: source.soulTemplateDigest, interviewId: source.interviewId, scoringPolicyId: source.scoringPolicyId, scoringPolicyVersion: source.scoringPolicyVersion, scoringPolicyDigest: source.scoringPolicyDigest, interpolationMapId: source.interpolationMapId, interpolationMapVersion: source.interpolationMapVersion, interpolationMapDigest: source.interpolationMapDigest, scoringEvidence: source.scoringEvidence as Prisma.InputJsonValue, primaryColour: source.primaryColour, secondaryColour: source.secondaryColour, modifier: source.modifier, compiledInstructions: `${source.compiledInstructions}\n\nPersona successor proof.`, previousRevisionId: source.id, authoredBy: principalId } });
	for (const insight of source.insights)
	{
		await transaction.personaInsight.create({ data: { id: randomUUID(), personaRevisionId: successorId, category: insight.category, statement: insight.statement, interviewId: insight.interviewId, questionSetId: insight.questionSetId, questionSetVersion: insight.questionSetVersion, questionId: insight.questionId, answerId: insight.answerId } });
	}
	await transaction.personaRevision.update({ where: { id: successorId }, data: { state: PersonaRevisionState.Approved, approvedBy: principalId, approvedAt: new Date() } });
	return successorId;
}

/** Seeds one active personal service and two assignable tool revisions on the disposable baseline. */
export async function _SeedPersonalAgentToolsSqlFixture(client: PrismaClient)
{
	return client.$transaction(async function _Seed(transaction)
	{
		const siloId = `personal-tools-sql-${randomUUID()}`;
		const principalId = randomUUID();
		const modelDefinitionId = randomUUID();
		await transaction.principal.create({ data: { id: principalId, siloId, issuer: "https://personal-tools-sql.example", subject: principalId, provenance: PrincipalProvenance.External } });
		await transaction.orgMembership.create({ data: { id: randomUUID(), clusterTenant: siloId, subject: principalId, role: OrgRole.Member, status: OrgMemberStatus.Active } });
		await transaction.modelDefinition.create({ data: { id: modelDefinitionId, siloId, scope: ModelRoutingScope.Global, publicModelName: modelDefinitionId, litellmModelId: `litellm-${modelDefinitionId}`, upstreamModel: modelDefinitionId } });
		const persona = await _SeedApprovedPersona(transaction, siloId, principalId);
		const agentServiceId = randomUUID();
		const sourceRevisionId = randomUUID();
		const promptPolicyVersion = "personal-tools-sql-v1";
		const content: AgentRevisionContent = {
			promptPolicyVersion,
			personaRevisionId: persona.personaRevisionId,
			modelDefinitionId,
			budget: _BUDGET,
			skills: [],
			mcpToolRevisionIds: [],
			boundaryAttachments: [{ boundaryKind: RevisionBoundaryKinds.Personal, boundaryId: principalId, boundaryCoverage: RevisionBoundaryCoverages.Exact }],
		};
		await transaction.agentService.create({ data: { id: agentServiceId, siloId, kind: AgentServiceKind.Personal, name: "Personal tools SQL assistant", workloadProfile: "personal-default" } });
		const writer = new PrismaAgentRevisionWriterRepository(transaction);
		await writer.createDraft({ agentRevisionId: sourceRevisionId, siloId, agentServiceId, revision: 1, parentRevisionId: null, sourceRevisionId: null, content, changeMessage: "Created the personal tool-selection SQL fixture", authoredBy: principalId, createdAt: new Date() });
		const now = new Date();
		await transaction.agentRevision.update({ where: { id: sourceRevisionId }, data: { state: AgentRevisionState.Published, publishedAt: now } });
		await transaction.agentService.update({ where: { id_siloId: { id: agentServiceId, siloId } }, data: { state: AgentServiceState.Active, activeRevisionId: sourceRevisionId } });

		const caller = { siloId, principalId, subjectId: principalId };
		const effects = new PrismaPersonalAgentProductEffectsAuthority(transaction);
		await effects.reconcileCurrent(caller, { agentServiceId, agentRevisionId: sourceRevisionId, personaProfileId: persona.personaProfileId, modelDefinitionId, mcpToolRevisionIds: [] }, now);
		const firstTool = await _SeedTool(transaction, siloId, principalId, "records.first");
		const secondTool = await _SeedTool(transaction, siloId, principalId, "records.second");

		const targetModelId = randomUUID();
		const targetModelAlias = `personal-tools-model-${randomUUID()}`;
		await transaction.modelDefinition.create({ data: { id: targetModelId, siloId, scope: ModelRoutingScope.Global, publicModelName: targetModelAlias, litellmModelId: `litellm-${targetModelId}`, upstreamModel: targetModelId } });
		await _GrantActions(transaction, siloId, principalId, { kind: ProductAuthorizationResourceKinds.ModelDefinition, id: targetModelId }, [ProductAuthorizationActions.Use], "personal-tools-sql-model");
		const targetPersonaRevisionId = await _SeedApprovedPersonaSuccessor(transaction, persona.personaRevisionId, principalId);

		return { siloId, subjectId: principalId, principalId, personaProfileId: persona.personaProfileId, personaRevisionId: persona.personaRevisionId, targetPersonaRevisionId, agentServiceId, sourceRevisionId, firstTool, secondTool, targetModelId, targetModelAlias };
	}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}

/** Adds a grant from another manager so removal can prove it leaves unrelated authority intact. */
export async function _GrantIndependentPersonalToolUse(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedPersonalAgentToolsSqlFixture>>, toolRevisionId: string): Promise<void>
{
	await client.$transaction(async function _Grant(transaction)
	{
		await _GrantActions(transaction, fixture.siloId, fixture.principalId, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId }, [ProductAuthorizationActions.Use], "personal-tools-sql-independent");
	});
}

/** Removes one selected tool's derived grants through the production managed-grant writer. */
export async function _RemovePersonalManagerToolGrants(client: PrismaClient, fixture: Awaited<ReturnType<typeof _SeedPersonalAgentToolsSqlFixture>>, toolRevisionId: string): Promise<void>
{
	await client.$transaction(async function _Remove(transaction)
	{
		await _GrantActions(transaction, fixture.siloId, fixture.principalId, { kind: ProductAuthorizationResourceKinds.McpToolRevision, id: toolRevisionId }, [], `personal-agent-owner-access:${fixture.principalId}`);
	});
}
