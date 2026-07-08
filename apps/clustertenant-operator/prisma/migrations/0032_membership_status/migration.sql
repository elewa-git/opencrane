-- Membership lifecycle status projected from the fleet (#126). The silo's org_memberships is a
-- read-model of the fleet's authoritative membership; the projection repairer now mirrors each
-- row's status too. A Suspended member is disabled in the org: the connect path fails closed and
-- the repairer sweep cuts their sessions/devices and suspends their workspace pod. Existing rows
-- default to 'active' so the column is backfilled without a data migration.
CREATE TYPE "OrgMemberStatus" AS ENUM ('active', 'suspended');

ALTER TABLE "org_memberships" ADD COLUMN "status" "OrgMemberStatus" NOT NULL DEFAULT 'active';
