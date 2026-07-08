import { Prisma, type GrantScope, type PrismaClient } from "@prisma/client";
import type { Logger } from "pino";

/**
 * Groups are Zitadel project roles under the convention `group:<scope>:<name>` (#126 S4b,
 * decided 2026-07-05). A member's group roles ride in their token's role claims, so at login
 * `AuthUser.groups` already carries every `group:*` the user holds. This module mirrors those
 * claims into the silo's persisted `Group.members` so operator-facing group management, grants,
 * and audit see the IdP-sourced membership — the token stays the live source for request-time
 * `{groups}`, this is the durable projection of it.
 *
 * Scope-aware retrieval keys on the live token groups, so this mirror is the persistence half,
 * not on the hot path.
 *
 * The mirror is bidirectional at login: the user's claims are ADDED into `Group.members`, and
 * stale entries are PRUNED — a subject sitting in a convention (`group:`-prefixed) Group but
 * absent from the login's claims was dropped in the Console, so their entry is removed.
 * Operator-curated groups (non-convention names) are never touched, and an emptied group is
 * retained (it may still carry grants).
 *
 * DEFERRED (tracked on #126): control-plane group mutations writing Zitadel role grants via
 * the fleet management client — for now org admins manage group roles in the Zitadel Console
 * they own (the decided native primitive).
 */

/** Maps the scope segment of a `group:<scope>:<name>` claim to the `GrantScope` enum. */
const _SCOPE_BY_SEGMENT: Readonly<Record<string, GrantScope>> = {
  org: "Org",
  department: "Department",
  team: "Team",
  project: "Project",
  personal: "Personal",
};

/** A parsed group claim: the full claim string is the (unique) Group name, plus its scope. */
interface ParsedGroupClaim
{
  /** The full `group:<scope>:<name>` claim — used verbatim as the unique Group.name. */
  name: string;
  /** The GrantScope the `<scope>` segment maps to. */
  scope: GrantScope;
}

/**
 * Extract the well-formed `group:<scope>:<name>` claims from a user's token groups. Non-group
 * claims (plain roles, operator/admin groups) and claims with an unknown scope segment are
 * skipped — never guessed into an arbitrary scope.
 *
 * @param groups - The user's `AuthUser.groups` (role + group claims; already lower-cased).
 * @returns The parsed, de-duplicated group claims.
 */
export function _ParseGroupClaims(groups: readonly string[] | undefined): ParsedGroupClaim[]
{
  const seen = new Set<string>();
  const out: ParsedGroupClaim[] = [];
  for (const raw of groups ?? [])
  {
    const claim = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const match = /^group:([a-z]+):(.+)$/.exec(claim);
    if (!match) continue;
    const scope = _SCOPE_BY_SEGMENT[match[1]];
    if (!scope || seen.has(claim)) continue;
    seen.add(claim);
    out.push({ name: claim, scope });
  }
  return out;
}

/** Coerce a stored `members` JSON value into a string array (defensive against nulls/non-arrays). */
function _asMemberArray(value: Prisma.JsonValue | undefined): string[]
{
  return Array.isArray(value) ? value.filter((m): m is string => typeof m === "string") : [];
}

/**
 * Add `subject` to one group's members, creating the group if absent. Runs in a transaction and
 * takes a `SELECT … FOR UPDATE` row lock on the group so concurrent logins adding to the SAME
 * group can't clobber each other's member append (the members list is a JSON array — a naive
 * read-modify-write would lose an update). A create race on the unique `name` surfaces as P2002
 * and is retried as an update.
 */
async function _addMemberToGroup(prisma: PrismaClient, claim: ParsedGroupClaim, subject: string): Promise<void>
{
  await prisma.$transaction(async function _tx(tx)
  {
    // Lock the row if it already exists so the read→append→write below is serialised per group.
    await tx.$queryRaw`SELECT 1 FROM groups WHERE name = ${claim.name} FOR UPDATE`;
    const existing = await tx.group.findUnique({ where: { name: claim.name }, select: { members: true } });
    if (!existing)
    {
      await tx.group.create({ data: { name: claim.name, scope: claim.scope, members: [subject] } });
      return;
    }
    const members = _asMemberArray(existing.members as Prisma.JsonValue);
    if (members.includes(subject)) return; // idempotent — already a member
    members.push(subject);
    members.sort();
    await tx.group.update({ where: { name: claim.name }, data: { members: members as Prisma.InputJsonValue } });
  }).catch(async function _onCreateRace(err)
  {
    // Lost the create race against a concurrent first-login for the same group — the row now
    // exists; re-run so this subject is appended to it rather than dropped.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
    {
      await _addMemberToGroup(prisma, claim, subject);
      return;
    }
    throw err;
  });
}

/**
 * Remove `subject` from one group's members. Same row-locked read-modify-write transaction as
 * {@link _addMemberToGroup} (a `SELECT … FOR UPDATE` serialises concurrent logins mutating the
 * SAME group's JSON members array). Idempotent: a vanished group or an already-absent subject
 * is a no-op. The group row is KEPT even when its last member leaves — an empty group may
 * still carry grants.
 */
async function _removeMemberFromGroup(prisma: PrismaClient, name: string, subject: string): Promise<void>
{
  await prisma.$transaction(async function _tx(tx)
  {
    // Lock the row so the read→filter→write below is serialised per group.
    await tx.$queryRaw`SELECT 1 FROM groups WHERE name = ${name} FOR UPDATE`;
    const existing = await tx.group.findUnique({ where: { name }, select: { members: true } });
    if (!existing) return; // group vanished concurrently — nothing to prune
    const members = _asMemberArray(existing.members as Prisma.JsonValue);
    if (!members.includes(subject)) return; // idempotent — already pruned
    const remaining = members.filter(m => m !== subject); // filter preserves the sorted order
    await tx.group.update({ where: { name }, data: { members: remaining as Prisma.InputJsonValue } });
  });
}

/**
 * Mirror a logged-in user's `group:*` role claims into the silo's `Group.members` (#126 S4b).
 * Best-effort and idempotent: each group is handled independently so one failure never blocks
 * the others or the login, and re-logins converge (a subject already in / already out of a
 * group is a no-op).
 *
 * Two passes: (1) ADD — every parsed claim upserts the subject into its Group; (2) PRUNE —
 * every convention (`group:`-prefixed) Group still holding the subject but absent from this
 * login's claims loses the entry (the user was dropped in the Zitadel Console). Only
 * convention groups are pruned; operator-curated groups (any other name) are never touched.
 *
 * @param opts.prisma  - Silo Prisma client.
 * @param opts.subject - The member's IdP-verified subject (OIDC `sub`).
 * @param opts.groups  - `AuthUser.groups` — the union of the user's role + group claims.
 * @param opts.log     - Scoped logger.
 */
export async function _MirrorGroupsOnLogin(opts: {
  prisma: PrismaClient;
  subject: string | undefined;
  groups: readonly string[] | undefined;
  log: Logger;
}): Promise<void>
{
  const subject = opts.subject?.trim() ?? "";
  if (!subject) return;

  // 1. ADD pass — persist every group claim the token carries (create-or-append, idempotent).
  const claims = _ParseGroupClaims(opts.groups);
  for (const claim of claims)
  {
    try
    {
      await _addMemberToGroup(opts.prisma, claim, subject);
    }
    catch (err)
    {
      opts.log.warn({ err, group: claim.name }, "group-claim mirror failed for one group; continuing");
    }
  }

  // 2. PRUNE pass — the token is the source of truth, so a convention group still listing this
  //    subject without a matching claim is stale (dropped in the Console). One scan over the
  //    `group:*` namespace; the members-contains check runs in JS (members is a Json column).
  const held = new Set(claims.map(claim => claim.name));
  let conventionGroups: Array<{ name: string; members: Prisma.JsonValue }>;
  try
  {
    conventionGroups = await opts.prisma.group.findMany({ where: { name: { startsWith: "group:" } }, select: { name: true, members: true } });
  }
  catch (err)
  {
    // The prune is best-effort hardening — a scan failure never blocks the login.
    opts.log.warn({ err }, "group-claim prune scan failed; skipping prune for this login");
    return;
  }
  for (const group of conventionGroups)
  {
    if (held.has(group.name)) continue; // still claimed — keep the membership
    if (!_asMemberArray(group.members).includes(subject)) continue; // not a member — nothing to prune
    try
    {
      await _removeMemberFromGroup(opts.prisma, group.name, subject);
    }
    catch (err)
    {
      opts.log.warn({ err, group: group.name }, "group-claim prune failed for one group; continuing");
    }
  }
}
