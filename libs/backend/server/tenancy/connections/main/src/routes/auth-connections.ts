import { Router } from "express";
import type { PrismaClient } from "@prisma/client";

import { _ClusterTenantFromHost, _RequestHost } from "@opencrane/server/_infra/auth";
import { _IsMemberSuspended, _ResolveGatewayTarget } from "../core/gateway-resolve.js";

/** Gateway WebSocket path on the same org host that serves the browser application. */
const _OPENCLAW_GATEWAY_WS_PATH = "/gateway";

/**
 * Build the public, session-checked connection routes mounted under `/api/v1/auth`.
 * @param prisma - Silo database used for authoritative email-to-tenant resolution.
 * @returns Router exposing gateway resolution and connection preflight.
 */
export function _ConnectionsAuthRouter(prisma: PrismaClient): Router
{
  const router = Router();
  const namespace = process.env.NAMESPACE ?? "default";

  /** Resolve the verified session to the sole gateway target the proxy may use. */
  router.get("/gateway-resolve", async function _gatewayResolve(req, res, next)
  {
    try
    {
      const authUser = req.session?.authUser;
      if (!authUser)
      {
        res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
        return;
      }

      const email = typeof authUser.email === "string" ? authUser.email : "";
      const sub = typeof authUser.sub === "string" ? authUser.sub : "";
      const silo = _ClusterTenantFromHost(_RequestHost(req));
      const outcome = await _ResolveGatewayTarget(prisma, namespace, email, sub, silo);

      if (!outcome.ok)
      {
        const message = outcome.code === "AMBIGUOUS_TENANT"
          ? "Multiple OpenClaw pods match this account; contact your administrator"
          : outcome.code === "NO_TENANT"
            ? "No OpenClaw is provisioned for this account"
            : outcome.code === "MEMBER_SUSPENDED"
              ? "Your membership in this organisation is suspended"
              : "Session has no email claim; cannot resolve a tenant";
        res.status(403).json({ error: message, code: outcome.code });
        return;
      }

      res.status(200).json(outcome.resolved);
    }
    catch (err)
    {
      next(err);
    }
  });

  /** Return tokenless connection coordinates for the verified session's sole tenant. */
  router.post("/pod-token", async function _podToken(req, res, next)
  {
    try
    {
      // 1. Require an established OIDC browser session at this public route.
      const authUser = req.session?.authUser;
      if (!authUser)
      {
        res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
        return;
      }

      // 2. Resolve only from the verified email and host-derived silo, never request input.
      const email = typeof authUser.email === "string" ? authUser.email.toLowerCase() : "";
      if (!email)
      {
        res.status(403).json({ error: "Session has no email claim; cannot resolve a tenant", code: "FORBIDDEN" });
        return;
      }

      const silo = _ClusterTenantFromHost(_RequestHost(req));
      const matches = await prisma.tenant.findMany({
        where: { email: { equals: email, mode: "insensitive" }, ...(silo ? { clusterTenantRef: silo } : {}) },
        select: { name: true, ingressHost: true, clusterTenantRef: true },
      });

      if (matches.length === 0)
      {
        res.status(403).json({ error: "No OpenClaw is provisioned for this account", code: "NO_TENANT" });
        return;
      }
      if (matches.length > 1)
      {
        res.status(409).json({ error: "Multiple OpenClaw pods match this account; contact your administrator", code: "AMBIGUOUS_TENANT" });
        return;
      }

      const tenant = matches[0];
      const subject = authUser.sub.length > 0 ? authUser.sub : email;
      if (await _IsMemberSuspended(prisma, tenant.clusterTenantRef, subject))
      {
        res.status(403).json({ error: "Your membership in this organisation is suspended", code: "MEMBER_SUSPENDED" });
        return;
      }

      // 3. Refuse the handshake while the operator-owned ingress coordinate is absent.
      if (!tenant.ingressHost)
      {
        res.status(409).json({ error: "OpenClaw runtime ingress is not ready", code: "POD_NOT_READY" });
        return;
      }

      // 4. Return coordinates only; trusted-proxy authentication happens at the ingress.
      res.status(200).json({
        gatewayUrl: `wss://${tenant.ingressHost}${_OPENCLAW_GATEWAY_WS_PATH}`,
        tenant: tenant.name,
        ingressHost: tenant.ingressHost,
      });
    }
    catch (err)
    {
      next(err);
    }
  });

  return router;
}
