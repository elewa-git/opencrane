-- Membership lifecycle status (#126): billing can disable a member's license, which
-- suspends them in the org (blocked at the IdP, live sessions/devices cut, workspace pod
-- suspended — not deleted). A Suspended member FREES their seat: seat caps count only
-- Active memberships, and reactivation must pass the seat reservation. Existing rows
-- default to 'active' so the column is backfilled without a data migration.
CREATE TYPE "OrgMemberStatus" AS ENUM ('active', 'suspended');

ALTER TABLE "org_memberships" ADD COLUMN "status" "OrgMemberStatus" NOT NULL DEFAULT 'active';
