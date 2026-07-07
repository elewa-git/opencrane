-- Seat caps (#126 S6): per-org membership ceiling, enforced fleet-side on member creation.
-- Null = uncapped (the default for existing orgs and standalone silos).
ALTER TABLE "cluster_tenants" ADD COLUMN "seat_cap" INTEGER;
