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

function conflict(description: string)
{
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function unprocessable(description: string)
{
  return {
    description,
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

const nameParam = { name: "name", in: "path", required: true, schema: { type: "string" }, description: "Company doc name (workspace file stem, e.g. SOUL)." };

/** OpenAPI path fragments owned by the company-docs domain (composed into the control-plane spec). */
export const _CompanyDocsOpenapiPaths = {
  "/org/workspace-docs/{name}": {
    get: {
      operationId: "getCompanyDoc",
      summary: "Get a company doc's current state and latest content",
      tags: ["Company Docs"],
      parameters: [nameParam],
      responses: {
        200: ok("Company doc detail.", { $ref: "#/components/schemas/CompanyDoc" }),
        404: notFound("Company doc not found."),
      },
    },
    put: {
      operationId: "publishCompanyDoc",
      summary: "Publish a new immutable version of a company doc",
      description: "Appends an immutable version and bumps the doc's currentVersion. Content is rejected before any write when empty (400) or when it asserts L0 platform mechanics (422).",
      tags: ["Company Docs"],
      parameters: [nameParam],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["content"], properties: { content: { type: "string", description: "The full document content for the new version." } } } } },
      },
      responses: {
        201: created("Version published.", { type: "object", required: ["name", "version"], properties: { name: { type: "string" }, version: { type: "integer", description: "The version number assigned to the newly published content." } } }),
        400: badRequest("Content is missing or empty."),
        422: unprocessable("Content asserts L0 platform mechanics."),
      },
    },
  },

  "/org/workspace-docs/{name}/versions": {
    get: {
      operationId: "listCompanyDocVersions",
      summary: "List a company doc's published versions, newest first",
      tags: ["Company Docs"],
      parameters: [nameParam],
      responses: {
        200: ok("Version summaries, newest first.", { type: "object", required: ["name", "versions"], properties: { name: { type: "string" }, versions: { type: "array", items: { $ref: "#/components/schemas/CompanyDocVersionSummary" } } } }),
        404: notFound("Company doc not found."),
      },
    },
  },

  "/org/workspace-docs/{name}/versions/{version}": {
    get: {
      operationId: "getCompanyDocVersion",
      summary: "Retrieve a specific immutable version by number",
      tags: ["Company Docs"],
      parameters: [
        nameParam,
        { name: "version", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Monotonic version number." },
      ],
      responses: {
        200: ok("Version content and metadata.", { $ref: "#/components/schemas/CompanyDocVersion" }),
        400: badRequest("Version is not a positive integer."),
        404: notFound("Company doc or version not found."),
      },
    },
  },

  "/org/workspace-docs/{name}/reconcile": {
    post: {
      operationId: "reconcileCompanyDoc",
      summary: "Generate a reconciliation proposal for a tenant against the current company version",
      description: "Merges the tenant's doc toward the current company version. Returns 200 when the tenant is already up to date, 201 with a pending proposal otherwise. The reconciler is sandboxed to L1/L2 — an L0 breach in its output is a merge fault surfaced as 422.",
      tags: ["Company Docs"],
      parameters: [nameParam],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["tenant"], properties: { tenant: { type: "string", description: "The tenant to reconcile toward the current company version." } } } } },
      },
      responses: {
        200: ok("Tenant already reconciled to the current version.", { type: "object", required: ["status", "version"], properties: { status: { type: "string", enum: ["up-to-date"] }, version: { type: "integer" } } }),
        201: created("Reconciliation proposal generated.", { $ref: "#/components/schemas/DocProposal" }),
        400: badRequest("Tenant is missing or empty."),
        404: notFound("Tenant not found."),
        409: conflict("No company version published for this doc."),
        422: unprocessable("The merged output asserted L0 platform mechanics."),
      },
    },
  },

  "/org/workspace-docs/{name}/proposals": {
    get: {
      operationId: "listDocProposals",
      summary: "List reconciliation proposals for a doc",
      tags: ["Company Docs"],
      parameters: [
        nameParam,
        { name: "tenant", in: "query", required: false, schema: { type: "string" }, description: "Filter to proposals targeting this tenant." },
        { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pending", "approved", "rejected"] }, description: "Filter by lifecycle status." },
      ],
      responses: {
        200: ok("Proposal list.", { type: "object", required: ["name", "proposals"], properties: { name: { type: "string" }, proposals: { type: "array", items: { $ref: "#/components/schemas/DocProposal" } } } }),
      },
    },
  },

  "/org/workspace-docs/{name}/proposals/{id}/approve": {
    post: {
      operationId: "approveDocProposal",
      summary: "Approve a proposal — delivers the merged doc into the tenant workspace",
      tags: ["Company Docs"],
      parameters: [
        nameParam,
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Proposal identifier." },
      ],
      responses: {
        200: ok("Proposal approved.", { $ref: "#/components/schemas/DocProposalDecision" }),
        404: notFound("Proposal not found."),
        409: conflict("Proposal already decided."),
      },
    },
  },

  "/org/workspace-docs/{name}/proposals/{id}/reject": {
    post: {
      operationId: "rejectDocProposal",
      summary: "Reject a proposal — leaves the tenant doc untouched",
      tags: ["Company Docs"],
      parameters: [
        nameParam,
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Proposal identifier." },
      ],
      responses: {
        200: ok("Proposal rejected.", { $ref: "#/components/schemas/DocProposalDecision" }),
        404: notFound("Proposal not found."),
        409: conflict("Proposal already decided."),
      },
    },
  },
};
