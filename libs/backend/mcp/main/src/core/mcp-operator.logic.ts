import { McpApprovalStatus, McpConnectionStatus, McpServerType, type CredentialField, type Directory, type EntitledUser, type McpAccessPolicy, type McpCatalogServer, type McpInstalled } from "@opencrane/contracts";
import { GrantAccess, GrantPayloadType, GrantScope, GrantSubjectType, Prisma, type PrismaClient } from "@prisma/client";

import { ___SortBy } from "@opencrane/util";
import type { McpAccessPolicyRequest } from "../routes/mcp-operator.types.js";
import type { ObotManagementClient, ObotServerMode, ObotServerReadiness, ObotServerRef } from "./obot-client.types.js";
import { compileForPrincipals, GrantCompilerAccess, GrantCompilerPayloadType, GRANT_ORG_EVERYONE_SUBJECT_ID } from "@opencrane/backend/grants";

/** Per-user install row returned by the install/connect mutations. */
type _McpInstallRow = Prisma.McpServerInstallGetPayload<object>;

/**
 * Identity + entitlement context of the caller of a user-facing endpoint.
 *
 * `devOpen` mirrors the platform's fail-open dev posture: when no session is
 * established and no real auth is configured, the caller sees the full published
 * catalogue so a fresh local install / the OPEN dev backend isn't locked out.
 */
export interface McpOperatorCaller
{
  /** Stable caller identifier (`authUser.sub ?? authUser.email`, or a dev fallback). */
  userId: string;
  /** IdP-verified group claims used for group-based entitlement. */
  groups: string[];
  /** True only when unauthenticated under dev-auth-mode — bypasses entitlement filtering. */
  devOpen: boolean;
}

/** Typed Prisma `McpServerType` values (member names, not the @map'd DB labels). */
const _PRISMA_SERVER_TYPE = {
  SingleUser: "SingleUser",
  MultiUser: "MultiUser",
  RemoteOauth: "RemoteOauth",
} as const;

/** Typed Prisma `McpApprovalStatus` values used during runtime lookups. */
const _PRISMA_APPROVAL_STATUS = {
  PendingReview: "PendingReview",
  Approved: "Approved",
  Published: "Published",
  Disabled: "Disabled",
} as const;

/** Typed Prisma `McpConnectionStatus` values used during runtime lookups. */
const _PRISMA_CONNECTION_STATUS = {
  NeedsCredential: "NeedsCredential",
  Activating: "Activating",
  Connected: "Connected",
  OauthConnected: "OauthConnected",
  SharedKey: "SharedKey",
  ActivationFailed: "ActivationFailed",
} as const;

/** Contract server-type lookup keyed by Prisma enum values. */
const _TYPE_BY_PRISMA = {
  [_PRISMA_SERVER_TYPE.SingleUser]: McpServerType.SingleUser,
  [_PRISMA_SERVER_TYPE.MultiUser]: McpServerType.MultiUser,
  [_PRISMA_SERVER_TYPE.RemoteOauth]: McpServerType.RemoteOauth,
};

/** Contract approval-status lookup keyed by Prisma enum values. */
const _APPROVAL_BY_PRISMA = {
  [_PRISMA_APPROVAL_STATUS.PendingReview]: McpApprovalStatus.PendingReview,
  [_PRISMA_APPROVAL_STATUS.Approved]: McpApprovalStatus.Approved,
  [_PRISMA_APPROVAL_STATUS.Published]: McpApprovalStatus.Published,
  [_PRISMA_APPROVAL_STATUS.Disabled]: McpApprovalStatus.Disabled,
};

/** Contract connection-status lookup keyed by Prisma enum values. */
const _CONNECTION_BY_PRISMA = {
  [_PRISMA_CONNECTION_STATUS.NeedsCredential]: McpConnectionStatus.NeedsCredential,
  [_PRISMA_CONNECTION_STATUS.Activating]: McpConnectionStatus.Activating,
  [_PRISMA_CONNECTION_STATUS.Connected]: McpConnectionStatus.Connected,
  [_PRISMA_CONNECTION_STATUS.OauthConnected]: McpConnectionStatus.OauthConnected,
  [_PRISMA_CONNECTION_STATUS.SharedKey]: McpConnectionStatus.SharedKey,
  [_PRISMA_CONNECTION_STATUS.ActivationFailed]: McpConnectionStatus.ActivationFailed,
};

/** Deterministic avatar palette indexed by a stable hash of the user identifier. */
const _AVATAR_COLORS = ["#1F3B6E", "#2E7D32", "#6A1B9A", "#C62828", "#00838F", "#EF6C00", "#4527A0", "#283593"];

/**
 * List the catalogue servers the caller may see: published AND entitled.
 *
 * @param prisma - Prisma client used for persistence.
 * @param caller - Identity + entitlement context of the calling user.
 * @returns Published, entitlement-scoped catalogue rows.
 */
export async function listEntitledCatalog(prisma: PrismaClient, caller: McpOperatorCaller): Promise<McpCatalogServer[]>
{
  // 1. Narrow to published servers in the database so disabled/pending rows never
  //    leave the governance boundary. Entitlement is NOT read from the demoted
  //    McpServerAccessPolicy table anymore, so no access-policy include is loaded.
  const servers = await prisma.mcpServer.findMany({
    where: { approvalStatus: _PRISMA_APPROVAL_STATUS.Published as Prisma.McpServerWhereInput["approvalStatus"] },
    orderBy: { createdAt: "desc" },
  });

  // 2. Dev-open posture bypasses entitlement so a fresh local install / the OPEN
  //    dev backend sees the full published catalogue and isn't locked out.
  if (caller.devOpen)
  {
    return servers.map(function _map(server) { return _MapCatalogServer(server); });
  }

  // 3. Derive the entitled server-id set from the generic Grant table — the SOLE
  //    authority for MCP authorization — then keep only the servers the caller
  //    holds an effective Allow on (no grant ⇒ absent ⇒ default-deny).
  const entitledIds = await _CompileEntitledMcpServerIds(prisma, caller);
  return servers
    .filter(function _entitled(server) { return entitledIds.has(server.id); })
    .map(function _map(server) { return _MapCatalogServer(server); });
}

/**
 * List every catalogue server regardless of status — the org-admin governance view.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns All catalogue rows in newest-first order.
 */
export async function listAllServers(prisma: PrismaClient): Promise<McpCatalogServer[]>
{
  const servers = await prisma.mcpServer.findMany({ orderBy: { createdAt: "desc" } });
  return servers.map(function _map(server) { return _MapCatalogServer(server); });
}

/**
 * List the servers the calling user has installed.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @returns The caller's install rows in wire shape.
 */
export async function listInstalled(prisma: PrismaClient, userId: string): Promise<McpInstalled[]>
{
  const installs = await prisma.mcpServerInstall.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return installs.map(function _map(install) { return _MapInstalled(install); });
}

/**
 * Install a catalogue server for the calling user (idempotent per user+server).
 *
 * The initial connection state is derived from the server type: a multi-user
 * server is satisfied by the org-wide shared key immediately (`shared-key`),
 * while every other type starts out needing a per-user credential.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Catalogue server identifier to install.
 * @returns The install row, or null when the server does not exist.
 */
export async function installServer(prisma: PrismaClient, caller: McpOperatorCaller, serverId: string): Promise<McpInstalled | null>
{
  // 1. Confirm the server exists so a bad identifier reads as 404 rather than a
  //    dangling install row pointing at nothing.
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId }, select: { serverType: true, approvalStatus: true } });
  if (!server)
  {
    return null;
  }

  // 2. AUTHORIZE the install: catalogue filtering is NOT authorization. Re-check that
  //    the caller currently holds an effective Allow on a PUBLISHED server, so a
  //    guessed / previously-visible id can't be installed after access is denied or
  //    revoked. A non-entitled server reads as 404 — never leaking its existence.
  //    Dev-open mirrors the catalogue's fail-open local-dev posture.
  if (!caller.devOpen)
  {
    const published = server.approvalStatus === _PRISMA_APPROVAL_STATUS.Published;
    const entitled = published && (await _CompileEntitledMcpServerIds(prisma, caller)).has(serverId);
    if (!entitled)
    {
      return null;
    }
  }

  // 3. Multi-user servers are brokered by an org-wide shared key, so the install
  //    is connected on creation; every other type must author a credential first.
  const initialStatus = server.serverType === _PRISMA_SERVER_TYPE.MultiUser
    ? _PRISMA_CONNECTION_STATUS.SharedKey
    : _PRISMA_CONNECTION_STATUS.NeedsCredential;

  // 4. Upsert so a repeated install is idempotent and never duplicates the row,
  //    leaving an already-connected install untouched.
  const install = await prisma.mcpServerInstall.upsert({
    where: { mcpServerId_userId: { mcpServerId: serverId, userId: caller.userId } },
    create: { mcpServerId: serverId, userId: caller.userId, connectionStatus: initialStatus as Prisma.McpServerInstallCreateInput["connectionStatus"] },
    update: {},
  });

  await _AuditInstall(prisma, "Created", serverId, caller.userId, `MCP server ${serverId} installed for ${caller.userId}`);
  return _MapInstalled(install);
}

/**
 * Uninstall a server for the calling user, clearing any stored credential handle.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @returns True when an install was removed, false when none existed.
 */
export async function uninstallServer(prisma: PrismaClient, userId: string, serverId: string): Promise<boolean>
{
  // 1. Scope the delete to the caller's own install so one user cannot uninstall
  //    another's; a missing row reads as a no-op 404 at the route.
  const result = await prisma.mcpServerInstall.deleteMany({ where: { mcpServerId: serverId, userId } });
  if (result.count === 0)
  {
    return false;
  }

  // 2. Deleting the row drops the credentialRef custody handle with it, so no
  //    further brokering can occur for this user+server.
  await _AuditInstall(prisma, "Deleted", serverId, userId, `MCP server ${serverId} uninstalled for ${userId}`);
  return true;
}

/** Install row joined with the Obot ids its credential flow needs. */
type _McpInstallObotRow = Prisma.McpServerInstallGetPayload<{ select: { id: true, obotInstanceId: true, mcpServer: { select: { serverType: true, obotServerId: true } } } }>;

/** Map a Prisma `McpServerType` to the Obot deployment model. */
function _ModeFromServerType(serverType: string): ObotServerMode
{
  // Multi-user is the only shared (multiUser) model; single-user AND remote-OAuth
  // are per-user (singleUser) Obot deployments.
  return serverType === _PRISMA_SERVER_TYPE.MultiUser ? "multiUser" : "singleUser";
}

/**
 * Resolve the Obot server reference to operate on for an install, or null when the
 * server/instance has not been provisioned in Obot yet.
 *
 * A null result is the fail-closed signal: OpenCrane cannot configure credentials or
 * reconcile OAuth for a server Obot does not yet know about, so the caller marks the
 * install `activation-failed` instead of minting a local handle.
 *
 * @param install - Install row joined with its server's Obot ids.
 * @returns The Obot server ref, or null when not provisioned.
 */
function _ObotServerRefFromInstall(install: _McpInstallObotRow): ObotServerRef | null
{
  const mode = _ModeFromServerType(install.mcpServer.serverType);
  if (mode === "singleUser")
  {
    // A per-user singleUser deployment needs its own Obot instance (created when the
    // install is provisioned in Obot); without it there is nothing to configure.
    if (!install.obotInstanceId)
    {
      return null;
    }
    return { serverId: install.mcpServer.obotServerId ?? "", instanceId: install.obotInstanceId, mode };
  }

  // A shared multiUser server is configured once by an admin; a per-user credential
  // flow only reaches it once the shared server exists in Obot.
  if (!install.mcpServer.obotServerId)
  {
    return null;
  }
  return { serverId: install.mcpServer.obotServerId, mode };
}

/**
 * Map Obot-derived readiness to a per-user install connection status.
 *
 * @param readiness - Readiness Obot reported for the server/instance.
 * @param configuredStatus - The status to use when Obot reports `configured`
 *   (`Connected` for a credential flow, `OauthConnected` for an OAuth flow).
 * @returns The Prisma connection-status value to persist.
 */
function _MapReadinessToStatus(readiness: ObotServerReadiness, configuredStatus: string): string
{
  switch (readiness)
  {
    case "configured":
      return configuredStatus;
    case "deploying":
      return _PRISMA_CONNECTION_STATUS.Activating;
    case "needs-oauth":
    case "missing-headers":
      return _PRISMA_CONNECTION_STATUS.NeedsCredential;
    case "error":
    default:
      return _PRISMA_CONNECTION_STATUS.ActivationFailed;
  }
}

/**
 * Mark an install `activation-failed` and record why, without minting any handle.
 *
 * This is the fail-closed path for every case where OpenCrane cannot obtain a real
 * Obot result (server not provisioned, or the Obot operation threw). It guarantees
 * the #128 invariant: no endpoint reports connected without a successful Obot op.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @param reason - Actionable reason persisted to `lastError` and audited.
 * @returns The updated install row in wire shape.
 */
async function _FailInstallClosed(prisma: PrismaClient, userId: string, serverId: string, reason: string): Promise<McpInstalled>
{
  const install = await prisma.mcpServerInstall.update({
    where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
    data: { connectionStatus: _PRISMA_CONNECTION_STATUS.ActivationFailed as Prisma.McpServerInstallUpdateInput["connectionStatus"], observedState: "error", lastError: reason, credentialRef: null },
  });
  await _AuditInstall(prisma, "Updated", serverId, userId, `MCP credential failed closed for ${userId} on server ${serverId}: ${reason}`);
  return _MapInstalled(install);
}

/** Extract a human-readable message from a thrown value for `lastError`. */
function _ErrMessage(err: unknown): string
{
  return err instanceof Error ? err.message : String(err);
}

/**
 * Configure a per-user credential by sending the WRITE-ONLY material straight to
 * Obot and deriving the connection state from Obot's response.
 *
 * The submitted `secrets` are streamed to Obot and never persisted, logged, or
 * returned. There is no locally minted `cred_*` handle: the install is only marked
 * connected when Obot reports the server `configured`; every other outcome (server
 * not provisioned, Obot error) fails closed to `activation-failed`.
 *
 * @param prisma - Prisma client used for persistence.
 * @param obot - Obot management client (the real HTTP client in production; a mock
 *   in tests; the fail-closed no-op until a live Obot is wired).
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @param secrets - Write-only header/API-key material to hand to Obot.
 * @returns The updated install row, or null when no install exists for the caller.
 */
export async function setCredential(prisma: PrismaClient, obot: ObotManagementClient, userId: string, serverId: string, secrets: Record<string, string>): Promise<McpInstalled | null>
{
  // 1. Require an existing install so credential authoring follows install; a
  //    missing install reads as 404 rather than silently creating one.
  const install = await prisma.mcpServerInstall.findUnique({
    where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
    select: { id: true, obotInstanceId: true, mcpServer: { select: { serverType: true, obotServerId: true } } },
  });
  if (!install)
  {
    return null;
  }

  // 2. Fail closed when Obot does not yet know about this server/instance — we
  //    cannot configure a credential against a server that was never provisioned.
  const serverRef = _ObotServerRefFromInstall(install);
  if (!serverRef)
  {
    return _FailInstallClosed(prisma, userId, serverId, "server is not provisioned in Obot yet — cannot configure credentials");
  }

  // 3. Stream the write-only material to Obot and derive the status from its
  //    response. Nothing secret is persisted, and the install is connected only if
  //    Obot itself reports the server configured.
  try
  {
    const state = await obot.configureServer({ server: serverRef, secrets });
    const status = _MapReadinessToStatus(state.readiness, _PRISMA_CONNECTION_STATUS.Connected);
    const updated = await prisma.mcpServerInstall.update({
      where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
      data: {
        connectionStatus: status as Prisma.McpServerInstallUpdateInput["connectionStatus"],
        observedState: state.readiness,
        connectUrl: state.connectUrl ?? null,
        lastError: state.error ?? null,
        credentialRef: null,
      },
    });
    await _AuditInstall(prisma, "Updated", serverId, userId, `MCP credential configured in Obot for ${userId} on server ${serverId} (state: ${state.readiness})`);
    return _MapInstalled(updated);
  }
  catch (err)
  {
    // 4. A thrown Obot op (including the fail-closed no-op) must never leave the
    //    install looking connected — record the failure and stay activation-failed.
    return _FailInstallClosed(prisma, userId, serverId, `Obot could not configure credentials: ${_ErrMessage(err)}`);
  }
}

/**
 * Clear a per-user credential, returning the install to `needs-credential`.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @returns The updated install row, or null when no install exists for the caller.
 */
export async function clearCredential(prisma: PrismaClient, userId: string, serverId: string): Promise<McpInstalled | null>
{
  return _TransitionInstall(prisma, userId, serverId, _PRISMA_CONNECTION_STATUS.NeedsCredential, true, `MCP credential cleared for ${userId} on server ${serverId}`);
}

/**
 * Mark a remote-OAuth install connected after a successful OAuth handshake.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @returns The updated install row, or null when no install exists for the caller.
 */
export async function connectOauth(prisma: PrismaClient, obot: ObotManagementClient, userId: string, serverId: string): Promise<McpInstalled | null>
{
  // 1. Require an existing install so the OAuth callback targets a real row.
  const install = await prisma.mcpServerInstall.findUnique({
    where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
    select: { id: true, obotInstanceId: true, mcpServer: { select: { serverType: true, obotServerId: true } } },
  });
  if (!install)
  {
    return null;
  }

  // 2. Fail closed when Obot does not yet know about this server/instance.
  const serverRef = _ObotServerRefFromInstall(install);
  if (!serverRef)
  {
    return _FailInstallClosed(prisma, userId, serverId, "server is not provisioned in Obot yet — cannot complete OAuth");
  }

  // 3. Reconcile the OAuth outcome from Obot's live state — there is no locally
  //    minted `oauth_*` handle; the install is oauth-connected only when Obot
  //    reports the server configured after its own handshake.
  try
  {
    const state = await obot.getServerState(serverRef);
    const status = _MapReadinessToStatus(state.readiness, _PRISMA_CONNECTION_STATUS.OauthConnected);
    const updated = await prisma.mcpServerInstall.update({
      where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
      data: {
        connectionStatus: status as Prisma.McpServerInstallUpdateInput["connectionStatus"],
        observedState: state.readiness,
        connectUrl: state.connectUrl ?? null,
        lastError: state.error ?? null,
        credentialRef: null,
      },
    });
    await _AuditInstall(prisma, "Updated", serverId, userId, `MCP OAuth reconciled from Obot for ${userId} on server ${serverId} (state: ${state.readiness})`);
    return _MapInstalled(updated);
  }
  catch (err)
  {
    return _FailInstallClosed(prisma, userId, serverId, `Obot could not confirm OAuth: ${_ErrMessage(err)}`);
  }
}

/**
 * Disconnect a remote-OAuth install, returning it to `needs-credential`.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @returns The updated install row, or null when no install exists for the caller.
 */
export async function disconnectOauth(prisma: PrismaClient, userId: string, serverId: string): Promise<McpInstalled | null>
{
  return _TransitionInstall(prisma, userId, serverId, _PRISMA_CONNECTION_STATUS.NeedsCredential, true, `MCP OAuth disconnected for ${userId} on server ${serverId}`);
}

/**
 * Move a server through the governance lifecycle by setting its approval status.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @param target - The Prisma approval-status value to set.
 * @param message - Audit message describing the transition.
 * @returns The updated server in wire shape, or null when it does not exist.
 */
async function _SetApprovalStatus(prisma: PrismaClient, serverId: string, target: string, message: string): Promise<McpCatalogServer | null>
{
  // 1. Confirm the server exists so a bad identifier reads as 404, not a write.
  const existing = await prisma.mcpServer.findUnique({ where: { id: serverId }, select: { id: true } });
  if (!existing)
  {
    return null;
  }

  // 2. Set the target status and record an audit entry so governance decisions
  //    stay traceable in operator history.
  const server = await prisma.mcpServer.update({
    where: { id: serverId },
    data: { approvalStatus: target as Prisma.McpServerUpdateInput["approvalStatus"] },
  });
  await prisma.auditEntry.create({ data: { action: "Updated", resource: `McpServer/${serverId}`, message } });

  return _MapCatalogServer(server);
}

/**
 * Approve a server (pending-review → approved).
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @returns The updated server, or null when it does not exist.
 */
export async function approveServer(prisma: PrismaClient, serverId: string): Promise<McpCatalogServer | null>
{
  return _SetApprovalStatus(prisma, serverId, _PRISMA_APPROVAL_STATUS.Approved, `MCP server ${serverId} approved`);
}

/**
 * Publish a server (approved → published) so entitled callers can install it.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @returns The updated server, or null when it does not exist.
 */
export async function publishServer(prisma: PrismaClient, serverId: string): Promise<McpCatalogServer | null>
{
  return _SetApprovalStatus(prisma, serverId, _PRISMA_APPROVAL_STATUS.Published, `MCP server ${serverId} published`);
}

/**
 * Reject a server (→ disabled), removing it from the user-facing catalogue.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @returns The updated server, or null when it does not exist.
 */
export async function rejectServer(prisma: PrismaClient, serverId: string): Promise<McpCatalogServer | null>
{
  return _SetApprovalStatus(prisma, serverId, _PRISMA_APPROVAL_STATUS.Disabled, `MCP server ${serverId} rejected`);
}

/**
 * Toggle a server's availability (true → published, false → disabled).
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @param enabled - True publishes; false disables.
 * @returns The updated server, or null when it does not exist.
 */
export async function setServerEnabled(prisma: PrismaClient, serverId: string, enabled: boolean): Promise<McpCatalogServer | null>
{
  const target = enabled ? _PRISMA_APPROVAL_STATUS.Published : _PRISMA_APPROVAL_STATUS.Disabled;
  return _SetApprovalStatus(prisma, serverId, target, `MCP server ${serverId} ${enabled ? "enabled" : "disabled"}`);
}

/**
 * Read a server's access policy, projecting entitled users into the wire shape.
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @returns The access policy (defaults when none is authored), or null when the server is absent.
 */
export async function getAccessPolicy(prisma: PrismaClient, serverId: string): Promise<McpAccessPolicy | null>
{
  // 1. Confirm the server exists so a bad identifier reads as 404, not an empty policy.
  const server = await prisma.mcpServer.findUnique({
    where: { id: serverId },
    include: { accessPolicy: { include: { users: true } } },
  });
  if (!server)
  {
    return null;
  }

  // 2. Project the persisted policy (or empty defaults) into the wire shape.
  return _MapAccessPolicy(serverId, server.accessPolicy);
}

/**
 * Replace a server's access policy wholesale (admin authoritative write).
 *
 * @param prisma - Prisma client used for persistence.
 * @param serverId - Catalogue server identifier.
 * @param body - Full replacement policy (everyoneInOrg + group ids + user ids).
 * @returns The persisted policy in wire shape, or null when the server is absent.
 */
export async function setAccessPolicy(prisma: PrismaClient, serverId: string, body: McpAccessPolicyRequest): Promise<McpAccessPolicy | null>
{
  // 1. Confirm the server exists before authoring a policy against it.
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId }, select: { id: true } });
  if (!server)
  {
    return null;
  }

  // 2. Normalise the submitted ids so blank/duplicate entries cannot inflate the
  //    entitlement lists.
  const groups = _NormalizeIds(body.groups);
  const userIds = _NormalizeIds(body.users);

  // 3. Apply the whole replacement ATOMICALLY: clearing the old grants, writing the
  //    new authority grants, refreshing the display projection, and auditing all
  //    commit together or not at all — a mid-way failure must never leave the server
  //    with access erased or the projection disagreeing with the authority.
  const grantRows = _BuildEntitlementGrantRows(serverId, body.everyoneInOrg, groups, userIds);
  await prisma.$transaction(async function _tx(tx)
  {
    // 3a. AUTHORITY WRITE — replace this server's admin-authored entitlement in the
    //     generic Grant table, the SOLE source of truth for MCP authorization. Only
    //     admin-authored rows (sharedBy = null) are cleared, so per-user shares
    //     (Grant.sharedBy != null, S4) survive an access-policy rewrite.
    await tx.grant.deleteMany({ where: { mcpServerId: serverId, payloadType: GrantPayloadType.McpServer, sharedBy: null } });
    if (grantRows.length > 0)
    {
      await tx.grant.createMany({ data: grantRows });
    }

    // 3b. PROJECTION WRITE (display back-compat only) — McpServerAccessPolicy /
    //     McpServerAccessUser are DEMOTED to a read-only display projection powering
    //     the admin editor (getAccessPolicy / getDirectory). They are NEVER read to
    //     make an authorization decision. TODO(reaper #128 W1.D): drop these tables +
    //     this write once the editor display is derived from the generic Grant table.
    const policy = await tx.mcpServerAccessPolicy.upsert({
      where: { mcpServerId: serverId },
      create: { mcpServerId: serverId, everyoneInOrg: body.everyoneInOrg, groups },
      update: { everyoneInOrg: body.everyoneInOrg, groups },
    });
    await tx.mcpServerAccessUser.deleteMany({ where: { accessPolicyId: policy.id } });
    if (userIds.length > 0)
    {
      await tx.mcpServerAccessUser.createMany({
        data: userIds.map(function _row(userId) { return { accessPolicyId: policy.id, userId }; }),
      });
    }

    // 3c. Record an audit entry so access changes stay traceable.
    await tx.auditEntry.create({ data: { action: "Updated", resource: `McpServer/${serverId}`, message: `MCP server ${serverId} access policy updated` } });
  });

  return _MapAccessPolicy(serverId, { everyoneInOrg: body.everyoneInOrg, groups, users: userIds.map(function _u(userId) { return { userId }; }) });
}

/**
 * Build the selectable universe of users and groups for the admin access editor.
 *
 * @param prisma - Prisma client used for persistence.
 * @returns Distinct entitled users plus all group names.
 */
export async function getDirectory(prisma: PrismaClient): Promise<Directory>
{
  // 1. Load every group (for its name) and its JSON membership list.
  const groups = await prisma.group.findMany({ orderBy: { name: "asc" }, select: { name: true, members: true } });

  // 2. Also fold in any user already entitled via an access policy so directly
  //    granted users remain selectable even if not in a group.
  const accessUsers = await prisma.mcpServerAccessUser.findMany({ select: { userId: true } });

  // 3. Collect distinct principal identifiers from both sources.
  const userIds = new Set<string>();
  for (const group of groups)
  {
    for (const member of _NormalizeMembers(group.members))
    {
      userIds.add(member);
    }
  }
  for (const accessUser of accessUsers)
  {
    userIds.add(accessUser.userId);
  }

  return {
    users: ___SortBy(Array.from(userIds)).map(function _u(userId) { return _MapEntitledUser(userId); }),
    groups: groups.map(function _g(group) { return group.name; }),
  };
}

/**
 * Resolve a per-mode install transition, optionally clearing the credential handle.
 *
 * @param prisma - Prisma client used for persistence.
 * @param userId - Stable caller identifier.
 * @param serverId - Installed server identifier.
 * @param status - Target Prisma connection-status value.
 * @param clearRef - When true, the credentialRef custody handle is dropped.
 * @param message - Audit message describing the transition.
 * @returns The updated install row, or null when no install exists for the caller.
 */
async function _TransitionInstall(prisma: PrismaClient, userId: string, serverId: string, status: string, clearRef: boolean, message: string): Promise<McpInstalled | null>
{
  // 1. Require an existing install so the transition targets a real row.
  const existing = await prisma.mcpServerInstall.findUnique({ where: { mcpServerId_userId: { mcpServerId: serverId, userId } }, select: { id: true } });
  if (!existing)
  {
    return null;
  }

  // 2. Apply the status change, dropping the custody handle when the connection
  //    is being torn down so no stale broker reference survives.
  const install = await prisma.mcpServerInstall.update({
    where: { mcpServerId_userId: { mcpServerId: serverId, userId } },
    data: { connectionStatus: status as Prisma.McpServerInstallUpdateInput["connectionStatus"], ...(clearRef ? { credentialRef: null } : {}) },
  });

  await _AuditInstall(prisma, "Updated", serverId, userId, message);
  return _MapInstalled(install);
}

/**
 * Append an audit entry for a per-user install mutation.
 *
 * @param prisma - Prisma client used for persistence.
 * @param action - Audit action label.
 * @param serverId - Installed server identifier.
 * @param userId - Stable caller identifier.
 * @param message - Human-readable audit message.
 */
async function _AuditInstall(prisma: PrismaClient, action: string, serverId: string, userId: string, message: string): Promise<void>
{
  await prisma.auditEntry.create({ data: { action, resource: `McpServerInstall/${serverId}:${userId}`, message } });
}

/**
 * Compile the set of MCP server ids the caller holds an effective Allow on.
 *
 * Delegates to the SAME `compileForPrincipals` authority the tenant effective
 * contract uses, so the catalogue can never advertise access a tenant pod won't
 * actually receive: group membership resolves via `Group.members` and org-wide via
 * the reserved org-everyone grant — one resolution path, not a parallel one. The
 * demoted McpServerAccessPolicy / McpServerGrant tables are never consulted.
 *
 * A server is entitled only when its winning grant (priority → Deny-beats-Allow →
 * newest) resolves to Allow; a server with no matching grant is absent, which is the
 * default-deny path.
 *
 * @param prisma - Prisma client used for persistence.
 * @param caller - Identity + entitlement context of the calling user.
 * @returns The set of server ids the caller may see / install.
 */
async function _CompileEntitledMcpServerIds(prisma: PrismaClient, caller: McpOperatorCaller): Promise<Set<string>>
{
  const decisions = await compileForPrincipals([caller.userId], GrantCompilerPayloadType.McpServer, prisma);
  const entitled = new Set<string>();
  for (const decision of decisions)
  {
    if (decision.access === GrantCompilerAccess.Allow)
    {
      entitled.add(decision.payloadId);
    }
  }

  return entitled;
}

/**
 * Map a server row into the operator catalogue wire shape.
 *
 * @param server - Persisted server row.
 * @returns Normalized catalogue server payload.
 */
function _MapCatalogServer(server: Prisma.McpServerGetPayload<object>): McpCatalogServer
{
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    publisher: server.publisher ?? undefined,
    glyph: server.glyph ?? undefined,
    type: _TYPE_BY_PRISMA[server.serverType],
    approvalStatus: _APPROVAL_BY_PRISMA[server.approvalStatus],
    credentialSchema: _NormalizeCredentialSchema(server.credentialSchema),
    entitlementSummary: server.entitlementSummary ?? undefined,
  };
}

/**
 * Map a per-user install row into the operator wire shape.
 *
 * Deliberately omits `credentialRef`: the custody handle is never serialised.
 *
 * @param install - Persisted install row.
 * @returns Normalized install payload.
 */
function _MapInstalled(install: _McpInstallRow): McpInstalled
{
  return {
    serverId: install.mcpServerId,
    connectionStatus: _CONNECTION_BY_PRISMA[install.connectionStatus],
    lastUsed: install.lastUsedAt ? install.lastUsedAt.toISOString() : null,
    connectedAccount: install.connectedAccount ?? undefined,
  };
}

/**
 * Project an access policy (or empty defaults) into the wire shape.
 *
 * @param serverId - Governed server identifier.
 * @param policy - Persisted policy with entitled users, or null/partial.
 * @returns Normalized access-policy payload.
 */
function _MapAccessPolicy(serverId: string, policy: { everyoneInOrg: boolean; groups: string[]; users: { userId: string }[] } | null): McpAccessPolicy
{
  return {
    serverId,
    everyoneInOrg: policy?.everyoneInOrg ?? false,
    groups: policy?.groups ?? [],
    users: (policy?.users ?? []).map(function _u(user) { return _MapEntitledUser(user.userId); }),
  };
}

/**
 * Derive an EntitledUser display projection from a stable identifier.
 *
 * @param userId - Stable principal identifier (sub or email).
 * @returns Display name, initials, and a deterministic avatar colour.
 */
function _MapEntitledUser(userId: string): EntitledUser
{
  // 1. Prefer the local-part of an email for the display name; fall back to the id.
  const localPart = userId.includes("@") ? userId.slice(0, userId.indexOf("@")) : userId;
  const name = localPart.length > 0 ? localPart : userId;

  // 2. Build two-letter initials from word boundaries in the name.
  const words = name.split(/[\s._-]+/).filter(function _nonEmpty(word) { return word.length > 0; });
  const initials = (words.length >= 2 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2)).toUpperCase();

  // 3. Pick a stable palette colour from a simple checksum of the identifier.
  let checksum = 0;
  for (let index = 0; index < userId.length; index += 1)
  {
    checksum = (checksum + userId.charCodeAt(index)) % _AVATAR_COLORS.length;
  }

  return { id: userId, name, initials, color: _AVATAR_COLORS[checksum] };
}

/**
 * Parse the persisted credential-schema JSON into typed fields.
 *
 * @param value - Raw JSON value from the server row.
 * @returns Credential fields, or an empty array when the value is malformed.
 */
function _NormalizeCredentialSchema(value: Prisma.JsonValue): CredentialField[]
{
  if (!Array.isArray(value))
  {
    return [];
  }

  const fields: CredentialField[] = [];
  for (const entry of value)
  {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry))
    {
      continue;
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.key !== "string" || typeof record.label !== "string")
    {
      continue;
    }

    fields.push({
      key: record.key,
      label: record.label,
      required: record.required === true,
      sensitive: record.sensitive === true,
      ...(typeof record.placeholder === "string" ? { placeholder: record.placeholder } : {}),
      ...(typeof record.hint === "string" ? { hint: record.hint } : {}),
    });
  }

  return fields;
}

/**
 * Build the authoritative generic-`Grant` rows for an access-policy write.
 *
 * Every entitlement becomes an Allow grant on the generic Grant table (the sole
 * authorization authority): org-wide targets the org-everyone sentinel subject,
 * each group targets its group subject, and each user targets its user subject.
 *
 * @param serverId - Governed MCP server identifier.
 * @param everyoneInOrg - Whether the policy entitles the whole org.
 * @param groups - Normalised entitled group identifiers.
 * @param userIds - Normalised entitled user identifiers.
 * @returns Prisma createMany input rows for the generic Grant table.
 */
function _BuildEntitlementGrantRows(serverId: string, everyoneInOrg: boolean, groups: string[], userIds: string[]): Prisma.GrantCreateManyInput[]
{
  const rows: Prisma.GrantCreateManyInput[] = [];

  // 1. Org-wide entitlement → a single Allow grant on the org-everyone sentinel,
  //    which every caller's subject-id universe matches.
  if (everyoneInOrg)
  {
    rows.push(_EntitlementGrantRow(serverId, GrantSubjectType.Group, GRANT_ORG_EVERYONE_SUBJECT_ID));
  }

  // 2. Each entitled group → an Allow grant on that group subject.
  for (const group of groups)
  {
    rows.push(_EntitlementGrantRow(serverId, GrantSubjectType.Group, group));
  }

  // 3. Each entitled user → an Allow grant on that user subject.
  for (const userId of userIds)
  {
    rows.push(_EntitlementGrantRow(serverId, GrantSubjectType.User, userId));
  }

  return rows;
}

/**
 * Build one authoritative Allow grant row for an access-policy subject.
 *
 * A group subject's `subjectId` is a `Group.id`: both the catalogue read and the
 * tenant effective contract resolve group grants through the shared grant compiler
 * (`Group.members`), so an entitlement is honoured identically in each. `groupId`
 * (the optional Group FK) stays null — `subjectId` already carries the id.
 *
 * @param serverId - Governed MCP server identifier (payload + cascade relation).
 * @param subjectType - Grant subject family (Group or User).
 * @param subjectId - Concrete subject identifier the grant addresses.
 * @returns Prisma createMany input for a single generic Grant row.
 */
function _EntitlementGrantRow(serverId: string, subjectType: GrantSubjectType, subjectId: string): Prisma.GrantCreateManyInput
{
  return {
    payloadType: GrantPayloadType.McpServer,
    payloadId: serverId,
    scope: GrantScope.Org,
    subjectType,
    subjectId,
    access: GrantAccess.Allow,
    priority: 0,
    mcpServerId: serverId,
  };
}

/**
 * Normalize a list of identifiers: trim, drop blanks, de-duplicate, sort.
 *
 * @param values - Raw identifier list from a request body.
 * @returns Canonical identifier list.
 */
function _NormalizeIds(values: string[] | undefined): string[]
{
  if (!Array.isArray(values))
  {
    return [];
  }

  const unique = new Set<string>();
  for (const value of values)
  {
    if (typeof value !== "string")
    {
      continue;
    }

    const trimmed = value.trim();
    // Reserve the org-everyone sentinel: it must never be authorable as a literal
    // group/user id, or an admin could grant everyone by naming a group `*` while
    // `everyoneInOrg` is false. Only the everyoneInOrg path may write the sentinel.
    if (trimmed.length > 0 && trimmed !== GRANT_ORG_EVERYONE_SUBJECT_ID)
    {
      unique.add(trimmed);
    }
  }

  return ___SortBy(Array.from(unique));
}

/**
 * Normalize a group's JSON membership list into trimmed principal identifiers.
 *
 * @param members - Raw JSON value from the group row.
 * @returns Distinct, sorted principal identifiers.
 */
function _NormalizeMembers(members: Prisma.JsonValue): string[]
{
  if (!Array.isArray(members))
  {
    return [];
  }

  const unique = new Set<string>();
  for (const member of members)
  {
    if (typeof member !== "string")
    {
      continue;
    }

    const trimmed = member.trim();
    if (trimmed.length > 0)
    {
      unique.add(trimmed);
    }
  }

  return Array.from(unique);
}
