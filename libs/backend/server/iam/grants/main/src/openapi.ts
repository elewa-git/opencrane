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

function unauthorized(description: string)
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

/** OpenAPI path fragments owned by the grants domain (composed into the opencrane-ui spec). */
export const _GrantsOpenapiPaths = {
  "/resource-shares": {
    get: {
      operationId: "listResourceShares",
      summary: "List the file/chat/dataset shares owned by or granted to the caller",
      tags: ["Shares"],
      responses: {
        200: ok("Resource shares the caller is in.", { type: "array", items: { $ref: "#/components/schemas/ResourceShare" } }),
        401: unauthorized("Authentication required."),
      },
    },
    post: {
      operationId: "shareResource",
      summary: "Share a file/chat/dataset with a local Principal",
      tags: ["Shares"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: {
          type: "object",
          required: ["resourceType", "resourceId", "recipientPrincipalId"],
          properties: {
            resourceType: { type: "string", enum: ["file", "chat", "dataset"] },
            resourceId: { type: "string" },
            recipientPrincipalId: { type: "string", description: "Stable local Principal identifier." },
          },
        } } },
      },
      responses: {
        201: created("Resource share created.", { $ref: "#/components/schemas/ResourceShare" }),
        200: ok("Recipient added (or already present).", { $ref: "#/components/schemas/ResourceShare" }),
        400: badRequest("Invalid resource share request."),
        401: unauthorized("Authentication required."),
        403: forbidden("You can only share a resource you have access to."),
      },
    },
  },

  "/resource-shares/{shareId}/recipients/{principalId}": {
    delete: {
      operationId: "revokeResourceShare",
      summary: "Revoke a recipient from a resource share",
      tags: ["Shares"],
      parameters: [
        { name: "shareId", in: "path", required: true, schema: { type: "string" } },
        { name: "principalId", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        204: { description: "Recipient and linked grant revoked." },
        401: unauthorized("Authentication required."),
        404: notFound("Resource share not found, or caller is not a member."),
      },
    },
  },
};
