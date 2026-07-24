import { OrgMemberStatus, type PrismaClient } from "@prisma/client";
import type { Request } from "express";

import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
// Side-effect import: loads the express-session `SessionData.authUser` augmentation.
import "@opencrane/server/_infra/auth";

import type { ActivePersonalCaller } from "./personal-owner-wiring.types.js";

/** Resolve an active personal member from verified OIDC session identity and the exact host silo. */
export async function _ResolveActivePersonalCaller(prisma: PrismaClient, request: Request): Promise<ActivePersonalCaller | null>
{
	const authUser = request.session?.authUser;
	const userId = typeof authUser?.sub === "string" ? authUser.sub.trim() : "";
	const siloId = _ClusterTenantFromHost(_RequestHost(request)) ?? "";
	if (!userId || !siloId) return null;
	const membership = await prisma.orgMembership.findUnique({ where: { clusterTenant_subject: { clusterTenant: siloId, subject: userId } }, select: { status: true } });
	return membership?.status === OrgMemberStatus.Active ? { userId, siloId } : null;
}
