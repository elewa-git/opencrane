import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { createGroup, deleteGroup, getGroup, listGroups, updateGroup } from "../core/groups.logic.js";
import type { GroupWriteRequest } from "./groups.types.js";

/**
 * Create, read, update, and delete the silo's groups.
 *
 * The handlers do no authorization of their own — whatever the mount point applies is all there is.
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

  /** Create a new group. */
  router.post("/", async function _createGroup(req, res)
  {
    const body = req.body as GroupWriteRequest;
    res.status(201).json(await createGroup(prisma, body));
  });

  /** Update a group. */
  router.put("/:id", async function _updateGroup(req, res)
  {
    const body = req.body as Partial<GroupWriteRequest>;
    res.json(await updateGroup(prisma, req.params.id, body));
  });

  /** Delete a group. */
  router.delete("/:id", async function _deleteGroup(req, res)
  {
    res.json(await deleteGroup(prisma, req.params.id));
  });

  return router;
}
