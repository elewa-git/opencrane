// Common response helpers
function notFound(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function badRequest(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function forbidden(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function upstreamError()
{
  return {
    description: "Upstream dependency (Kubernetes, database, Cognee, LiteLLM) returned an error.",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function ok(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

function created(description: string, schema: object)
{
  return {
    description,
    content: { "application/json": { schema } },
  };
}

/** OpenAPI path fragments owned by the tenants domain (composed into the opencrane-ui spec). */
export const _TenantsOpenapiPaths = {
  "/tenants": {
    get: {
      operationId: "listTenants",
      summary: "List all tenants",
      tags: ["Tenants"],
      parameters: [
        { name: "clusterTenantRef", in: "query", schema: { type: "string" }, description: "Return only tenants attached to this parent ClusterTenant (customer)." },
      ],
      responses: {
        200: ok("Tenant list.", { type: "array", items: { $ref: "#/components/schemas/Tenant" } }),
      },
    },
    post: {
      operationId: "createTenant",
      summary: "Create a new tenant (admin/import path; dual-write: K8s CRD + database)",
      description: "Internal seeding (owner-default on org create; member workspace on first login) is the production funnel — this route is the admin/import path. Every workspace it creates must be routable (email) and subject-bound; when a parent clusterTenantRef is given the subject must be a member of that org.",
      tags: ["Tenants"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "displayName", "email", "subject"],
              properties: {
                name: { type: "string" },
                displayName: { type: "string" },
                email: { type: "string", format: "email" },
                subject: { type: "string", description: "IdP-verified subject (OIDC `sub`) to bind the workspace to. Required — subject-less pods degrade the compiled contract to {tenant} only." },
                team: { type: "string" },
                clusterTenantRef: { type: "string", description: "Parent ClusterTenant (customer) to attach this tenant to." },
                monthlyBudgetUsd: { type: "number" },
                resources: { type: "object" },
                policyRef: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        201: created("Tenant created.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
        400: badRequest("Missing email or subject."),
        403: forbidden("Subject is not a member of the parent organisation (FORBIDDEN_ORG_SCOPE)."),
        422: { description: "No models registered for this scope (NO_MODELS_REGISTERED) — the same ≥1-model onboarding gate the internal seed funnel enforces.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        502: upstreamError(),
        504: { description: "Tenant CR did not appear in Kubernetes within the SLO window.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      },
    },
  },

  "/tenants/{name}": {
    get: {
      operationId: "getTenant",
      summary: "Get a single tenant by name",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Tenant detail.", { $ref: "#/components/schemas/Tenant" }),
        404: notFound("Tenant not found."),
      },
    },
    put: {
      operationId: "updateTenant",
      summary: "Update a tenant (dual-write: K8s CRD + database)",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                displayName: { type: "string" },
                email: { type: "string", format: "email" },
                subject: { type: "string", description: "Re-bind the workspace to this IdP subject; must be a member of the (new or existing) parent org." },
                team: { type: "string" },
                clusterTenantRef: { type: "string", description: "Parent ClusterTenant (customer) to attach this tenant to." },
                monthlyBudgetUsd: { type: "number" },
                resources: { type: "object" },
                policyRef: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: ok("Tenant updated.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
        403: forbidden("Subject is not a member of the parent organisation (FORBIDDEN_ORG_SCOPE)."),
      },
    },
    delete: {
      operationId: "deleteTenant",
      summary: "Delete a tenant (offboarding teardown: cut the runtime pod, delete the LiteLLM key, remove CRD + DB row — retains Cognee datasets)",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Tenant deleted.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },

  "/tenants/{name}/suspend": {
    post: {
      operationId: "suspendTenant",
      summary: "Suspend a tenant (scale deployment to zero)",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Tenant suspended.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },

  "/tenants/{name}/resume": {
    post: {
      operationId: "resumeTenant",
      summary: "Resume a suspended tenant",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Tenant resumed.", { type: "object", properties: { name: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },

  "/tenants/{name}/datasets": {
    get: {
      operationId: "getTenantDatasets",
      summary: "Get dataset memberships for a tenant",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Dataset memberships.", { $ref: "#/components/schemas/DatasetMembership" }),
        404: notFound("Tenant not found."),
        502: upstreamError(),
      },
    },
    put: {
      operationId: "updateTenantDatasets",
      summary: "Update dataset memberships for a tenant",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { $ref: "#/components/schemas/DatasetMembership" } } },
      },
      responses: {
        200: ok("Dataset memberships updated.", { $ref: "#/components/schemas/DatasetMembership" }),
        400: badRequest("Invalid membership payload."),
        404: notFound("Tenant not found."),
        502: upstreamError(),
      },
    },
  },

  "/tenants/{name}/effective-contract": {
    get: {
      operationId: "getTenantEffectiveContract",
      summary: "Compile the effective awareness, MCP, and skill contract for a tenant",
      tags: ["Tenants"],
      parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Effective contract.", { $ref: "#/components/schemas/EffectiveContract" }),
        404: notFound("Tenant not found."),
      },
    },
  },
};
