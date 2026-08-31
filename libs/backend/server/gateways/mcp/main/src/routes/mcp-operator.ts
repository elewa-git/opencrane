import { Router, type NextFunction, type Request, type Response } from "express";

import type { AuthenticatedPrincipalDirectory } from "@opencrane/backend/server/iam/identity";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import { McpOperatorAuthorizationError } from "../core/mcp-operator-authorization";
import { approveServer, installServer, listAllServers, listEntitledCatalog, listInstalled, publishServer, rejectServer, setServerEnabled, uninstallServer } from "../core/mcp-operator.logic";
import type { McpOperatorCaller } from "../core/mcp-operator.logic.types";
import type { McpOperatorUnitOfWork } from "../core/mcp-operator-repository.types";
import { McpRemoteServerRegistrationValidationError, registerRemoteServer } from "../era-probe/mcp-remote-registration";
import { ___McpRemoteServerRegistrationSchema } from "../era-probe/mcp-remote-registration.validator";
import { McpRemoteServerRegistrationOutcomes } from "../era-probe/mcp-era-probe.types";
import type { McpEraProbeWorkflow } from "../era-probe/mcp-era-probe.types";
import { getOciImageValidation, submitOciImageValidation } from "../oci-image-validation/oci-image-validation-submission";
import { OciImageValidationSubmissionOutcomes } from "../oci-image-validation/oci-image-validation-submission.types";
import type { OciImageLayoutArtifactResolver } from "../oci-image-validation/oci-image-validation-submission.types";
import type { OciImageValidationWorkflow } from "../oci-image-validation/oci-image-validation.types";
import { ___OciImageValidationIdSchema, ___OciImageValidationSubmissionSchema } from "../oci-image-validation/oci-image-validation-submission.validator";
import { ___McpEnabledSchema, ___McpInstallSchema } from "./mcp-operator.validator";

/**
 * Operator-API router for the MCP endpoints under `/api/v1/mcp/*` — using servers, and governing them.
 *
 * Serves the entitlement-scoped catalog, per-Principal installs, and organization-admin governance
 * endpoints from the same authenticated authority. Two authorization rules apply:
 *
 * - **User-facing** (`/catalog`, `/installed/*`) — {@link _ResolveCaller} binds the request to a
 *   local Principal before entitlement filtering or install work begins.
 * - **Governance** (`/servers/*`) — asks the transaction-bound central authority for the current
 *   `Organization/Administer` grant and binds the decision to the local Principal projection.
 *
	 * @param unitOfWork - Runs each MCP operation with transaction-scoped repositories.
	 * @param principalDirectory - Resolves the authenticated identity to a local Principal in its silo.
	 * @param eraProbeWorkflow - Runs the saved protocol check admitted with a server registration.
 * @param ociImageValidationWorkflow - Saves the background job that verifies an uploaded OCI image.
 * @param ociImageArtifacts - Resolves exact artifact facts inside the authenticated silo.
 * @returns Configured Express router.
 */
export function mcpOperatorRouter(unitOfWork: McpOperatorUnitOfWork, principalDirectory: AuthenticatedPrincipalDirectory, eraProbeWorkflow: McpEraProbeWorkflow, ociImageValidationWorkflow: OciImageValidationWorkflow, ociImageArtifacts: OciImageLayoutArtifactResolver): Router
{
  const router = Router();

  // -------------------------------------------------------------------------
  // User-facing — entitlement-scoped catalogue + per-user installs
  // -------------------------------------------------------------------------

  /** List the published servers the calling user is entitled to. */
  router.get("/catalog", async function _listCatalog(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    res.json(await listEntitledCatalog(unitOfWork, caller));
  });

  /** List the servers the calling user has installed. */
  router.get("/installed", async function _listInstalled(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    res.json(await listInstalled(unitOfWork, caller.principalId));
  });

  /** Install a catalogue server for the calling user. */
  router.post("/installed", async function _install(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
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

  /** Removes the calling Principal's install and returns 404 when that Principal has none. */
  router.delete("/installed/:serverId", async function _uninstall(req: Request<{ serverId: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    const removed = await uninstallServer(unitOfWork, caller, req.params.serverId);
    if (removed === "not_found")
    {
      res.status(404).json({ error: "MCP install not found", code: "MCP_INSTALL_NOT_FOUND" });
      return;
    }

    res.status(204).end();
  });

  // -------------------------------------------------------------------------
  // Governance
  // -------------------------------------------------------------------------

  /** List every catalogue server after a current Organization/Administer grant check. */
  router.get("/servers", async function _listServers(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    res.json(await listAllServers(unitOfWork, caller));
  });

	 /** Register a remote server and its era-probe task after a current Organization/Administer grant check. */
  router.post("/servers", async function _registerServer(req, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    const parsed = ___McpRemoteServerRegistrationSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "Remote MCP registration is invalid.", code: "VALIDATION_ERROR" });
      return;
    }

    try
    {
      const result = await registerRemoteServer(unitOfWork, eraProbeWorkflow, caller, parsed.data);
      if (result.outcome === McpRemoteServerRegistrationOutcomes.Conflict)
      {
        res.status(409).json({ error: "The registration key or server name is already used by different input.", code: "MCP_REGISTRATION_CONFLICT" });
        return;
      }
      res.status(201).json(result.server);
    }
    catch (error)
    {
      if (!(error instanceof McpRemoteServerRegistrationValidationError))
        throw error;
      res.status(400).json({ error: error.message, code: "VALIDATION_ERROR" });
    }
  });

	/** Submit one published OCI image-layout artifact after a current Organization/Administer grant check. */
	router.post("/oci-image-validations", async function _SubmitOciImageValidation(req, res)
	{
		const caller = await _ResolveCaller(principalDirectory, req);
		if (!_SendUnauthorizedWhenMissing(res, caller))
			return;
		const parsed = ___OciImageValidationSubmissionSchema.safeParse(req.body);
		if (!parsed.success)
		{
			res.status(400).json({ error: "OCI image validation fields are invalid.", code: "VALIDATION_ERROR" });
			return;
		}
		const result = await submitOciImageValidation(unitOfWork, ociImageValidationWorkflow, ociImageArtifacts, caller, parsed.data);
		if (result.outcome !== OciImageValidationSubmissionOutcomes.Submitted)
		{
			if (result.outcome === OciImageValidationSubmissionOutcomes.ArtifactNotFound)
			{
				res.status(404).json({ error: "OCI image artifact revision not found.", code: "OCI_IMAGE_ARTIFACT_NOT_FOUND" });
				return;
			}
			res.status(409).json({ error: "The submission key is already used by different input.", code: "OCI_IMAGE_VALIDATION_CONFLICT" });
			return;
		}
		res.status(201).json(result.validation);
	});

	/** Return one saved OCI image admission result after a current Organization/Administer grant check. */
	router.get("/oci-image-validations/:id", async function _GetOciImageValidation(req: Request<{ id: string }>, res)
	{
		const caller = await _ResolveCaller(principalDirectory, req);
		if (!_SendUnauthorizedWhenMissing(res, caller))
			return;
		if (!___OciImageValidationIdSchema.safeParse(req.params.id).success)
		{
			res.status(400).json({ error: "OCI image validation id is invalid.", code: "VALIDATION_ERROR" });
			return;
		}
		const validation = await getOciImageValidation(unitOfWork, caller, req.params.id);
		if (validation === null)
		{
			res.status(404).json({ error: "OCI image validation not found.", code: "OCI_IMAGE_VALIDATION_NOT_FOUND" });
			return;
		}
		res.json(validation);
	});

	 /** Approve a server after its saved protocol check and current Organization/Administer grant checks succeed. */
  router.post("/servers/:id/approve", async function _approve(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    _sendServerOrNotFound(res, await approveServer(unitOfWork, caller, req.params.id));
  });

  /** Publish a server after its saved protocol check and current Organization/Administer grant checks succeed. */
  router.post("/servers/:id/publish", async function _publish(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    _sendServerOrNotFound(res, await publishServer(unitOfWork, caller, req.params.id));
  });

  /** Disable a server after a current Organization/Administer grant check; no prior status is required. */
  router.post("/servers/:id/reject", async function _reject(req: Request<{ id: string }>, res)
  {
    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    _sendServerOrNotFound(res, await rejectServer(unitOfWork, caller, req.params.id));
  });

  /** Disable or restore a server after a current Organization/Administer grant check. */
  router.post("/servers/:id/enabled", async function _setEnabled(req: Request<{ id: string }>, res)
  {
    const parsed = ___McpEnabledSchema.safeParse(req.body);
    if (!parsed.success)
    {
      res.status(400).json({ error: "enabled (boolean) is required", code: "VALIDATION_ERROR" });
      return;
    }

    const caller = await _ResolveCaller(principalDirectory, req);
    if (!_SendUnauthorizedWhenMissing(res, caller))
      return;
    _sendServerOrNotFound(res, await setServerEnabled(unitOfWork, caller, req.params.id, parsed.data.enabled));
  });

  router.use(function _SendMcpAuthorizationError(error: unknown, _req: Request, res: Response, next: NextFunction): void
  {
    if (!(error instanceof McpOperatorAuthorizationError) && (!(error instanceof Error) || error.name !== "McpOperatorAuthorizationError"))
    {
      next(error);
      return;
    }
    res.status(403).json({ error: error.message, code: "FORBIDDEN" });
  });

  return router;
}

/**
 * Resolves the request into the caller's authenticated silo and local Principal.
 *
 * The request must carry a verified identity and trusted silo, then the directory must resolve that
 * identity to a persisted Principal. Returning `null` makes every route send 401 instead of using
 * request claims as MCP authorization.
 *
 * @param principalDirectory - Resolves the verified identity to a local Principal.
 * @param req - Carries the authenticated session and resolved request silo.
 * @returns The authenticated caller context, or `null` when local Principal resolution fails.
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
  if (caller)
    return true;
  res.status(401).json({ error: "Authentication required.", code: "UNAUTHORIZED" });
  return false;
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
