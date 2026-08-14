import { IntegrationState, type PrismaClient } from "@prisma/client";
import { Router, type Request, type Response } from "express";

import { _RequireOrgAdmin, _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { ObotCustodyCredential, ObotCustodyPort } from "@opencrane/backend/server/infra/obot-custody";

import { __ProvisionIntegrationCustody } from "./integration-custody-provisioning";
import { PrismaIntegrationCustodyRepository } from "./prisma-integration-custody-repository";
import type { IntegrationCustodyLogger } from "./integration-custody-provisioning.types";
import type { ProvisionIntegrationCustodyRequestBody } from "./integration-custody.router.types";

/** Longest accepted identifier at this route boundary. */
const _MAX_IDENTIFIER_LENGTH = 256;

/** Most credential entries one provisioning request may carry. */
const _MAX_CREDENTIAL_ENTRIES = 64;

/** Longest accepted single credential value. */
const _MAX_CREDENTIAL_VALUE_LENGTH = 32 * 1024;

/** Return whether a route identifier is a bounded non-empty string. */
function _isBoundedIdentifier(value: unknown): value is string
{
	return typeof value === "string" && value.trim().length > 0 && value.length <= _MAX_IDENTIFIER_LENGTH;
}

/** Validate one untrusted credential entry without ever echoing its value. */
function _isCredentialEntry(value: unknown): value is ObotCustodyCredential
{
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const entry = value as Record<string, unknown>;
	return _isBoundedIdentifier(entry["name"]) && typeof entry["value"] === "string" && entry["value"].length > 0 && entry["value"].length <= _MAX_CREDENTIAL_VALUE_LENGTH;
}

/** Validate the untrusted request body into the exact write-only provisioning shape. */
function _parseBody(body: unknown): ProvisionIntegrationCustodyRequestBody | null
{
	if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const record = body as Record<string, unknown>;
	const credential = record["credential"];
	if (!_isBoundedIdentifier(record["obotCatalogEntryId"]) || !Array.isArray(credential) || credential.length === 0 || credential.length > _MAX_CREDENTIAL_ENTRIES || !credential.every(_isCredentialEntry)) return null;
	return { obotCatalogEntryId: record["obotCatalogEntryId"], credential: credential as readonly ObotCustodyCredential[] };
}

/** Write one bounded JSON problem response that never contains request content. */
function _respond(response: Response, status: number, error: string): void
{
	response.status(status).json({ error });
}

/**
 * Create the org-admin custody provisioning router for silo-scoped integrations.
 *
 * `POST /:integrationId/custody` hands the supplied credential to Obot for keeping and records only
 * the Obot-minted opaque reference. Authorization mirrors the sibling MCP catalogue routes
 * (`_RequireOrgAdmin`), and the integration must exist in the caller's silo, be active, and name
 * the exact catalogue entry the request claims — otherwise the route answers 404 without contacting
 * Obot. The response carries the provisioning outcome only; the credential is never echoed, logged,
 * or persisted by this process.
 *
 * @param prisma - Prisma client for the product database.
 * @param custody - Obot custody port; when Obot is switched off this is the adapter that always
 *                  fails, so the route reports unavailable rather than silently doing nothing.
 * @param logger - Logger for failure records that carry ids and an error class name, never a secret.
 * @returns The configured Express router, mounted under `/api/v1/integrations`.
 */
export function _CreateIntegrationCustodyRouter(prisma: PrismaClient, custody: ObotCustodyPort, logger: IntegrationCustodyLogger): Router
{
	const router = Router();
	const repository = new PrismaIntegrationCustodyRepository(prisma);

	router.post("/:integrationId/custody", _RequireOrgAdmin(), async function _provisionCustody(request: Request, response: Response)
	{
		// 1. Bind the call to the authenticated caller's silo; the silo is never request input.
		const principal = _ResolveRequestPrincipal(request);
		if (principal === null) { _respond(response, 401, "authentication_required"); return; }

		// 2. Check the integration id and the credential entries are well formed before any database or Obot call.
		const integrationId = request.params["integrationId"];
		const body = _parseBody(request.body);
		if (!_isBoundedIdentifier(integrationId) || body === null) { _respond(response, 400, "invalid_custody_request"); return; }

		// 3. Require an active same-silo integration naming this exact catalogue entry, so a foreign
		// or retired integration can never cause a remote Obot server to be configured.
		const integration = await prisma.integration.findUnique({ where: { id: integrationId } });
		if (integration === null || integration.siloId !== principal.siloId || integration.state !== IntegrationState.Active || integration.obotCatalogEntryId !== body.obotCatalogEntryId)
		{
			_respond(response, 404, "integration_not_found");
			return;
		}

		// 4. Provision remotely with compensation; the outcome (never the credential) is the response.
		const result = await __ProvisionIntegrationCustody(custody, repository, logger, { siloId: principal.siloId, integrationId, obotCatalogEntryId: body.obotCatalogEntryId, credential: body.credential });
		if (result.outcome === "provisioned")
		{
			response.status(201).json({ outcome: result.outcome, custodyReferenceId: result.custodyReferenceId });
			return;
		}
		response.status(503).json({ outcome: result.outcome, reason: result.reason });
	});

	return router;
}
