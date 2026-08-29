import express from "express";
import request from "supertest";
import { AgentRevisionState, AgentServiceKind, AgentServiceState, ModelRoutingScope, PersonaRevisionState, PrincipalProvenance, UserOnboardingCompletionProvenance, UserOnboardingState, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@opencrane/backend/observability";
import { PRODUCT_AUTHORIZATION_CATALOG_DIGEST, PRODUCT_AUTHORIZATION_CATALOG_ID, PRODUCT_AUTHORIZATION_CATALOG_REVISION } from "@opencrane/models/authorization";

import { _CreateUserOnboardingComposition } from "../user-onboarding-composition";

/** Durable state copied into each fake transaction so rejected callbacks leave no writes behind. */
interface _DurableState
{
	onboardingState: UserOnboardingState;
	completionProvenance: UserOnboardingCompletionProvenance | null;
	agentService: { id: string; state: AgentServiceState; activeRevisionId: string | null; workloadProfile: string } | null;
	agentRevision: { id: string; state: AgentRevisionState; personaRevisionId: string; modelDefinitionId: string; digest: string } | null;
	auditCount: number;
	authorizationGrants: _AuthorizationGrantRow[];
}

/** Minimum durable authorization row used by both reconciliation and central decision reads. */
interface _AuthorizationGrantRow
{
	id: string;
	siloId: string;
	managerId: string;
	subjectKind: string;
	subjectGroupId: string | null;
	subjectPrincipalId: string | null;
	boundaryKind: string;
	boundaryGroupId: string | null;
	boundaryPrincipalId: string | null;
	boundaryCoverage: string;
	catalogId: string;
	catalogRevision: number;
	catalogDigest: string;
	capabilityId: string;
	resourceKind: string;
	resourceId: string;
	effect: string;
	priority: number;
	createdBy: string;
	validFrom: Date;
	expiresAt: Date | null;
	revokedAt: Date | null;
}

/** Stable owner and immutable bootstrap evidence used by the public composition test. */
const _OWNER = { siloId: "silo-1", subjectId: "user-1" };
const _PRINCIPAL_ID = "principal-1";
const _CONVERSATION_ID = "conversation-1";
const _ONBOARDING_ID = "onboarding-1";
const _PERSONA_REVISION_ID = "persona-revision-1";
const _CONTENT_REVISION_ID = "content-revision-1";
const _CONTENT_DIGEST = "content-digest-1";
const _STARTED_AT = new Date("2026-08-18T08:00:00.000Z");

/** Return the collection-root grant already projected when the active member was authenticated. */
function _AgentServiceCollectionGrant(): _AuthorizationGrantRow
{
	return {
		id: "grant-agent-service-collection",
		siloId: _OWNER.siloId,
		managerId: "organization-membership-product-bootstrap",
		subjectKind: "Principal",
		subjectGroupId: null,
		subjectPrincipalId: _PRINCIPAL_ID,
		boundaryKind: "Personal",
		boundaryGroupId: null,
		boundaryPrincipalId: _PRINCIPAL_ID,
		boundaryCoverage: "Exact",
		catalogId: PRODUCT_AUTHORIZATION_CATALOG_ID,
		catalogRevision: PRODUCT_AUTHORIZATION_CATALOG_REVISION,
		catalogDigest: PRODUCT_AUTHORIZATION_CATALOG_DIGEST,
		capabilityId: "agent-service-collection:create",
		resourceKind: "agent-service-collection",
		resourceId: _OWNER.siloId,
		effect: "Allow",
		priority: 0,
		createdBy: _PRINCIPAL_ID,
		validFrom: _STARTED_AT,
		expiresAt: null,
		revokedAt: null,
	};
}

/** Clone the mutable transaction state without sharing nested service or revision objects. */
function _CloneState(state: _DurableState): _DurableState
{
	const agentService = state.agentService === null ? null : { ...state.agentService };
	const agentRevision = state.agentRevision === null ? null : { ...state.agentRevision };
	return { ...state, agentService, agentRevision, authorizationGrants: state.authorizationGrants.map(function _Grant(grant) { return { ...grant }; }) };
}

/** Build the complete immutable bootstrap conversation returned by the onboarding repository. */
function _Conversation()
{
	return {
		id: _CONVERSATION_ID,
		onboardingId: _ONBOARDING_ID,
		siloId: _OWNER.siloId,
		userId: _OWNER.subjectId,
		personaRevisionId: _PERSONA_REVISION_ID,
		personaDisplayName: "Navigator",
		personaArchetype: "Analyst",
		contentRevisionId: _CONTENT_REVISION_ID,
		contentDigest: _CONTENT_DIGEST,
		startedAt: _STARTED_AT,
		contentRevision: {
			id: _CONTENT_REVISION_ID,
			revision: 1,
			archetype: "Analyst",
			primaryColour: "Blue",
			sourceLabel: "reviewed-bootstrap-v1",
			digest: _CONTENT_DIGEST,
			opening: "Welcome.",
			questions: [1, 2, 3].map(function _Question(ordinal) { return { ordinal, prompt: `Question ${ordinal}` }; }),
		},
		answers: [1, 2, 3].map(function _Answer(ordinal) { return { id: `answer-${ordinal}`, ordinal, questionOrdinal: ordinal, text: `Answer ${ordinal}`, idempotencyKey: `key-${ordinal}`, answeredAt: _STARTED_AT }; }),
	};
}

/** Project the current fake state into the full row expected by the Prisma onboarding adapter. */
function _OnboardingRow(state: _DurableState)
{
	return {
		id: _ONBOARDING_ID,
		siloId: _OWNER.siloId,
		userId: _OWNER.subjectId,
		workflowVersion: 1,
		state: state.onboardingState,
		personaInterviewId: "interview-1",
		personaRevisionId: _PERSONA_REVISION_ID,
		bootstrapConversationId: _CONVERSATION_ID,
		bootstrapContentRevisionId: _CONTENT_REVISION_ID,
		bootstrapContentDigest: _CONTENT_DIGEST,
		completionProvenance: state.completionProvenance,
		completionMigrationRevision: null,
		completionMigrationBatch: null,
		startedAt: _STARTED_AT,
		surveyStartedAt: _STARTED_AT,
		completedAt: state.onboardingState === UserOnboardingState.Completed ? _STARTED_AT : null,
		updatedAt: _STARTED_AT,
	};
}

/** Build one transaction-shaped Prisma fake and expose committed state for assertions. */
function _PrismaFixture(markCompleted: boolean): { readonly prisma: PrismaClient; readonly state: () => _DurableState; readonly attempts: () => number; readonly errors: unknown[] }
{
	const durable: _DurableState = { onboardingState: UserOnboardingState.BootstrapChatInProgress, completionProvenance: null, agentService: null, agentRevision: null, auditCount: 0, authorizationGrants: [_AgentServiceCollectionGrant()] };
	const errors: unknown[] = [];
	let attempts = 0;

	function _Client(state: _DurableState, transactional: boolean): Record<string, unknown>
	{
		const conversation = _Conversation();
		const client: Record<string, unknown> = {
			userOnboarding: {
				upsert: vi.fn(async function _Upsert() { return _OnboardingRow(state); }),
				findUnique: vi.fn(async function _FindEvidence()
				{
					return { ..._OnboardingRow(state), bootstrapConversation: { id: conversation.id, onboardingId: conversation.onboardingId, siloId: conversation.siloId, userId: conversation.userId, personaRevisionId: conversation.personaRevisionId, contentRevisionId: conversation.contentRevisionId, contentDigest: conversation.contentDigest, answers: conversation.answers.map(function _Answer(answer) { return { questionOrdinal: answer.questionOrdinal }; }), contentRevision: { questions: conversation.contentRevision.questions.map(function _Question(question) { return { ordinal: question.ordinal }; }) } } };
				}),
				updateMany: vi.fn(async function _Complete()
				{
					if (!markCompleted || state.onboardingState !== UserOnboardingState.BootstrapChatInProgress) return { count: 0 };
					state.onboardingState = UserOnboardingState.Completed;
					state.completionProvenance = UserOnboardingCompletionProvenance.BootstrapConcluded;
					return { count: 1 };
				}),
			},
			userOnboardingBootstrapConversation: { findFirst: vi.fn(async function _FindConversation() { return conversation; }) },
			personaRevision: {
				findUnique: vi.fn(async function _FindPersona()
				{
					return { state: PersonaRevisionState.Approved, approvedAt: _STARTED_AT, profile: { id: "persona-profile-1", siloId: _OWNER.siloId, userId: _OWNER.subjectId, activeRevision: { id: _PERSONA_REVISION_ID, state: PersonaRevisionState.Approved, approvedAt: _STARTED_AT, soulTemplate: { displayName: "Navigator" } }, revisions: [{ id: _PERSONA_REVISION_ID }] } };
				}),
			},
			principal: {
				findMany: vi.fn(async function _ResolvePrincipal() { return [{ id: _PRINCIPAL_ID, subject: _OWNER.subjectId }]; }),
				findUnique: vi.fn(async function _ReadPrincipal() { return { id: _PRINCIPAL_ID, subject: _OWNER.subjectId, provenance: PrincipalProvenance.External }; }),
			},
			orgMembership: { findFirst: vi.fn(async function _ReadMembership() { return { id: "membership-1" }; }) },
			groupMembership: { findMany: vi.fn(async function _ReadGroups() { return []; }) },
			group: { findMany: vi.fn(async function _ReadHierarchy() { return []; }) },
			authorizationGrant: {
				findMany: vi.fn(async function _ReadGrants(input: { where: { siloId?: string; managerId?: string; resourceKind?: string; resourceId?: string; revokedAt?: null } })
				{
					return state.authorizationGrants.filter(function _Matches(grant)
					{
						return (input.where.siloId === undefined || grant.siloId === input.where.siloId)
							&& (input.where.managerId === undefined || grant.managerId === input.where.managerId)
							&& (input.where.resourceKind === undefined || grant.resourceKind === input.where.resourceKind)
							&& (input.where.resourceId === undefined || grant.resourceId === input.where.resourceId)
							&& (input.where.revokedAt === undefined || grant.revokedAt === input.where.revokedAt);
					});
				}),
				create: vi.fn(async function _CreateGrant(input: { data: Omit<_AuthorizationGrantRow, "id" | "validFrom" | "expiresAt" | "revokedAt"> })
				{
					const grant = { id: `grant-${state.authorizationGrants.length + 1}`, ...input.data, validFrom: _STARTED_AT, expiresAt: null, revokedAt: null };
					state.authorizationGrants.push(grant);
					return grant;
				}),
				updateMany: vi.fn(async function _RevokeGrants() { return { count: 0 }; }),
			},
			auditEntry: { create: vi.fn(async function _AuditGrantChange() { return {}; }) },
			agentService: {
				findMany: vi.fn(async function _FindServices() { return state.agentService === null || state.agentRevision === null ? [] : [{ ...state.agentService, activeRevision: { personaRevisionId: state.agentRevision.personaRevisionId, modelDefinitionId: state.agentRevision.modelDefinitionId } }]; }),
				findUnique: vi.fn(async function _FindService() { return state.agentService === null || state.agentRevision === null ? null : { ...state.agentService, siloId: _OWNER.siloId, kind: AgentServiceKind.Personal, activeRevision: { personaRevisionId: state.agentRevision.personaRevisionId, modelDefinitionId: state.agentRevision.modelDefinitionId } }; }),
				create: vi.fn(async function _CreateService(input: { data: { id: string; state: AgentServiceState; workloadProfile: string } })
				{
					state.agentService = { id: input.data.id, state: input.data.state, activeRevisionId: null, workloadProfile: input.data.workloadProfile };
					return state.agentService;
				}),
				update: vi.fn(async function _ActivateService(input: { data: { state: AgentServiceState; activeRevisionId: string } })
				{
					if (state.agentService === null) throw new Error("service missing");
					state.agentService = { ...state.agentService, state: input.data.state, activeRevisionId: input.data.activeRevisionId };
					return state.agentService;
				}),
			},
			agentRevision: {
				create: vi.fn(async function _CreateRevision(input: { data: { id: string; digest: string; personaRevisionId: string; modelDefinition: { connect: { id: string } } } })
				{
					state.agentRevision = { id: input.data.id, state: AgentRevisionState.Draft, personaRevisionId: input.data.personaRevisionId, modelDefinitionId: input.data.modelDefinition.connect.id, digest: input.data.digest };
					return { ...state.agentRevision, skillAssignments: [] };
				}),
				update: vi.fn(async function _PublishRevision(input: { data: { state: AgentRevisionState } })
				{
					if (state.agentRevision === null) throw new Error("revision missing");
					state.agentRevision = { ...state.agentRevision, state: input.data.state };
					return state.agentRevision;
				}),
			},
			modelRoutingDefault: { findMany: vi.fn(async function _FindDefault() { return [{ scope: ModelRoutingScope.Global, defaultModel: "openai/gpt-5" }]; }) },
			modelDefinition: { findMany: vi.fn(async function _FindModel() { return [{ id: "model-definition-1", scope: ModelRoutingScope.Global }]; }) },
			auditDecision: { create: vi.fn(async function _Audit() { state.auditCount += 1; return {}; }) },
		};
		if (!transactional)
		{
			client.$transaction = async function _Transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T>
			{
				attempts += 1;
				const staged = _CloneState(durable);
				const result = await work(_Client(staged, true));
				Object.assign(durable, staged);
				return result;
			};
		}
		return client;
	}

	return { prisma: _Client(durable, false) as unknown as PrismaClient, state: function _State() { return durable; }, attempts: function _Attempts() { return attempts; }, errors };
}

/** Mount the real app composition with the fake Prisma authority at its public route. */
function _App(fixture: ReturnType<typeof _PrismaFixture>)
{
	const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn(function _Capture(fields: { err?: unknown })
	{
		if (fields.err !== undefined)
			fixture.errors.push(fields.err);
	}) } as unknown as Logger;
	const composition = _CreateUserOnboardingComposition(fixture.prisma, logger, function _ResolveOwner() { return _OWNER; });
	const app = express();
	app.use(express.json());
	app.use("/api/v1/me/onboarding", composition.router);
	return app;
}

describe("personal Agent onboarding app composition", function _PersonalAgentCompositionSuite()
{
	it("publishes one routed personal Agent before the conclude response succeeds", async function _PublishesFromThePublicRoute()
	{
		const fixture = _PrismaFixture(true);
		const response = await request(_App(fixture)).post("/api/v1/me/onboarding/chat/conclude").send({});
		expect(response.status, `${JSON.stringify(response.body)} ${fixture.errors.map(function _Error(error) { return error instanceof Error ? error.stack : String(error); }).join(" ")}`).toBe(200);
		expect(response.body).toMatchObject({ state: "completed", canConclude: false });
		expect(fixture.state()).toMatchObject({ onboardingState: UserOnboardingState.Completed, completionProvenance: UserOnboardingCompletionProvenance.BootstrapConcluded, agentService: { id: _ONBOARDING_ID, state: AgentServiceState.Active }, agentRevision: { state: AgentRevisionState.Published, personaRevisionId: _PERSONA_REVISION_ID }, auditCount: 6 });
		expect(fixture.state().agentService?.activeRevisionId).toBe(fixture.state().agentRevision?.id);
		expect(fixture.state().authorizationGrants).toHaveLength(20);
		expect(fixture.attempts()).toBe(2);
	});

	it("rolls Agent and audit writes back when the final onboarding compare-and-swap keeps losing", async function _RollsBackThePublicRoute()
	{
		const fixture = _PrismaFixture(false);
		await request(_App(fixture)).post("/api/v1/me/onboarding/chat/conclude").send({}).expect(503);
		expect(fixture.state()).toMatchObject({ onboardingState: UserOnboardingState.BootstrapChatInProgress, completionProvenance: null, agentService: null, agentRevision: null, auditCount: 0, authorizationGrants: [_AgentServiceCollectionGrant()] });
		expect(fixture.attempts()).toBe(3);
	});
});
