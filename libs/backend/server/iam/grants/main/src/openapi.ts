// Common response helpers
function notFound(description: string)
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

function ok(description: string, schema: object)
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
