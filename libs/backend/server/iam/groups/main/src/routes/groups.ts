import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { _RequireOrgAdmin } from "@opencrane/backend/server/infra/auth";

import { createGroup, deleteGroup, getGroup, listGroups, updateGroup } from "../core/groups.logic.js";
import type { GroupWriteRequest } from "./groups.types.js";

/**
 * Create, read, update, and delete the silo's groups.
 *
 * Groups are used for access control and sharing, so mutation operations (create, update, delete)
 * require organisation administrator authority. Read operations remain available to all authenticated
 * users because they need to see groups for sharing and entitlement selection.
 *
 * Called by: apps/opencrane/src/app/routes.ts, mounted at /api/v1/groups on the browser-session
 * authenticated listener.
 * @param prisma - Silo Prisma client.
 * @returns Express router with the five group routes.
 */
export function groupsRouter(prisma: PrismaClient): Router
{
  const router = Router();

  /** List all groups with member counts. */
  router.get("/", async function _listGroups(req, res)
  {
    res.json(await listGroups(prisma));
  });

  /** Get a single group by identifier. */
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

  /** Create a new group — requires organisation administrator authority. */
  router.post("/", _RequireOrgAdmin(), async function _createGroup(req, res)
  {
    const body = req.body as GroupWriteRequest;
    res.status(201).json(await createGroup(prisma, body));
  });

  /** Update a group — requires organisation administrator authority. */
  router.put("/:id", _RequireOrgAdmin(), async function _updateGroup(req, res)
  {
    const body = req.body as Partial<GroupWriteRequest>;
    res.json(await updateGroup(prisma, String(req.params.id), body));
  });

  /** Delete a group — requires organisation administrator authority. */
  router.delete("/:id", _RequireOrgAdmin(), async function _deleteGroup(req, res)
  {
    res.json(await deleteGroup(prisma, String(req.params.id)));
  });

  return router;
}
