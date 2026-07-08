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
      findMany: vi.fn(async function _findMany() { return []; }), // the prune scan sees no groups
      create: opts.create,
      update: opts.update,
    },
  } as unknown as PrismaClient;
  return prisma;
}

/** An in-memory Group row for the store-backed prune stub. */
interface StoredGroup
{
  /** Unique group name (the full claim for convention groups; any name for curated ones). */
  name: string;
  /** The persisted members JSON array. */
  members: string[];
}

/**
 * Store-backed Prisma stub for the PRUNE-pass tests: `findMany` honours the `startsWith`
 * filter (mimicking Prisma, so the convention-only scan shape is what's under test),
 * `findUnique` reads and `update` mutates the backing rows, and `delete` is a spy pinning
 * that an emptied group is never removed.
 */
function _storePrisma(rows: StoredGroup[]): { prisma: PrismaClient; update: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn>; store: Map<string, StoredGroup> }
{
  const store = new Map(rows.map(row => [row.name, { ...row, members: [...row.members] }] as const));
  const update = vi.fn(async function _update(args: { where: { name: string }; data: { members: string[] } })
  {
    const row = store.get(args.where.name);
    if (row) { row.members = [...args.data.members]; }
    return row;
  });
  const del = vi.fn();
  const prisma = {
    $queryRaw: vi.fn(async function _queryRaw() { return []; }),
    $transaction: vi.fn(async function _tx(fn: (tx: PrismaClient) => Promise<unknown>) { return fn(prisma); }),
    group: {
      findMany: vi.fn(async function _findMany(args: { where: { name: { startsWith: string } } })
      {
        return Array.from(store.values()).filter(row => row.name.startsWith(args.where.name.startsWith)).map(row => ({ name: row.name, members: [...row.members] }));
      }),
      findUnique: vi.fn(async function _findUnique(args: { where: { name: string } })
      {
        const row = store.get(args.where.name);
        return row ? { members: [...row.members] } : null;
      }),
      create: vi.fn(async function _create(args: { data: StoredGroup })
      {
        store.set(args.data.name, { name: args.data.name, members: [...args.data.members] });
        return args.data;
      }),
      update,
      delete: del,
    },
  } as unknown as PrismaClient;
  return { prisma, update, del, store };
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

describe("_MirrorGroupsOnLogin — prune stale group members on login", function _prune()
{
  it("removes the subject from a convention group missing from the claims; other members stay", async function _removesDropped()
  {
    // sub-1 still claims project:apollo but was dropped from team:eng in the Console.
    const { prisma, update, store } = _storePrisma([
      { name: "group:team:eng", members: ["sub-1", "sub-2"] },
      { name: "group:project:apollo", members: ["sub-1"] },
    ]);
    await _MirrorGroupsOnLogin({ prisma, subject: "sub-1", groups: ["group:project:apollo"], log: _log });

    // Pruned from the dropped group only — sub-2 (and the still-claimed group) untouched.
    expect(update).toHaveBeenCalledWith({ where: { name: "group:team:eng" }, data: { members: ["sub-2"] } });
    expect(store.get("group:team:eng")?.members).toEqual(["sub-2"]);
    expect(store.get("group:project:apollo")?.members).toEqual(["sub-1"]);
  });

  it("never prunes operator-curated (non-convention) groups", async function _curatedUntouched()
  {
    const { prisma, update, store } = _storePrisma([
      { name: "ops-admins", members: ["sub-1"] }, // curated: no group: prefix
    ]);
    await _MirrorGroupsOnLogin({ prisma, subject: "sub-1", groups: [], log: _log });

    expect(update).not.toHaveBeenCalled();
    expect(store.get("ops-admins")?.members).toEqual(["sub-1"]);
  });

  it("retains an emptied group after its last member is pruned (groups may carry grants)", async function _keepsEmpty()
  {
    const { prisma, update, del, store } = _storePrisma([
      { name: "group:team:eng", members: ["sub-1"] },
    ]);
    await _MirrorGroupsOnLogin({ prisma, subject: "sub-1", groups: [], log: _log });

    expect(update).toHaveBeenCalledWith({ where: { name: "group:team:eng" }, data: { members: [] } });
    expect(store.get("group:team:eng")?.members).toEqual([]);
    expect(del).not.toHaveBeenCalled(); // the empty group row is KEPT
  });

  it("skips groups the subject is not a member of (no write)", async function _nonMemberNoop()
  {
    const { prisma, update } = _storePrisma([
      { name: "group:team:eng", members: ["sub-2"] },
    ]);
    await _MirrorGroupsOnLogin({ prisma, subject: "sub-1", groups: [], log: _log });

    expect(update).not.toHaveBeenCalled();
  });

  it("logs a per-group prune failure and continues with the rest", async function _failSoft()
  {
    const warn = vi.fn();
    const log = { warn, info: vi.fn() } as unknown as Logger;
    const { prisma, update, store } = _storePrisma([
      { name: "group:team:alpha", members: ["sub-1"] },
      { name: "group:team:beta", members: ["sub-1"] },
    ]);
    // Force the FIRST group's row-lock query to fail; the second prune must still run.
    (prisma.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("lock boom"));
    await _MirrorGroupsOnLogin({ prisma, subject: "sub-1", groups: [], log });

    expect(warn).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce(); // only the surviving group was written
    expect(store.get("group:team:beta")?.members).toEqual([]);
  });
});
