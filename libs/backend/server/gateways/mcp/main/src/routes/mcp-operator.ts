import { Router, type Request, type Response } from "express";

import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { _RequireOrgAdmin, _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { approveServer, clearCredential, connectOauth, disconnectOauth, getAccessPolicy, getDirectory, installServer, listAllServers, listEntitledCatalog, listInstalled, publishServer, rejectServer, setAccessPolicy, setCredential, setServerEnabled, uninstallServer } from "../core/mcp-operator.logic";
import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { ___McpAccessPolicySchema, ___McpCredentialSchema, ___McpEnabledSchema, ___McpInstallSchema } from "./mcp-operator.validator";

/**
 * Operator-API router for the MCP endpoints under `/api/v1/mcp/*` — using servers, and governing them.
 *
 * Layers the entitlement-scoped catalogue, per-user installs / credential connect,
 * and org-admin governance + access-policy endpoints over one authenticated authority. Two
 * authorization rules apply:
 *
 * - **User-facing** (`/catalog`, `/installed/*`) — scoped to the calling user via
 *   {@link _ResolveCaller}; entitlement filtering decides catalogue visibility.
 * - **Admin** (`/servers/*`, `/directory`) — gated by `_RequireOrgAdmin` and bound to the
 *   authenticated silo and local Principal projection.
 *
 * Secrets: no response on any route returns credential material — a connected
 * install reports only its connection status (the secret is brokered by the gateway plane).
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Configured Express router.
 */
export function mcpOperatorRouter(unitOfWork: McpOperatorUnitOfWork, principalDirectory: AuthenticatedPrincipalDirectory): Router
{
  const router = Router();

  // -------------------------------------------------------------------------
  // User-facing — entitlement-scoped catalogue + per-user installs
  // -------------------------------------------------------------------------

  /** List the published servers the calling user is entitled to. */
  router.get("/catalog", async function _listCatalog(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    res.json(await listEntitledCatalog(unitOfWork, caller));
  });

  /** List the servers the calling user has installed. */
  router.get("/installed", async function _listInstalled(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    res.json(await listInstalled(unitOfWork, caller.principalId));
  });

  /** Install a catalogue server for the calling user. */
  router.post("/installed", async function _install(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const parsed = ___McpInstallSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "serverId is required", code: "VALIDATION_ERROR" });
      return;
    }

    const installed = await installServer(unitOfWork, caller, parsed.data.serverId);
    if (!installed)
    {
      res.status(404).json({ error: "MCP server not found", code: "MCP_SERVER_NOT_FOUND" });
      return;
    }

    res.status(201).json(installed);
  });

  /** Uninstall a server for the calling user; clears any stored credential. */
  router.delete("/installed/:serverId", async function _uninstall(req: Request<{ serverId: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const removed = await uninstallServer(unitOfWork, caller.principalId, req.params.serverId);
    if (!removed)
    {
      res.status(404).json({ error: "MCP install not found", code: "MCP_INSTALL_NOT_FOUND" });
      return;
    }

    res.status(204).end();
  });

  /** Author a per-user credential (WRITE-ONLY) and mark the install connected. */
  router.put("/installed/:serverId/credential", async function _setCredential(req: Request<{ serverId: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const parsed = ___McpCredentialSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "values must contain at least one non-empty credential", code: "VALIDATION_ERROR" });
      return;
    }
    const installed = await setCredential(unitOfWork, caller.principalId, req.params.serverId, parsed.data);
    _sendInstallOrNotFound(res, installed);
  });

  /** Clear a per-user credential, returning the install to needs-credential. */
  router.delete("/installed/:serverId/credential", async function _clearCredential(req: Request<{ serverId: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const installed = await clearCredential(unitOfWork, caller.principalId, req.params.serverId);
    _sendInstallOrNotFound(res, installed);
  });

  /** Mark a remote-OAuth install connected after a successful handshake. */
  router.post("/installed/:serverId/oauth", async function _connectOauth(req: Request<{ serverId: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const installed = await connectOauth(unitOfWork, caller.principalId, req.params.serverId);
    _sendInstallOrNotFound(res, installed);
  });

  /** Disconnect a remote-OAuth install, returning it to needs-credential. */
  router.delete("/installed/:serverId/oauth", async function _disconnectOauth(req: Request<{ serverId: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const installed = await disconnectOauth(unitOfWork, caller.principalId, req.params.serverId);
    _sendInstallOrNotFound(res, installed);
  });

  // -------------------------------------------------------------------------
  // Admin — governance + access policy (org-admin gated)
  // -------------------------------------------------------------------------

  /** List every catalogue server regardless of status (governance view). Org-admin only. */
  router.get("/servers", _RequireOrgAdmin(), async function _listServers(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    res.json(await listAllServers(unitOfWork, caller));
  });

  /** Approve a server (pending-review → approved). Org-admin only. */
  router.post("/servers/:id/approve", _RequireOrgAdmin(), async function _approve(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    _sendServerOrNotFound(res, await approveServer(unitOfWork, caller, req.params.id));
  });

  /** Publish a server (approved → published). Org-admin only. */
  router.post("/servers/:id/publish", _RequireOrgAdmin(), async function _publish(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    _sendServerOrNotFound(res, await publishServer(unitOfWork, caller, req.params.id));
  });

  /** Reject a server (→ disabled). Org-admin only. */
  router.post("/servers/:id/reject", _RequireOrgAdmin(), async function _reject(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    _sendServerOrNotFound(res, await rejectServer(unitOfWork, caller, req.params.id));
  });

  /** Toggle a server's availability (true → published, false → disabled). Org-admin only. */
  router.post("/servers/:id/enabled", _RequireOrgAdmin(), async function _setEnabled(req: Request<{ id: string }>, res)
  {
    const parsed = ___McpEnabledSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "enabled (boolean) is required", code: "VALIDATION_ERROR" });
      return;
    }

    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    _sendServerOrNotFound(res, await setServerEnabled(unitOfWork, caller, req.params.id, parsed.data.enabled));
  });

  /** Read a server's access policy. Org-admin only. */
  router.get("/servers/:id/access", _RequireOrgAdmin(), async function _getAccess(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const policy = await getAccessPolicy(unitOfWork, caller, req.params.id);
    if (!policy)
    {
      res.status(404).json({ error: "MCP server not found", code: "MCP_SERVER_NOT_FOUND" });
      return;
    }

    res.json(policy);
  });

  /** Replace a server's access policy wholesale. Org-admin only. */
  router.put("/servers/:id/access", _RequireOrgAdmin(), async function _setAccess(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    const parsed = ___McpAccessPolicySchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "groupIds (array) and principalIds (array) are required", code: "VALIDATION_ERROR" });
      return;
    }

    const policy = await setAccessPolicy(unitOfWork, caller, req.params.id, parsed.data);
    if (!policy)
    {
      res.status(404).json({ error: "MCP server not found", code: "MCP_SERVER_NOT_FOUND" });
      return;
    }

    res.json(policy);
  });

  /** List the selectable users and groups for the access editor. Org-admin only. */
  router.get("/directory", _RequireOrgAdmin(), async function _directory(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller)) return;
    res.json(await getDirectory(unitOfWork, caller));
  });

  return router;
}

/**
 * Resolve the calling user's identity + entitlement context from the session.
 *
 * An established session uses the IdP-verified identity. An unauthenticated caller
 * receives an empty fail-closed context and never a synthetic catalogue grant.
 *
 * @param req - Incoming request carrying the optional auth session.
 * @returns The resolved caller context.
 */
async function _ResolveCaller(principalDirectory: AuthenticatedPrincipalDirectory, req: Request): Promise<McpOperatorCaller | null>
{
  // 1. Resolve the verified OIDC subject and trusted request silo without accepting either from
  //    the request body.
  const requestPrincipal = _ResolveRequestPrincipal(req);
  const authUser = req.session?.authUser;
  if (!requestPrincipal || !authUser?.issuer || !authUser.sub)
  {
    return null;
  }

  // 2. Bind the external identity to the durable local Principal. Missing or stale projections
  //    fail closed, so raw OIDC claims never become MCP authority by themselves.
  return principalDirectory.resolveAuthenticatedPrincipal(requestPrincipal.siloId, authUser.issuer, authUser.sub);
}

/**
 * Sends the shared unauthenticated response when local Principal resolution failed.
 *
 * @param res - Express response.
 * @param caller - Resolved local caller, or null when authentication cannot authorize work.
 * @returns True when the route may continue with the caller.
 */
function _SendUnauthorizedWhenMissing(res: Response, caller: McpOperatorCaller | null): caller is McpOperatorCaller
{
  if (caller) return true;
  res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
  return false;
}

/**
 * Send an install response or a 404 when the install / server was absent.
 *
 * @param res - Express response.
 * @param installed - Install payload, or null when not found.
 */
function _sendInstallOrNotFound(res: Response, installed: object | null): void
{
  if (!installed)
  {
    res.status(404).json({ error: "MCP install not found", code: "MCP_INSTALL_NOT_FOUND" });
    return;
  }

  res.json(installed);
}

/**
 * Send a server response or a 404 when the server was absent.
 *
 * @param res - Express response.
 * @param server - Server payload, or null when not found.
 */
function _sendServerOrNotFound(res: Response, server: object | null): void
{
  if (!server)
  {
    res.status(404).json({ error: "MCP server not found", code: "MCP_SERVER_NOT_FOUND" });
    return;
  }

  res.json(server);
}
