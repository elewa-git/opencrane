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

const nameParam = { name: "name", in: "path", required: true, schema: { type: "string" }, description: "Culture doc name (workspace file stem, e.g. SOUL)." };

/** OpenAPI path fragments owned by the org-culture-propagation domain (composed into the control-plane spec). */
export const _CultureDocsOpenapiPaths = {
  "/org/culture-docs/{name}": {
    get: {
      operationId: "getCultureDoc",
      summary: "Get a culture doc's current state and latest content",
      tags: ["Org Culture"],
      parameters: [nameParam],
      responses: {
        200: ok("Culture doc detail.", { $ref: "#/components/schemas/CultureDoc" }),
        404: notFound("Culture doc not found."),
      },
    },
    put: {
      operationId: "publishCultureDoc",
      summary: "Publish a new immutable version of a culture doc",
      description: "Appends an immutable version and bumps the doc's currentVersion. Content is rejected before any write when empty (400) or when it asserts L0 platform mechanics (422).",
      tags: ["Org Culture"],
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

  "/org/culture-docs/{name}/versions": {
    get: {
      operationId: "listCultureDocVersions",
      summary: "List a culture doc's published versions, newest first",
      tags: ["Org Culture"],
      parameters: [nameParam],
      responses: {
        200: ok("Version summaries, newest first.", { type: "object", required: ["name", "versions"], properties: { name: { type: "string" }, versions: { type: "array", items: { $ref: "#/components/schemas/CultureDocVersionSummary" } } } }),
        404: notFound("Culture doc not found."),
      },
    },
  },

  "/org/culture-docs/{name}/versions/{version}": {
    get: {
      operationId: "getCultureDocVersion",
      summary: "Retrieve a specific immutable version by number",
      tags: ["Org Culture"],
      parameters: [
        nameParam,
        { name: "version", in: "path", required: true, schema: { type: "integer", minimum: 1 }, description: "Monotonic version number." },
      ],
      responses: {
        200: ok("Version content and metadata.", { $ref: "#/components/schemas/CultureDocVersion" }),
        400: badRequest("Version is not a positive integer."),
        404: notFound("Culture doc or version not found."),
      },
    },
  },

  "/org/culture-docs/{name}/propagate": {
    post: {
      operationId: "propagateCultureDoc",
      summary: "Generate a propagation proposal for a tenant against the current culture version",
      description: "Merges the tenant's doc toward the current culture version. Returns 200 when the tenant is already up to date, 201 with a pending proposal otherwise. The merge engine is sandboxed to L1/L2 — an L0 breach in its output is a merge fault surfaced as 422.",
      tags: ["Org Culture"],
      parameters: [nameParam],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["tenant"], properties: { tenant: { type: "string", description: "The tenant to propagate the current culture version toward." } } } } },
      },
      responses: {
        200: ok("Tenant already propagated to the current version.", { type: "object", required: ["status", "version"], properties: { status: { type: "string", enum: ["up-to-date"] }, version: { type: "integer" } } }),
        201: created("Propagation proposal generated.", { $ref: "#/components/schemas/PropagationProposal" }),
        400: badRequest("Tenant is missing or empty."),
        404: notFound("Tenant not found."),
        409: conflict("No culture version published for this doc."),
        422: unprocessable("The merged output asserted L0 platform mechanics."),
      },
    },
  },

  "/org/culture-docs/{name}/proposals": {
    get: {
      operationId: "listPropagationProposals",
      summary: "List propagation proposals for a doc",
      tags: ["Org Culture"],
      parameters: [
        nameParam,
        { name: "tenant", in: "query", required: false, schema: { type: "string" }, description: "Filter to proposals targeting this tenant." },
        { name: "status", in: "query", required: false, schema: { type: "string", enum: ["pending", "approved", "rejected"] }, description: "Filter by lifecycle status." },
      ],
      responses: {
        200: ok("Proposal list.", { type: "object", required: ["name", "proposals"], properties: { name: { type: "string" }, proposals: { type: "array", items: { $ref: "#/components/schemas/PropagationProposal" } } } }),
      },
    },
  },

  "/org/culture-docs/{name}/proposals/{id}/approve": {
    post: {
      operationId: "approvePropagationProposal",
      summary: "Approve a proposal — delivers the merged doc into the tenant workspace",
      tags: ["Org Culture"],
      parameters: [
        nameParam,
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Proposal identifier." },
      ],
      responses: {
        200: ok("Proposal approved.", { $ref: "#/components/schemas/PropagationDecision" }),
        404: notFound("Proposal not found."),
        409: conflict("Proposal already decided."),
      },
    },
  },

  "/org/culture-docs/{name}/proposals/{id}/reject": {
    post: {
      operationId: "rejectPropagationProposal",
      summary: "Reject a proposal — leaves the tenant doc untouched",
      tags: ["Org Culture"],
      parameters: [
        nameParam,
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Proposal identifier." },
      ],
      responses: {
        200: ok("Proposal rejected.", { $ref: "#/components/schemas/PropagationDecision" }),
        404: notFound("Proposal not found."),
        409: conflict("Proposal already decided."),
      },
    },
  },
};
