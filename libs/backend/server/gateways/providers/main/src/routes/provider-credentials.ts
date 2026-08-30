import { Router } from "express";
import { ModelRoutingScope, type ProviderCredential, type ProviderCredentialWrite } from "@opencrane/contracts";
import type { Prisma, PrismaClient, ProviderCredential as PrismaProviderCredential } from "@prisma/client";

import { ProductAuthorizationActions, ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";

import type { ProviderGatewayAuthorizationFactory, ProviderGatewayCallerResolver } from "../provider-gateway-authority.types";
import { _GrantProviderResourceCreatorUse, _RequireProviderGatewayAdministration, _RequireProviderGatewayCaller, _ResolveProviderGatewayCaller, _SendProviderGatewayAuthorizationError } from "../provider-gateway-authorization";
import { _ByokProviderConnectionId } from "../provider-resource-identity";
import { PrismaProviderGatewayUnitOfWork } from "../prisma-provider-gateway-unit-of-work";

/** Raw-key field names that must never be accepted or stored (keys live in k8s Secrets). */
const _RAW_KEY_FIELDS = ["apiKey", "keyValue", "key"] as const;

/**
 * Convert a stored provider-credential row into the contract shape the API returns. The Prisma
 * enum values map 1:1 to the lowercase {@link ModelRoutingScope} string union.
 *
 * Only the Secret's NAME (`secretRef`) is carried out, never a key — there is no key on the row
 * to leak in the first place.
 *
 * @param row - The persisted `ProviderCredential` row.
 * @returns The contract-shaped credential (timestamps as ISO-8601 strings).
 */
function _toContract(row: PrismaProviderCredential): ProviderCredential
{
  return {
    id: row.id,
    scope: row.scope === "ClusterTenant" ? ModelRoutingScope.ClusterTenant : ModelRoutingScope.Global,
    clusterTenant: row.clusterTenant,
    provider: row.provider,
    secretRef: row.secretRef,
    litellmCredentialName: row.litellmCredentialName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Map a contract scope string to the Prisma `ModelRoutingScope` enum value. */
function _toPrismaScope(scope: ModelRoutingScope): "Global" | "ClusterTenant"
{
  return scope === ModelRoutingScope.ClusterTenant ? "ClusterTenant" : "Global";
}

/**
 * Check an untrusted {@link ProviderCredentialWrite} body, in this order:
 *   1. reject the request outright if it carries any raw-key field (`apiKey`, `keyValue`, `key`) —
 *      this endpoint stores only a `secretRef`, and the key itself belongs in a Kubernetes Secret;
 *   2. require `provider` and `secretRef`;
 *   3. require `clusterTenant` when the scope is `clusterTenant`, and reject any other scope value.
 *
 * The raw-key check runs first on purpose, so a request that would have leaked a key into Postgres
 * is refused before any other reason can mask it.
 *
 * @param body - The untrusted request body.
 * @returns `null` when the body is acceptable; otherwise `{ error, code }` — `RAW_KEY_REJECTED`
 *          for a raw key, `VALIDATION_ERROR` for everything else. The route sends it as the 400
 *          body unchanged.
 */
function _validateWrite(body: Record<string, unknown>): { error: string; code: string } | null
{
  // 1. Reject any raw-key field outright — OpenCrane stores only a `secretRef`, never the key.
  for (const field of _RAW_KEY_FIELDS)
  {
    if (body[field] !== undefined)
    {
      return { error: `Raw key field '${field}' is not accepted; pass 'secretRef' instead (the key lives in a k8s Secret).`, code: "RAW_KEY_REJECTED" };
    }
  }

  // 2. `provider` and `secretRef` are always required.
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  const secretRef = typeof body.secretRef === "string" ? body.secretRef.trim() : "";
  if (!provider || !secretRef)
  {
    return { error: "provider and secretRef are required.", code: "VALIDATION_ERROR" };
  }

  // 3. When scoped to a ClusterTenant, the owning clusterTenant key is mandatory.
  const scope = body.scope ?? ModelRoutingScope.Global;
  if (scope === ModelRoutingScope.ClusterTenant && !(typeof body.clusterTenant === "string" && body.clusterTenant.trim()))
  {
    return { error: "clusterTenant is required when scope is 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }
  if (scope !== ModelRoutingScope.Global && scope !== ModelRoutingScope.ClusterTenant)
  {
    return { error: "scope must be 'global' or 'clusterTenant'.", code: "VALIDATION_ERROR" };
  }

  return null;
}

/**
 * CRUD router for {@link ProviderCredential} — provider API credential *references*.
 *
 * Credentials are owned at installation or ClusterTenant scope. The body carries only a
 * `secretRef` (the External-Secrets-synced Kubernetes
 * Secret name) plus an optional `litellmCredentialName`; a request carrying a raw key is
 * rejected with 400. Reads filter exact `ProviderConnection` grants; mutations explicitly admit
 * the silo's `Organization/Administer` capability in the transaction that writes the reference.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Configured Express router.
 */
export function providerCredentialsRouter(prisma: PrismaClient, resolveCaller: ProviderGatewayCallerResolver = _ResolveProviderGatewayCaller, createAuthorization?: ProviderGatewayAuthorizationFactory<Prisma.TransactionClient>): Router
{
  const router = Router();
	const providers = new PrismaProviderGatewayUnitOfWork(prisma, createAuthorization);

  /** List provider credentials, optionally filtered to one ClusterTenant. */
  router.get("/", async function _listProviderCredentials(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const clusterTenant = typeof req.query.clusterTenant === "string" ? req.query.clusterTenant : undefined;
	const rows = await providers.run(async function _List(transaction, authorization)
	{
		const candidates = await transaction.providerCredential.findMany({ where: { siloId: caller.siloId, ...(clusterTenant ? { clusterTenant } : {}) }, orderBy: { createdAt: "asc" } });
		const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: candidates.map(row => ({ kind: ProductAuthorizationResourceKinds.ProviderConnection, id: row.id })), nowEpochMs: Date.now() });
		const entitledIds = new Set(entitled.map(resource => resource.id));
		return candidates.filter(row => entitledIds.has(row.id));
	});
    res.json(rows.map(_toContract));
  });

  /** Get a single provider credential by id. */
  router.get("/:id", async function _getProviderCredential(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	const row = await providers.run(async function _Get(transaction, authorization)
	{
		const candidate = await transaction.providerCredential.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
		if (candidate === null)
			return null;
		const entitled = await authorization.listPrincipalEntitled({ siloId: caller.siloId, principalId: caller.principalId, action: ProductAuthorizationActions.Read, resources: [{ kind: ProductAuthorizationResourceKinds.ProviderConnection, id: candidate.id }], nowEpochMs: Date.now() });
		return entitled.length === 1 ? candidate : null;
	});
    if (!row)
    {
      res.status(404).json({ error: "Provider credential not found", code: "PROVIDER_CREDENTIAL_NOT_FOUND" });
      return;
    }
    res.json(_toContract(row));
  });

  /** Create a provider credential (reference only — never a raw key). */
  router.post("/", async function _createProviderCredential(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1. Validate identity + the raw-key rejection up front before touching the DB.
    const error = _validateWrite(body);
    if (error)
    {
      res.status(400).json(error);
      return;
    }

    // 2. Persist the reference row; default scope to Global when omitted.
    const write = body as unknown as ProviderCredentialWrite;
    const scope = write.scope ?? ModelRoutingScope.Global;
	try
	{
		const created = await providers.runDatabaseMutation(async function _Create(transaction, authorization)
		{
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "create-provider-credential", write });
			const provider = write.provider.trim();
			const id = scope === ModelRoutingScope.Global ? _ByokProviderConnectionId(caller.siloId, provider) : undefined;
			const credential = await transaction.providerCredential.create({ data: { id, siloId: caller.siloId, scope: _toPrismaScope(scope), clusterTenant: scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null, provider, secretRef: write.secretRef.trim(), litellmCredentialName: write.litellmCredentialName?.trim() || null } });
			await _GrantProviderResourceCreatorUse(authorization, caller, { kind: ProductAuthorizationResourceKinds.ProviderConnection, id: credential.id }, new Date());
			return credential;
		});
		res.status(201).json(_toContract(created));
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  /** Update a provider credential. */
  router.put("/:id", async function _updateProviderCredential(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 1. Validate the full replacement body, including the raw-key rejection.
    const error = _validateWrite(body);
    if (error)
    {
      res.status(400).json(error);
      return;
    }

    // 2. Apply the validated fields; scope defaults to Global when omitted.
    const write = body as unknown as ProviderCredentialWrite;
    const scope = write.scope ?? ModelRoutingScope.Global;
	try
	{
		const updated = await providers.runDatabaseMutation(async function _Update(transaction, authorization)
		{
			const existing = await transaction.providerCredential.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
			if (existing === null)
				return null;
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "update-provider-credential", id: existing.id, write });
			const data: Prisma.ProviderCredentialUpdateInput = { scope: _toPrismaScope(scope), clusterTenant: scope === ModelRoutingScope.ClusterTenant ? write.clusterTenant!.trim() : null, provider: write.provider.trim(), secretRef: write.secretRef.trim(), litellmCredentialName: write.litellmCredentialName?.trim() || null };
			return transaction.providerCredential.update({ where: { id_siloId: { id: existing.id, siloId: caller.siloId } }, data });
		});
		if (updated === null)
		{
			res.status(404).json({ error: "Provider credential not found", code: "PROVIDER_CREDENTIAL_NOT_FOUND" });
			return;
		}
		res.json(_toContract(updated));
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  /** Delete a provider credential. */
  router.delete("/:id", async function _deleteProviderCredential(req, res)
  {
	const caller = _RequireProviderGatewayCaller(req, res, resolveCaller);
	if (caller === null)
		return;
	try
	{
		const deleted = await providers.runDatabaseMutation(async function _Delete(transaction, authorization)
		{
			const existing = await transaction.providerCredential.findUnique({ where: { id_siloId: { id: req.params.id, siloId: caller.siloId } } });
			if (existing === null)
				return false;
			await _RequireProviderGatewayAdministration(authorization, caller, { operation: "delete-provider-credential", id: existing.id });
			await transaction.providerCredential.delete({ where: { id_siloId: { id: existing.id, siloId: caller.siloId } } });
			return true;
		});
		if (!deleted)
		{
			res.status(404).json({ error: "Provider credential not found", code: "PROVIDER_CREDENTIAL_NOT_FOUND" });
			return;
		}
		res.json({ id: req.params.id, status: "deleted" });
	}
	catch (caught)
	{
		if (!_SendProviderGatewayAuthorizationError(caught, res))
			throw caught;
	}
  });

  return router;
}
