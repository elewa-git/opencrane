import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";

import { PrismaKurrentPersonalMemoryMessageSource, PrismaPersonalMemoryCommandUnitOfWork, _CreatePersonalMemoryCommandRouter, _ResolveConversationCaller, type SelfConversationHistoryAuthority } from "@opencrane/backend/server/conversations";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";

import { _log } from "../process/log";

/** Connects authenticated memory commands to existing history and transaction-bound workflow admission. */
export function _CreatePersonalMemoryCommandComposition(prisma: PrismaClient, history: Pick<SelfConversationHistoryAuthority, "read">, workflows: Pick<IWorkflowEngine, "spawn">): Router
{
	const sources = new PrismaKurrentPersonalMemoryMessageSource(history);
	const authority = new PrismaPersonalMemoryCommandUnitOfWork(prisma, sources, workflows);
	const dependencies = { authority, resolveCaller: _ResolveConversationCaller, logger: _log };
	return _CreatePersonalMemoryCommandRouter(dependencies);
}
