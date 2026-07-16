-- Obot v0.23.1 lifecycle projection (#128). OpenCrane stops simulating MCP install/credential
-- state and persists only the Obot identifiers it created/imported plus the last observed
-- reconcile state; the authoritative server config, credential custody, access-control rules,
-- and connect URLs always live in Obot, never here. #218 curated-import provenance (pinned
-- version + digest) rides along on the server row. All columns are nullable or defaulted so
-- existing rows backfill with no data migration.

ALTER TABLE "mcp_servers"
  ADD COLUMN "obot_catalog_id" TEXT,
  ADD COLUMN "obot_catalog_entry_id" TEXT,
  ADD COLUMN "obot_server_id" TEXT,
  ADD COLUMN "obot_pinned_version" TEXT,
  ADD COLUMN "obot_digest" TEXT,
  ADD COLUMN "obot_observed_state" TEXT,
  ADD COLUMN "obot_reconcile_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "obot_last_error" TEXT;

ALTER TABLE "mcp_server_installs"
  ADD COLUMN "obot_instance_id" TEXT,
  ADD COLUMN "connect_url" TEXT,
  ADD COLUMN "observed_state" TEXT,
  ADD COLUMN "reconcile_generation" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" TEXT;
