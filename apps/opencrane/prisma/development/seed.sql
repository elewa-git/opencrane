-- This seed is applied only after the reviewed 0.11 target baseline creates an empty Tier 2 database.
-- It establishes one fixed browser identity and model route; production never reads or runs this file.
INSERT INTO principals (id, silo_id, issuer, subject, provenance, email, display_name, updated_at)
VALUES (
  'local-development-principal',
  'local-development',
  'https://identity.local.opencrane',
  'local-development-user',
  'external',
  'developer@local.opencrane',
  'OpenCrane developer',
  CURRENT_TIMESTAMP
)
ON CONFLICT (silo_id, issuer, subject) DO UPDATE SET
  provenance = EXCLUDED.provenance,
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  updated_at = EXCLUDED.updated_at;

INSERT INTO org_memberships (id, cluster_tenant, subject, email, display_name, role, status, updated_at)
VALUES (
  'local-development-membership',
  'local-development',
  'local-development-user',
  'developer@local.opencrane',
  'OpenCrane developer',
  'owner',
  'active',
  CURRENT_TIMESTAMP
)
ON CONFLICT (cluster_tenant, subject) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at;

INSERT INTO model_definitions (
  id,
  silo_id,
  scope,
  cluster_tenant,
  public_model_name,
  litellm_model_id,
  upstream_model,
  is_default,
  updated_at
)
VALUES (
  'local-development-model-auto',
  'local-development',
  'global',
  NULL,
  'auto',
  'local-development-auto',
  'opencrane/local-development',
  TRUE,
  CURRENT_TIMESTAMP
)
ON CONFLICT (id, silo_id) DO UPDATE SET
  public_model_name = EXCLUDED.public_model_name,
  litellm_model_id = EXCLUDED.litellm_model_id,
  upstream_model = EXCLUDED.upstream_model,
  is_default = EXCLUDED.is_default,
  updated_at = EXCLUDED.updated_at;

INSERT INTO model_routing_defaults (id, silo_id, scope, cluster_tenant, default_model, updated_at)
VALUES (
  'local-development-model-routing-default',
  'local-development',
  'global',
  NULL,
  'auto',
  CURRENT_TIMESTAMP
)
ON CONFLICT (id, silo_id) DO UPDATE SET
  default_model = EXCLUDED.default_model,
  updated_at = EXCLUDED.updated_at;
