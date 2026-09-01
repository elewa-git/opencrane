CREATE TABLE "opencrane_local_development_state" (
    "id" TEXT PRIMARY KEY,
    "target_baseline_sha256" TEXT NOT NULL CHECK ("target_baseline_sha256" ~ '^[0-9a-f]{64}$'),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "opencrane_local_development_state_singleton" CHECK ("id" = 'baseline')
);

INSERT INTO "opencrane_local_development_state" ("id", "target_baseline_sha256")
VALUES ('baseline', :'baseline_sha256');
