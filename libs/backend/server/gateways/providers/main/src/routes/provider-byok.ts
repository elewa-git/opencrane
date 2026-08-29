import { Router } from "express";
import * as k8s from "@kubernetes/client-node";
import { ByokProvider, type ProviderKeyStatus } from "@opencrane/contracts";
import type { Prisma, PrismaClient, ProviderCredential as PrismaProviderCredential } from "@prisma/client";
import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import { _log } from "../log";
import { _DeprovisionByokKey, _ProvisionByokKey } from "@opencrane/backend/server/gateways/model-routing";
import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "../provider-gateway-authority.types";
import { _RequireProviderGatewayAdministration, _RequireProviderGatewayCaller, _ResolveProviderGatewayCaller, _SendProviderGatewayAuthorizationError } from "../provider-gateway-authorization";
import { PrismaProviderGatewayUnitOfWork } from "../prisma-provider-gateway-unit-of-work";

/** The providers a raw BYOK key may be set for; mirrors the {@link ByokProvider} contract union. */
const _BYOK_PROVIDERS = Object.values(ByokProvider) as readonly string[];

/** Build the stable governed connection id for one silo-wide BYOK provider. */
function _ByokProviderConnectionId(provider: string): string
{
	return `byok:${provider}`;
}

/**
 * Build the read-only status for one provider from its credential row, or from the absence of one.
 *
 * `configured` says a key is set; `litellmRegistered` says LiteLLM also accepted it. The second can
 * be false while the first is true — the key is then in its Kubernetes Secret only, and models
 * bound to the credential name will not resolve until a later set succeeds. No key material is
 * ever included.
 *
 * @param provider - The provider this status describes.
 * @param row      - The persisted credential row, or undefined when no key is set.
 * @returns The status DTO: provider, whether a key is set, whether LiteLLM took it, and when it
 *          last changed.
 */
function _toStatus(provider: string, row: PrismaProviderCredential | undefined): ProviderKeyStatus
{
  return {
    provider: provider as ByokProvider,
    configured: Boolean(row),
    litellmRegistered: Boolean(row?.litellmCredentialName),
    updatedAt: row ? row.updatedAt.toISOString() : null,
  };
}

/**
 * Router for BYOK provider keys — set/refresh/remove a RAW upstream provider key for this silo.
 *
 * Unlike {@link providerCredentialsRouter} (reference-only, raw keys rejected), this is the BYOK
 * "dynamic no-restart path". The provisioning work (Secret write + LiteLLM `/credentials` + the
 * Global ProviderCredential row + default-model seed) lives in {@link _ProvisionByokKey} so the
 * boot-time bootstrap can reuse it; this router is the HTTP wrapper (validation + status DTO).
 * Reads return presence + timestamps only — the key is never echoed back.
 *
 * The silo-wide key spends real money and backs every model call. Reads filter stable BYOK
 * `ProviderConnection` resources; mutations explicitly admit the silo's
 * `Organization/Administer` capability before any custody or registration effect.
 *
 * @param prisma            - Prisma client used for the credential record.
 * @param coreApi           - Kubernetes Core V1 API client for Secret writes.
 * @param operatorNamespace - The operator's own namespace; where the key Secret is written.
 * @returns Configured Express router.
 */
export function providerByokRouter(prisma: PrismaClient, coreApi: k8s.CoreV1Api, operatorNamespace: string, resolveCaller: ProviderGatewayCallerResolver = _ResolveProviderGatewayCaller, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>): Router
{
  const router = Router();
	const providers = new PrismaProviderGatewayUnitOfWork(prisma, createAuthorization);

  /** List BYOK key status for every supported provider (presence + timestamps, no key material). */
  router.get("/", async function _listProviderKeys(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	const result = await providers.run(async function _List(transaction, authorization)
	{
		const resources = _BYOK_PROVIDERS.map(provider => ({ kind: ProductAuthorizationResourceKinds.ProviderConnection, id: _ByokProviderConnectionId(provider) }));
		const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources, nowEpochMs: Date.now() });
		const entitledProviders = new Set(entitled.map(resource => resource.id.slice("byok:".length)));
		const rows = await transaction.providerCredential.findMany({ where: { scope: "Global", clusterTenant: null, provider: { in: [...entitledProviders] } } });
		return { entitledProviders, rows };
	});
	const rows = result.rows;
    const byProvider = new Map(rows.map(function _byProvider(row) { return [row.provider, row]; }));
	res.json(_BYOK_PROVIDERS.filter(provider => result.entitledProviders.has(provider)).map(function _status(provider) { return _toStatus(provider, byProvider.get(provider)); }));
  });

  /** Set or refresh a provider's raw key (delegates the provisioning to {@link _ProvisionByokKey}). */
  router.put("/:provider", async function _setProviderKey(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const provider = String(req.params.provider ?? "").trim().toLowerCase();
    if (!_BYOK_PROVIDERS.includes(provider))
    {
      res.status(400).json({ error: `Unsupported provider '${provider}'. Supported: ${_BYOK_PROVIDERS.join(", ")}.`, code: "UNSUPPORTED_PROVIDER" });
      return;
    }
    const apiKey = String((req.body ?? {}).apiKey ?? "").trim();
    if (!apiKey)
    {
      res.status(400).json({ error: "apiKey is required.", code: "VALIDATION_ERROR" });
      return;
    }

	try
	{
		const { litellmRegistered, row } = await providers.run(async function _Set(transaction, authorization)
		{
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "set-byok-provider", provider });
			return _ProvisionByokKey({ prisma: transaction, coreApi, operatorNamespace, provider, apiKey, log: _log });
		});
		_log.info({ provider, litellmRegistered }, "byok provider key set");
		res.json(_toStatus(provider, row));
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  /** Remove a provider's key (delegates to {@link _DeprovisionByokKey}). */
  router.delete("/:provider", async function _deleteProviderKey(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const provider = String(req.params.provider ?? "").trim().toLowerCase();
    if (!_BYOK_PROVIDERS.includes(provider))
    {
      res.status(400).json({ error: `Unsupported provider '${provider}'. Supported: ${_BYOK_PROVIDERS.join(", ")}.`, code: "UNSUPPORTED_PROVIDER" });
      return;
    }

	try
	{
		await providers.run(async function _Delete(transaction, authorization)
		{
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "delete-byok-provider", provider });
			await _DeprovisionByokKey({ prisma: transaction, coreApi, operatorNamespace, provider });
		});
		_log.info({ provider }, "byok provider key removed");
		res.status(204).send();
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  return router;
}
