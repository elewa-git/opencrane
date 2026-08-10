import type { PrismaClient } from "@prisma/client";
import type { Router } from "express";
import type { Logger } from "pino";

import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";

import { __CreateDeferredToolApprovalRouter } from "./deferred-tool-approval.router.js";
import type { DeferredToolApprovalCaller } from "./deferred-tool-approval.router.types.js";
import { PrismaDeferredToolApprovalDecisionRepository } from "./prisma-deferred-tool-approval-decision-repository.js";
import { PrismaSelfDeferredToolApprovalListRepository } from "./prisma-self-deferred-tool-approval-list-repository.js";

/** Maps authenticated request facts to the caller contract owned by approval decisions. */
function _resolveCaller(request: Parameters<typeof _ResolveRequestPrincipal>[0]): DeferredToolApprovalCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal ? { subjectId: principal.subjectId, siloId: principal.siloId } : null;
}

/**
 * Composes the Prisma-backed self-only deferred-tool approval router.
 * @param prisma - Canonical product-authority client.
 * @param logger - Process logger supplied by the app composition root.
 * @returns The configured deferred-tool approval router.
 */
export function _CreateDeferredToolApprovalRouter(prisma: PrismaClient, logger: Logger): Router
{
	return __CreateDeferredToolApprovalRouter({
		resolveCaller: _resolveCaller,
		decisions: new PrismaDeferredToolApprovalDecisionRepository(prisma),
		pendingApprovals: new PrismaSelfDeferredToolApprovalListRepository(prisma),
		clock: { now(): Date { return new Date(); } },
		logger,
	});
}
