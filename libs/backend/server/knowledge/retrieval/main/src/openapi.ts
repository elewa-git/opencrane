// Common response helpers
function notFound(description: string)
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

/** OpenAPI path fragments owned by the retrieval domain (composed into the opencrane-ui spec). */
export const _RetrievalOpenapiPaths = {
  "/third-party-sources": {
    get: {
      operationId: "listThirdPartySources",
      summary: "List all third-party sources",
      tags: ["Third-party Sources"],
      responses: {
        200: ok("Third-party source list.", { type: "array", items: { $ref: "#/components/schemas/ThirdPartySource" } }),
      },
    },
    post: {
      operationId: "createThirdPartySource",
      summary: "Register a new third-party source",
      tags: ["Third-party Sources"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["name", "type", "url"] } } },
      },
      responses: {
        201: created("Source registered.", { type: "object" }),
      },
    },
  },

  "/third-party-sources/{id}": {
    get: {
      operationId: "getThirdPartySource",
      summary: "Get a single third-party source",
      tags: ["Third-party Sources"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Source detail.", { $ref: "#/components/schemas/ThirdPartySource" }),
        404: notFound("Source not found."),
      },
    },
    put: {
      operationId: "updateThirdPartySource",
      summary: "Update a third-party source",
      tags: ["Third-party Sources"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        200: ok("Source updated.", { type: "object" }),
      },
    },
    delete: {
      operationId: "deleteThirdPartySource",
      summary: "Delete a third-party source and its linked items",
      tags: ["Third-party Sources"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Source deleted.", { type: "object" }),
      },
    },
  },
};
