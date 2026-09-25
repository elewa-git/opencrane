import type { Prisma, PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { _CreateSelfElicitationActivityRouter, _CreateSelfElicitationRouter } from "@opencrane/backend/agents/execution/elicitation";
import { __CreateConversationAssetRouter, _CreateConversationAssetAuthority, _ResolveConversationAssetCaller } from "@opencrane/backend/server/conversation-assets";
import { _ConversationComputerReviewAuthority, _CreateConversationComputerReviewRouter, KeyedConversationComputerReviewCredentialDeriver, PrismaConversationComputerTurnWorkflowEventRepository, PrismaConversationMetadataReader } from "@opencrane/backend/server/conversations";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { _CreateConversationHistoryComposition } from "../../conversations/conversation-history-composition";
import { _log } from "../../process/log";
import type { ConversationRouteDependencies, ProductRouteDependencies, RouteMount } from "../routes.types";

/**
 * Build the signed-in person's conversation, memory and activity routes.
 *
 * Four routers share `/api/v1/me/conversations`. Keep their order: Express tries them in mount
 * order, so files come first, then history, computer review and elicitation answers.
 *
 * Called by: `_RegisterRoutes` in routes.ts.
 *
 * @param dependencies - Shared product services; this area uses the conversation services and the workflow engine.
 * @returns The area's routes in mount order.
 */
export function _CreateConversationRoutes(dependencies: ProductRouteDependencies): readonly RouteMount[]
{
	const { prisma, conversations } = dependencies;
	const execution = dependencies.tools.workflows.execution;
	const history = _CreateConversationHistoryComposition(prisma, conversations.history, conversations.keyringPath, conversations.sandboxProfile, execution, conversations.memoryWorkflow);
	const computerReview = _CreateComputerReviewRouter(prisma, conversations);
	return [
		{ method: "use", path: "/api/v1/me/conversations", handler: __CreateConversationAssetRouter({ resolveCaller: _ResolveConversationAssetCaller, authority: _CreateConversationAssetAuthority(prisma, process.env, conversations.artifactScannerEnabled), logger: _log }) },
		{ method: "use", path: "/api/v1/me/conversations", handler: history.conversations },
		{ method: "use", path: "/api/v1/me/memory", handler: history.memory },
		{ method: "use", path: "/api/v1/me/conversations", handler: computerReview },
		{ method: "use", path: "/api/v1/me/conversations", handler: _CreateSelfElicitationRouter(prisma, _log, function _CreateTurnWorkflowEvents(transaction) { return new PrismaConversationComputerTurnWorkflowEventRepository(transaction as Prisma.TransactionClient, execution); }) },
		{ method: "use", path: "/api/v1/me/activity", handler: _CreateSelfElicitationActivityRouter(prisma, _log) },
	];
}

/**
 * Build the routes that let a conversation participant review the conversation's computer.
 *
 * @param prisma - The main product database client.
 * @param conversations - History, keyring and the computer profile whose namespace holds review targets.
 * @returns The computer-review router.
 */
function _CreateComputerReviewRouter(prisma: PrismaClient, conversations: ConversationRouteDependencies): Router
{
	const credentials = KeyedConversationComputerReviewCredentialDeriver.fromKeyring(_ReadConversationPrivatePayloadKeyring(conversations.keyringPath));
	const authority = new _ConversationComputerReviewAuthority(new PrismaConversationMetadataReader(prisma), new ConversationComputerHistory(conversations.history), credentials);
	return _CreateConversationComputerReviewRouter({ authority, sandboxNamespace: conversations.sandboxProfile.namespace, logger: _log }, _ResolveRequestPrincipal);
}
