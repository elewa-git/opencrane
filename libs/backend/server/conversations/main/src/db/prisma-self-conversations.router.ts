import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import type { PersonalRunAdmissionPort } from "@opencrane/backend/agents/execution/admission";
import { PrismaAgentRunRetryUnitOfWork, type RetryRunInputCompiler, type RunAdmissionTransaction } from "@opencrane/backend/agents/execution/runs";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { CONVERSATION_PROJECTION_CLOCK, CONVERSATION_PROJECTION_LIMITS, type ConversationOpenInterruptReader } from "@opencrane/backend/conversations/projection";

import { PrismaConversationMessageAdmissionUnitOfWork } from "./prisma-conversation-message-admission-unit-of-work";
import { _CreateConversationReplayRepository } from "./prisma-conversation-replay.composition";
import { PrismaConversationUnitOfWork } from "./prisma-conversation-unit-of-work";
import { PrismaConversationMutationRepository } from "./prisma-conversation-mutation-repository";
import { __CreateSelfConversationsRouter } from "../self-conversations.router";
import { __CreateSelfConversationSocketServer } from "../self-conversation-socket";
import type { SelfConversationSocketAuthenticator, SelfConversationSocketServer } from "../self-conversation-socket.types";
import type { ConversationCaller } from "../types/conversation-caller.types";
import type { ConversationAttachmentAdmissionFactory } from "../conversation-message-admission.types";
import type { ConversationCreationAuthority } from "../conversation-creation-authority.types";
import type { ConversationComputerParticipantInputAdmission } from "../conversation-computers/conversation-computer-participant-input-admission";

/** Maps authenticated request facts to the caller contract owned by conversations. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): ConversationCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { principalId: principal.principalId, subjectId: principal.externalSubject, issuer: principal.externalIssuer, siloId: principal.siloId } : null;
}

/** Creates a mutation repository for an Agent-thread run admission's final transaction. */
function _createMutationRepository(transaction: RunAdmissionTransaction): PrismaConversationMutationRepository
{
	return new PrismaConversationMutationRepository(transaction.prisma);
}

/**
 * Build the ready-to-mount conversation router for an app.
 *
 * Everything Prisma-shaped is assembled here — the unit of work, the query and mutation
 * repositories, and the factory that lets Agent-thread run admission create its parent and child
 * records inside its own transaction — so the router itself stays free of database types.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at `/api/v1/me/conversations`.
 *
 * @param prisma - Product database client.
 * @param runAdmission - Starts the first Agent-thread run in the transaction that creates its
 *   parent and child records. It does not admit AgentSession participant input.
 * @param workflow - Guarded engine that saves a retry task in the retry transaction.
 * @param retryInputCompiler - Inputs authority that compiles the exact new retry subject and snapshot.
 * @param createAttachmentAdmission - Admits upload references before a message transaction uses them.
 * @param creation - Creates conversations through reservation, immutable history, and projection.
 * @param computerInputs - Rechecks and appends AgentSession text to immutable history, or leaves
 *   that route unavailable when the computer composition is absent.
 * @param logger - Used only for unexpected failures; never receives message content.
 * @returns An Express router ready to mount.
 */
export function _CreateSelfConversationsRouter(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, workflow: Pick<IWorkflowEngine, "spawn">, retryInputCompiler: RetryRunInputCompiler, createAttachmentAdmission: ConversationAttachmentAdmissionFactory, creation: ConversationCreationAuthority, computerInputs: Pick<ConversationComputerParticipantInputAdmission, "admit"> | null, logger: Logger): Router
{
	const messageAdmission = new PrismaConversationMessageAdmissionUnitOfWork(prisma, runAdmission, _createMutationRepository, createAttachmentAdmission);
	const runRetry = new PrismaAgentRunRetryUnitOfWork(prisma, workflow, retryInputCompiler);
	const authority = new PrismaConversationUnitOfWork(prisma, messageAdmission, runRetry, creation);
	return __CreateSelfConversationsRouter({ resolveCaller: _resolveCaller, authority, computerInputs, logger });
}

/**
 * Builds the participant socket endpoint over the same authorities as the HTTP router.
 *
 * Sharing `creation` keeps a socket-triggered create subject to the same caller-bound reservation
 * and history projection as an HTTP create. Called by: {@link _Main} in apps/opencrane/src/index.ts.
 * @param prisma - Opens read and remaining mutation transactions.
 * @param runAdmission - Starts first Agent-thread runs for the remaining group-agent workflow;
 *   it does not admit AgentSession participant input.
 * @param workflow - Saves retries from participant-owned run commands.
 * @param retryInputCompiler - Compiles the fresh retry snapshot.
 * @param createAttachmentAdmission - Admits attachments before a message transaction uses them.
 * @param creation - Reserves, anchors, and projects a conversation creation request.
 * @param computerInputs - Rechecks and appends AgentSession text to immutable history, or leaves
 *   that socket command unavailable when the computer composition is absent.
 * @param logger - Records unexpected transport failures without message content.
 * @param authenticator - Resolves the socket session to its conversation caller.
 * @param options - Supplies optional interruption reads and process shutdown handling.
 * @returns A socket server that shares the participant conversation authority.
 */
export function _CreatePrismaSelfConversationSocketServer(prisma: PrismaClient, runAdmission: PersonalRunAdmissionPort, workflow: Pick<IWorkflowEngine, "spawn">, retryInputCompiler: RetryRunInputCompiler, createAttachmentAdmission: ConversationAttachmentAdmissionFactory, creation: ConversationCreationAuthority, computerInputs: Pick<ConversationComputerParticipantInputAdmission, "admit"> | null, logger: Logger, authenticator: SelfConversationSocketAuthenticator, options: { readonly interrupts?: ConversationOpenInterruptReader; readonly shutdownSignal?: AbortSignal } = {}): SelfConversationSocketServer
{
	const messageAdmission = new PrismaConversationMessageAdmissionUnitOfWork(prisma, runAdmission, _createMutationRepository, createAttachmentAdmission);
	const runRetry = new PrismaAgentRunRetryUnitOfWork(prisma, workflow, retryInputCompiler);
	const authority = new PrismaConversationUnitOfWork(prisma, messageAdmission, runRetry, creation);
	const interruptOptions = options.interrupts === undefined ? {} : { interrupts: options.interrupts };
	const shutdownOptions = options.shutdownSignal === undefined ? {} : { shutdownSignal: options.shutdownSignal };
	return __CreateSelfConversationSocketServer({ authenticator, authority, computerInputs, repository: _CreateConversationReplayRepository(prisma), clock: CONVERSATION_PROJECTION_CLOCK, limits: CONVERSATION_PROJECTION_LIMITS, ...interruptOptions, ...shutdownOptions, logger });
}
