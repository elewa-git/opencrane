-- Fresh integration authority. Target AgentRevision assignments replace their isolated MCP seam;
-- no MCP catalogue, credential, OAuth, token, or assignment row is copied or bridged.

DROP TABLE "agent_revision_mcp_assignments";

CREATE TYPE "IntegrationState" AS ENUM ('active', 'retired');
CREATE TYPE "IntegrationCustodyState" AS ENUM ('ready', 'revoked', 'expired');

CREATE FUNCTION "has_nonempty_distinct_tool_ids"(TEXT[]) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    cardinality($1) > 0 AND NOT EXISTS (
      SELECT 1
      FROM unnest($1) AS tool("value")
      GROUP BY tool."value"
      HAVING tool."value" IS NULL OR btrim(tool."value") = '' OR count(*) > 1
    ),
    FALSE
  );
$$;

CREATE TABLE "integrations" (
  "id" TEXT NOT NULL,
  "silo_id" TEXT NOT NULL,
  "obot_catalog_entry_id" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "state" "IntegrationState" NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integrations_identity_nonempty" CHECK (
    btrim("silo_id") <> '' AND btrim("obot_catalog_entry_id") <> '' AND btrim("display_name") <> ''
  )
);

CREATE UNIQUE INDEX "integrations_id_silo_id_key" ON "integrations"("id", "silo_id");
CREATE UNIQUE INDEX "integrations_silo_id_obot_catalog_entry_id_key" ON "integrations"("silo_id", "obot_catalog_entry_id");
CREATE INDEX "integrations_silo_id_state_idx" ON "integrations"("silo_id", "state");

CREATE TABLE "integration_custody_references" (
  "id" TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "silo_id" TEXT NOT NULL,
  "obot_custody_reference" TEXT NOT NULL,
  "state" "IntegrationCustodyState" NOT NULL DEFAULT 'ready',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_custody_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_custody_references_identity_nonempty" CHECK (
    btrim("integration_id") <> '' AND btrim("silo_id") <> '' AND btrim("obot_custody_reference") <> ''
  ),
  CONSTRAINT "integration_custody_references_revocation_evidence" CHECK (
    ("state" = 'revoked' AND "revoked_at" IS NOT NULL) OR ("state" <> 'revoked' AND "revoked_at" IS NULL)
  ),
  CONSTRAINT "integration_custody_references_integration_fkey" FOREIGN KEY ("integration_id", "silo_id")
    REFERENCES "integrations"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "integration_custody_references_id_integration_id_silo_id_key"
  ON "integration_custody_references"("id", "integration_id", "silo_id");
CREATE UNIQUE INDEX "integration_custody_references_obot_custody_reference_key"
  ON "integration_custody_references"("obot_custody_reference");
CREATE INDEX "integration_custody_references_integration_id_state_expires_at_idx"
  ON "integration_custody_references"("integration_id", "state", "expires_at");
CREATE UNIQUE INDEX "integration_custody_references_one_ready_per_integration"
  ON "integration_custody_references"("integration_id") WHERE "state" = 'ready' AND "revoked_at" IS NULL;

CREATE TABLE "agent_revision_integration_assignments" (
  "agent_revision_id" TEXT NOT NULL,
  "integration_id" TEXT NOT NULL,
  "silo_id" TEXT NOT NULL,
  "custody_reference_id" TEXT NOT NULL,
  "allowed_tools" TEXT[] NOT NULL,

  CONSTRAINT "agent_revision_integration_assignments_pkey" PRIMARY KEY ("agent_revision_id", "integration_id"),
  CONSTRAINT "agent_revision_integration_assignments_allowed_tools_check" CHECK ("has_nonempty_distinct_tool_ids"("allowed_tools")),
  CONSTRAINT "agent_revision_integration_assignments_revision_fkey" FOREIGN KEY ("agent_revision_id")
    REFERENCES "agent_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_revision_integration_assignments_integration_fkey" FOREIGN KEY ("integration_id", "silo_id")
    REFERENCES "integrations"("id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "agent_revision_integration_assignments_custody_fkey" FOREIGN KEY ("custody_reference_id", "integration_id", "silo_id")
    REFERENCES "integration_custody_references"("id", "integration_id", "silo_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "agent_revision_integration_assignments_integration_id_silo_id_idx"
  ON "agent_revision_integration_assignments"("integration_id", "silo_id");

CREATE FUNCTION "enforce_integration_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'active' THEN RAISE EXCEPTION 'a new Integration must begin Active'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Integration rows cannot be deleted'; END IF;
  IF OLD."state" = 'retired' THEN RAISE EXCEPTION 'a Retired Integration is closed'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id"
    OR NEW."obot_catalog_entry_id" IS DISTINCT FROM OLD."obot_catalog_entry_id" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Integration identity is immutable';
  END IF;
  IF NEW."state" NOT IN ('active', 'retired') THEN RAISE EXCEPTION 'invalid Integration lifecycle transition'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "integrations_closed_lifecycle"
  BEFORE INSERT OR UPDATE OR DELETE ON "integrations"
  FOR EACH ROW EXECUTE FUNCTION "enforce_integration_lifecycle"();

CREATE FUNCTION "enforce_integration_custody_lifecycle"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" = 'ready' AND NEW."expires_at" <= NEW."created_at" THEN
      RAISE EXCEPTION 'a Ready custody reference must expire after creation';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Integration custody references cannot be deleted'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."integration_id" IS DISTINCT FROM OLD."integration_id"
    OR NEW."silo_id" IS DISTINCT FROM OLD."silo_id" OR NEW."obot_custody_reference" IS DISTINCT FROM OLD."obot_custody_reference"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'Integration custody identity is immutable';
  END IF;
  IF OLD."state" <> 'ready' OR NEW."state" NOT IN ('ready', 'revoked', 'expired') THEN
    RAISE EXCEPTION 'invalid Integration custody lifecycle transition';
  END IF;
  IF NEW."state" = 'expired' AND NEW."expires_at" > clock_timestamp() THEN
    RAISE EXCEPTION 'a custody reference expires only after its expiry instant';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "integration_custody_references_closed_lifecycle"
  BEFORE INSERT OR UPDATE OR DELETE ON "integration_custody_references"
  FOR EACH ROW EXECUTE FUNCTION "enforce_integration_custody_lifecycle"();

CREATE FUNCTION "enforce_agent_revision_integration_assignment_authority"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE agent_silo_id TEXT; integration_state "IntegrationState"; custody_state "IntegrationCustodyState"; custody_expiry TIMESTAMP(3); custody_revoked_at TIMESTAMP(3);
BEGIN
  SELECT service."silo_id" INTO agent_silo_id
    FROM "agent_revisions" revision JOIN "agent_services" service ON service."id" = revision."agent_service_id"
    WHERE revision."id" = NEW."agent_revision_id" FOR UPDATE OF revision, service;
  SELECT integration."state" INTO integration_state FROM "integrations" integration
    WHERE integration."id" = NEW."integration_id" AND integration."silo_id" = NEW."silo_id" FOR UPDATE;
  SELECT custody."state", custody."expires_at", custody."revoked_at"
    INTO custody_state, custody_expiry, custody_revoked_at FROM "integration_custody_references" custody
    WHERE custody."id" = NEW."custody_reference_id" AND custody."integration_id" = NEW."integration_id" AND custody."silo_id" = NEW."silo_id" FOR UPDATE;
  IF agent_silo_id IS DISTINCT FROM NEW."silo_id" OR integration_state IS DISTINCT FROM 'active'::"IntegrationState" THEN
    RAISE EXCEPTION 'AgentRevision may assign only an Active Integration from the same silo';
  END IF;
  IF custody_state IS DISTINCT FROM 'ready'::"IntegrationCustodyState" OR custody_revoked_at IS NOT NULL OR custody_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'AgentRevision may assign only a ready unexpired Integration custody reference';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "agent_revision_integration_assignments_authority"
  BEFORE INSERT OR UPDATE ON "agent_revision_integration_assignments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_integration_assignment_authority"();
CREATE TRIGGER "agent_revision_integration_assignments_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "agent_revision_integration_assignments"
  FOR EACH ROW EXECUTE FUNCTION "enforce_agent_revision_assignment_immutability"();
