import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { compile, compileForPrincipals } from "../core/grant-compiler.js";
import { GrantCompilerAccess, GrantCompilerPayloadType } from "../core/grant-compiler.types.js";

/** A grant row in the shape the compiler selects (Prisma enum string values). */
interface _GrantRow
{
  id: string;
  payloadType: string;
  payloadId: string;
  access: string;
  priority: number;
  scope: string;
  subjectType: string;
  subjectId: string;
  createdAt: Date;
}

/** A group row in the shape the compiler selects. */
interface _GroupRow
{
  id: string;
  members: unknown;
}

/** One clause of the compiler's grant `where.OR` (direct-subject or group). */
interface _WhereClause
{
  subjectType: { in: string[] } | string;
  subjectId: { in: string[] };
}

/**
 * Build a Prisma stub that HONOURS the compiler's group + grant filters, so the test
 * exercises the real candidate-selection (not just the precedence pass). `group.findMany`
 * returns all groups; `grant.findMany` filters the fixed grant set by the `where` the
 * compiler builds (payloadType + the direct-subject/group OR clauses).
 *
 * @param groups - The group rows the compiler sees.
 * @param grants - The full grant set to filter against the compiler's where.
 * @returns A Prisma-typed stub exposing only `group`/`grant` findMany.
 */
function _prismaStub(groups: _GroupRow[], grants: _GrantRow[]): PrismaClient
{
  return {
    group: {
      findMany: async function _groupFindMany() { return groups; },
    },
    grant: {
      findMany: async function _grantFindMany(args: { where: { payloadType: string; OR: _WhereClause[] } })
      {
        const { payloadType, OR } = args.where;
        return grants.filter(function _match(grant)
        {
          if (grant.payloadType !== payloadType) return false;
          return OR.some(function _clause(clause)
          {
            const types = typeof clause.subjectType === "string" ? [clause.subjectType] : clause.subjectType.in;
            return types.includes(grant.subjectType) && clause.subjectId.in.includes(grant.subjectId);
          });
        });
      },
    },
  } as unknown as PrismaClient;
}

/** Shorthand builder for an McpServer grant row. */
function _grant(id: string, payloadId: string, access: "Allow" | "Deny", subjectType: string, subjectId: string, isoDate: string): _GrantRow
{
  return { id, payloadType: "McpServer", payloadId, access, priority: 0, scope: "Org", subjectType, subjectId, createdAt: new Date(isoDate) };
}

describe("grant compiler — openclaw Tenant inherits its user's rights (S4)", function _inheritanceSuite()
{
  // A group the USER (not the tenant) belongs to, and grants spread across all three
  // subject types — including a user-level Deny that collides with a tenant-level Allow.
  const groups: _GroupRow[] = [{ id: "grp-eng", members: ["user-sub"] }];
  const grants: _GrantRow[] = [
    _grant("g1", "mcp-user",  "Allow", "User",   "user-sub",   "2026-01-01T00:00:00Z"),
    _grant("g2", "mcp-both",  "Allow", "Tenant", "team-alpha", "2026-01-01T00:00:00Z"),
    _grant("g3", "mcp-both",  "Deny",  "User",   "user-sub",   "2026-01-02T00:00:00Z"),
    _grant("g4", "mcp-group", "Allow", "Group",  "grp-eng",    "2026-01-01T00:00:00Z"),
    _grant("g5", "mcp-tenant","Allow", "Tenant", "team-alpha", "2026-01-01T00:00:00Z"),
  ];

  it("tenant-only compile sees only the tenant's own grants (no user/user-group inheritance)", async function _tenantOnly()
  {
    const decisions = await compile("team-alpha", GrantCompilerPayloadType.McpServer, _prismaStub(groups, grants));

    // Only the two Tenant-subject grants resolve; the user grant, the user's group grant,
    // and the user Deny are all invisible when compiling the tenant principal alone.
    expect(decisions.map(d => d.payloadId)).toEqual(["mcp-both", "mcp-tenant"]);
    expect(decisions.find(d => d.payloadId === "mcp-both")?.access).toBe(GrantCompilerAccess.Allow);
  });

  it("compiling over {tenant, subject} inherits the user's grants + the user's group grant", async function _inherits()
  {
    const decisions = await compileForPrincipals(["team-alpha", "user-sub"], GrantCompilerPayloadType.McpServer, _prismaStub(groups, grants));
    const byId = new Map(decisions.map(d => [d.payloadId, d.access]));

    // The user's direct grant and the grant on the user's group are now inherited.
    expect(byId.get("mcp-user")).toBe(GrantCompilerAccess.Allow);
    expect(byId.get("mcp-group")).toBe(GrantCompilerAccess.Allow);
    expect(byId.get("mcp-tenant")).toBe(GrantCompilerAccess.Allow);
    // Deny>Allow holds ACROSS principals: the user-level Deny overrides the tenant-level
    // Allow at equal priority — inheritance stays least-privilege-capable.
    expect(byId.get("mcp-both")).toBe(GrantCompilerAccess.Deny);
  });

  it("an empty principal set compiles to nothing (no DB-wide grant leak)", async function _empty()
  {
    expect(await compileForPrincipals([], GrantCompilerPayloadType.McpServer, _prismaStub(groups, grants))).toEqual([]);
    // A bound subject that is null/empty collapses to the tenant-only set, never a leak.
    expect(await compileForPrincipals(["", ""], GrantCompilerPayloadType.McpServer, _prismaStub(groups, grants))).toEqual([]);
  });
});
