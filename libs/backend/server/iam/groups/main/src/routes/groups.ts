import { Router, type Request, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";

import { _RequireOrgAdmin, _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { ___WithValidatedPublicBody } from "@opencrane/backend/server/infra/http";

import { ExternalGroupMembershipMutationError, GroupNotFoundError, GroupReferenceNotFoundError, PrismaGroupUnitOfWork } from "../core/groups.logic";
import { ___GroupCreateWriteSchema, ___GroupUpdateWriteSchema } from "../core/groups.validator";
import type { GroupRouteCaller, GroupRouteCallerResolver } from "./groups.types";

/** Group mutation operations used to map foreign-key errors without leaking persistence details. */
enum _GroupMutationKinds
{
	/** Creates a group. */
	Create = "create",
	/** Updates group metadata or local membership. */
	Update = "update",
	/** Deletes a group. */
	Delete = "delete",
}

/** Resolve the silo from the authenticated request and trusted host. */
function _ResolveGroupCaller(request: Request): GroupRouteCaller | null
{
	const principal = _ResolveRequestPrincipal(request);
	return principal === null ? null : { siloId: principal.siloId };
}

/** Send the same fail-closed response when a route cannot bind the request to a silo. */
function _RequireGroupCaller(request: Request, response: Response, resolveCaller: GroupRouteCallerResolver): GroupRouteCaller | null
{
	const caller = resolveCaller(request);
	if (caller !== null) return caller;
	response.status(403).json({ error: "Organization identity is required", code: "FORBIDDEN_NO_SILO" });
	return null;
}

/** Convert group-domain and hierarchy failures into stable client errors. */
function _SendGroupMutationError(error: unknown, response: Response, mutation: _GroupMutationKinds): boolean
{
	if (error instanceof ExternalGroupMembershipMutationError)
	{
		response.status(409).json({ error: error.message, code: "EXTERNAL_GROUP_MEMBERSHIP" });
		return true;
	}
	if (error instanceof GroupNotFoundError)
	{
		response.status(404).json({ error: error.message, code: "GROUP_NOT_FOUND" });
		return true;
	}
	if (error instanceof GroupReferenceNotFoundError)
	{
		response.status(404).json({ error: error.message, code: "GROUP_REFERENCE_NOT_FOUND" });
		return true;
	}
	if (error instanceof Error && error.message.includes("group hierarchy cannot contain a cycle"))
	{
		response.status(409).json({ error: "Group hierarchy cannot contain a cycle", code: "GROUP_HIERARCHY_CYCLE" });
		return true;
	}
	if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
	if (error.code === "P2025")
	{
		response.status(404).json({ error: "Group not found", code: "GROUP_NOT_FOUND" });
		return true;
	}
	if (error.code !== "P2003") return false;
	if (mutation === _GroupMutationKinds.Delete)
	{
		response.status(409).json({ error: "Group still has children or active references", code: "GROUP_HAS_REFERENCES" });
		return true;
	}
	response.status(404).json({ error: "Group reference not found", code: "GROUP_REFERENCE_NOT_FOUND" });
	return true;
}

/**
 * Create, read, update, and delete groups inside the authenticated request's silo.
 *
 * Read and mutation handlers independently resolve the silo even though the app mounts this router
 * behind authentication. This prevents an accidental future mount from turning a globally unique
 * identifier into cross-silo authority.
 *
 * Called by: apps/opencrane/src/app/routes.ts at `/api/v1/groups`.
 */
export function groupsRouter(prisma: PrismaClient, resolveCaller: GroupRouteCallerResolver = _ResolveGroupCaller): Router
{
	const router = Router();
	const groups = new PrismaGroupUnitOfWork(prisma);

	router.get("/", async function _ListGroups(request, response)
	{
		const caller = _RequireGroupCaller(request, response, resolveCaller);
		if (caller === null) return;
		response.json(await groups.list(caller.siloId));
	});

	router.get("/:id", async function _GetGroup(request, response)
	{
		const caller = _RequireGroupCaller(request, response, resolveCaller);
		if (caller === null) return;
		const group = await groups.get(caller.siloId, String(request.params.id));
		if (!group)
		{
			response.status(404).json({ error: "Group not found", code: "GROUP_NOT_FOUND" });
			return;
		}
		response.json(group);
	});

	router.post("/", _RequireOrgAdmin(), ___WithValidatedPublicBody(___GroupCreateWriteSchema, async function _CreateGroup(request, response, _next, body)
	{
		const caller = _RequireGroupCaller(request, response, resolveCaller);
		if (caller === null) return;
		try { response.status(201).json(await groups.create(caller.siloId, body)); }
		catch (error) { if (!_SendGroupMutationError(error, response, _GroupMutationKinds.Create)) throw error; }
	}));

	router.put("/:id", _RequireOrgAdmin(), ___WithValidatedPublicBody(___GroupUpdateWriteSchema, async function _UpdateGroup(request, response, _next, body)
	{
		const caller = _RequireGroupCaller(request, response, resolveCaller);
		if (caller === null) return;
		try { response.json(await groups.update(caller.siloId, String(request.params.id), body)); }
		catch (error) { if (!_SendGroupMutationError(error, response, _GroupMutationKinds.Update)) throw error; }
	}));

	router.delete("/:id", _RequireOrgAdmin(), async function _DeleteGroup(request, response)
	{
		const caller = _RequireGroupCaller(request, response, resolveCaller);
		if (caller === null) return;
		try { response.json(await groups.delete(caller.siloId, String(request.params.id))); }
		catch (error) { if (!_SendGroupMutationError(error, response, _GroupMutationKinds.Delete)) throw error; }
	});

	return router;
}
