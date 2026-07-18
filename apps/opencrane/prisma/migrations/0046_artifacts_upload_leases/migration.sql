-- Artifact upload leases keep byte-plane promotion receipts under the OpenCrane catalog authority.
CREATE TYPE "ArtifactUploadLeaseState" AS ENUM ('active', 'promoted', 'finalized', 'expired', 'cancelled');

CREATE TABLE "artifact_upload_leases" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "silo_id" TEXT NOT NULL,
    "capability_jti" TEXT NOT NULL,
    "expected_content_address" TEXT,
    "expected_byte_length" BIGINT,
    "media_type" TEXT NOT NULL,
    "state" "ArtifactUploadLeaseState" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "promotion_receipt_digest" TEXT,
    "promoted_content_address" TEXT,
    "promoted_byte_length" BIGINT,
    "promoted_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifact_upload_leases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artifact_upload_leases_identity_check" CHECK (btrim("silo_id") <> '' AND btrim("capability_jti") <> '' AND btrim("media_type") <> '' AND strpos("media_type", '/') > 1),
    CONSTRAINT "artifact_upload_leases_expected_content_check" CHECK ("expected_content_address" IS NULL OR "expected_content_address" ~ '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT "artifact_upload_leases_expected_length_check" CHECK ("expected_byte_length" IS NULL OR "expected_byte_length" >= 0),
    CONSTRAINT "artifact_upload_leases_promotion_check" CHECK (
      ("state" = 'active' AND "promotion_receipt_digest" IS NULL AND "promoted_content_address" IS NULL AND "promoted_byte_length" IS NULL AND "promoted_at" IS NULL AND "finalized_at" IS NULL)
      OR ("state" = 'promoted' AND "promotion_receipt_digest" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_content_address" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_byte_length" >= 0 AND "promoted_at" IS NOT NULL AND "finalized_at" IS NULL)
      OR ("state" = 'finalized' AND "promotion_receipt_digest" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_content_address" ~ '^sha256:[0-9a-f]{64}$' AND "promoted_byte_length" >= 0 AND "promoted_at" IS NOT NULL AND "finalized_at" IS NOT NULL)
      OR ("state" IN ('expired', 'cancelled') AND "finalized_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "artifact_upload_leases_capability_jti_key" ON "artifact_upload_leases"("capability_jti");
CREATE UNIQUE INDEX "artifact_upload_leases_promotion_receipt_digest_key" ON "artifact_upload_leases"("promotion_receipt_digest");
CREATE INDEX "artifact_upload_leases_artifact_id_state_expires_at_idx" ON "artifact_upload_leases"("artifact_id", "state", "expires_at");
CREATE INDEX "artifact_upload_leases_silo_id_state_expires_at_idx" ON "artifact_upload_leases"("silo_id", "state", "expires_at");
ALTER TABLE "artifact_upload_leases" ADD CONSTRAINT "artifact_upload_leases_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "enforce_artifact_upload_lease_silo_and_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_silo_id TEXT;
BEGIN
    SELECT "silo_id" INTO artifact_silo_id FROM "artifacts" WHERE "id" = NEW."artifact_id" FOR UPDATE;
    IF artifact_silo_id IS DISTINCT FROM NEW."silo_id" THEN RAISE EXCEPTION 'ArtifactUploadLease must stay inside its Artifact silo'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."artifact_id" IS DISTINCT FROM OLD."artifact_id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."capability_jti" IS DISTINCT FROM OLD."capability_jti" OR NEW."expected_content_address" IS DISTINCT FROM OLD."expected_content_address" OR NEW."expected_byte_length" IS DISTINCT FROM OLD."expected_byte_length" OR NEW."media_type" IS DISTINCT FROM OLD."media_type" OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at") THEN RAISE EXCEPTION 'ArtifactUploadLease authority coordinates are immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD."state" <> 'active' AND (NEW."promotion_receipt_digest" IS DISTINCT FROM OLD."promotion_receipt_digest" OR NEW."promoted_content_address" IS DISTINCT FROM OLD."promoted_content_address" OR NEW."promoted_byte_length" IS DISTINCT FROM OLD."promoted_byte_length" OR NEW."promoted_at" IS DISTINCT FROM OLD."promoted_at") THEN RAISE EXCEPTION 'ArtifactUploadLease promotion receipt is immutable'; END IF;
    IF TG_OP = 'UPDATE' AND NOT ((OLD."state" = 'active' AND NEW."state" IN ('active', 'promoted', 'expired', 'cancelled')) OR (OLD."state" = 'promoted' AND NEW."state" IN ('promoted', 'finalized', 'expired', 'cancelled')) OR (OLD."state" = 'finalized' AND NEW."state" = 'finalized') OR (OLD."state" IN ('expired', 'cancelled') AND NEW."state" = OLD."state")) THEN RAISE EXCEPTION 'invalid ArtifactUploadLease lifecycle transition'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "artifact_upload_leases_silo_and_lifecycle" BEFORE INSERT OR UPDATE ON "artifact_upload_leases" FOR EACH ROW EXECUTE FUNCTION "enforce_artifact_upload_lease_silo_and_lifecycle"();
