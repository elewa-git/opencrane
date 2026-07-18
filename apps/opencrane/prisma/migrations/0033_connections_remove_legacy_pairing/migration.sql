-- Connections-owned deletion of the unused pairing registry and arbitrary runtime config column.
DROP TABLE "brokered_devices";
ALTER TABLE "tenants" DROP COLUMN "config_overrides";
