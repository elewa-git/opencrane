import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { _MirrorGroupsOnLogin, _ParseGroupClaims } from "../../infra/auth/mirror-groups.js";

/**
 * #126 S4b — mirror a user's `group:<scope>:<name>` project-role claims into the persisted
 * Group.members at login. These pin claim parsing (well-formed only, unknown scope skipped,
 * de-duplicated) and the create / append / idempotent-no-op member paths.
 */

const _log = { warn: vi.fn(), info: vi.fn() } as unknown as Logger;

/** Prisma stub whose $transaction runs the callback against the same stub (tx === prisma). */
function _mockPrisma(opts: { existing?: { members: unknown } | null; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }): PrismaClient
{
  const prisma = {
    $queryRaw: vi.fn(async function _queryRaw() { return []; }),
    $transaction: vi.fn(async function _tx(fn: (tx: PrismaClient) => Promise<unknown>) { return fn(prisma); }),
    group: {
      findUnique: vi.fn(async function _findUnique() { return opts.existing ?? null; }),
      create: opts.create,
      update: opts.update,
    },
  } as unknown as PrismaClient;
  return prisma;
}

describe("_ParseGroupClaims — well-formed group:<scope>:<name> claims", function _parse()
{
  it("keeps group claims with a known scope, skips the rest, and de-duplicates", function _keeps()
  {
    const parsed = _ParseGroupClaims([
      "group:team:eng",
      "roles:foo",          // not a group claim
      "operator",           // plain role
      "group:zzz:bad",      // unknown scope segment
      "group:team:eng",     // duplicate
      "group:project:apollo",
    ]);
    expect(parsed).toEqual([
      { name: "group:team:eng", scope: "Team" },
      { name: "group:project:apollo", scope: "Project" },
    ]);
  });

  it("returns nothing for undefined/empty groups", function _empty()
  {
    expect(_ParseGroupClaims(undefined)).toEqual([]);
    expect(_ParseGroupClaims([])).toEqual([]);
  });
});

describe("_MirrorGroupsOnLogin — persist group membership from claims", function _mirror()
{
  it("creates a missing group with the subject as its first member", async function _create()
  {
    const create = vi.fn().mockResolvedValue({});
    const update = vi.fn();
    await _MirrorGroupsOnLogin({
      prisma: _mockPrisma({ existing: null, create, update }),
      subject: "sub-1", groups: ["group:team:eng"], log: _log,
    });
    expect(create).toHaveBeenCalledWith({ data: { name: "group:team:eng", scope: "Team", members: ["sub-1"] } });
    expect(update).not.toHaveBeenCalled();
  });

  it("appends the subject to an existing group (sorted, no duplicate)", async function _append()
  {
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    await _MirrorGroupsOnLogin({
      prisma: _mockPrisma({ existing: { members: ["sub-a"] }, create, update }),
      subject: "sub-1", groups: ["group:team:eng"], log: _log,
    });
    expect(update).toHaveBeenCalledWith({ where: { name: "group:team:eng" }, data: { members: ["sub-1", "sub-a"] } });
    expect(create).not.toHaveBeenCalled();
  });

  it("is a no-op when the subject is already a member", async function _idempotent()
  {
    const create = vi.fn();
    const update = vi.fn();
    await _MirrorGroupsOnLogin({
      prisma: _mockPrisma({ existing: { members: ["sub-1"] }, create, update }),
      subject: "sub-1", groups: ["group:team:eng"], log: _log,
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does nothing without a subject", async function _noSubject()
  {
    const create = vi.fn();
    const update = vi.fn();
    await _MirrorGroupsOnLogin({
      prisma: _mockPrisma({ existing: null, create, update }),
      subject: "", groups: ["group:team:eng"], log: _log,
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
