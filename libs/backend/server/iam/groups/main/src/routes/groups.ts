import { Router, type Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";

import { _RequireOrgAdmin } from "@opencrane/backend/server/infra/auth";
import { ___WithValidatedPublicBody } from "@opencrane/backend/server/infra/http";

import { createGroup, deleteGroup, getGroup, listGroups, updateGroup } from "../core/groups.logic";
import { ___GroupCreateWriteSchema, ___GroupUpdateWriteSchema } from "./groups.validator";

type _GroupMutationKind = "create" | "update" | "delete";

/**
 * Converts hierarchy constraint failures into the route's stable client errors.
 * Prisma reports both a missing parent and a parent-with-children deletion as `P2003`, so the
 * attempted mutation determines whether the client receives not-found or conflict.
 */
function _SendGroupMutationError(error: unknown, response: Response, mutation: _GroupMutationKind): boolean
{
  if (error instanceof Error && error.message.includes("group hierarchy cannot contain a cycle"))
  {
    response.status(409).json({ error: "Group hierarchy cannot contain a cycle", code: "GROUP_HIERARCHY_CYCLE" });
    return true;
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError))
  {
    return false;
  }

  if (error.code === "P2025")
  {
    response.status(404).json({ error: "Group not found", code: "GROUP_NOT_FOUND" });
    return true;
  }

  if (error.code !== "P2003")
  {
    return false;
  }

  if (mutation === "delete")
  {
    response.status(409).json({ error: "Group still has children", code: "GROUP_HAS_CHILDREN" });
    return true;
  }

  response.status(404).json({ error: "Parent group not found", code: "PARENT_GROUP_NOT_FOUND" });
  return true;
}

/**
 * Create, read, update, and delete the silo's groups.
 *
 * Groups are used for access control and sharing, so mutation operations (create, update, delete)
 * require organisation administrator authority. Read operations remain available to all authenticated
 * users because they need to see groups for sharing and entitlement selection.
 * A parent link arranges groups but does not inherit membership or grants.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at /api/v1/groups on the browser-session
 * authenticated listener.
 * @param prisma - Silo Prisma client.
 * @returns Express router with the five group routes.
 */
export function groupsRouter(prisma: PrismaClient): Router
{
  const router = Router();

  router.get("/", async function _listGroups(req, res)
  {
    res.json(await listGroups(prisma));
  });

  router.get("/:id", async function _getGroup(req, res)
  {
    const group = await getGroup(prisma, req.params.id);
    if (!group)
    {
      res.status(404).json({ error: "Group not found", code: "GROUP_NOT_FOUND" });
      return;
    }

    res.json(group);
  });

  router.post("/", _RequireOrgAdmin(), ___WithValidatedPublicBody(___GroupCreateWriteSchema, async function _createGroup(_req, res, _next, body)
  {
    try
    {
      res.status(201).json(await createGroup(prisma, body));
    }
    catch (error)
    {
      if (!_SendGroupMutationError(error, res, "create")) throw error;
    }
  }));

  router.put("/:id", _RequireOrgAdmin(), ___WithValidatedPublicBody(___GroupUpdateWriteSchema, async function _updateGroup(req, res, _next, body)
  {
    try
    {
      res.json(await updateGroup(prisma, String(req.params.id), body));
    }
    catch (error)
    {
      if (!_SendGroupMutationError(error, res, "update")) throw error;
    }
  }));

  router.delete("/:id", _RequireOrgAdmin(), async function _deleteGroup(req, res)
  {
    try
    {
      res.json(await deleteGroup(prisma, String(req.params.id)));
    }
    catch (error)
    {
      if (!_SendGroupMutationError(error, res, "delete")) throw error;
    }
  });

  return router;
}
