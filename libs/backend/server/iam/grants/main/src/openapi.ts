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
      summary: "List the file/chat resource shares the caller is a member of",
      tags: ["Shares"],
      responses: {
        200: ok("Resource shares the caller is in.", { type: "array", items: { $ref: "#/components/schemas/ResourceShare" } }),
        401: unauthorized("Authentication required."),
      },
    },
    post: {
      operationId: "shareResource",
      summary: "Share a file/chat with a user (creates/extends the resource's share group)",
      tags: ["Shares"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: {
          type: "object",
          required: ["resourceType", "resourceId", "recipientSubject"],
          properties: {
            resourceType: { type: "string", enum: ["file", "chat", "dataset"] },
            resourceId: { type: "string" },
            recipientSubject: { type: "string", description: "IdP subject of the user to share with." },
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

  "/resource-shares/{groupId}/recipients/{subject}": {
    delete: {
      operationId: "revokeResourceShare",
      summary: "Revoke a recipient from a resource share",
      tags: ["Shares"],
      parameters: [
        { name: "groupId", in: "path", required: true, schema: { type: "string" } },
        { name: "subject", in: "path", required: true, schema: { type: "string" } },
      ],
      responses: {
        200: ok("Recipient revoked.", { $ref: "#/components/schemas/ResourceShare" }),
        401: unauthorized("Authentication required."),
        404: notFound("Resource share not found, or caller is not a member."),
      },
    },
  },

  "/shares": {
    get: {
      operationId: "listShares",
      summary: "List the shares the authenticated caller has created",
      tags: ["Shares"],
      responses: {
        200: ok("Shares created by the caller.", { type: "array", items: { $ref: "#/components/schemas/Share" } }),
        401: unauthorized("Authentication required."),
      },
    },
    post: {
      operationId: "createShare",
      summary: "Share an entitlement you hold with another user or group (least-privilege bounded)",
      tags: ["Shares"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: {
          type: "object",
          required: ["payloadType", "payloadId", "recipientType", "recipientId"],
          properties: {
            payloadType: { type: "string", enum: ["mcp-server"] },
            payloadId: { type: "string" },
            recipientType: { type: "string", enum: ["user", "group"] },
            recipientId: { type: "string" },
            scope: { type: "string", enum: ["org", "department", "project", "personal"], default: "personal" },
            note: { type: "string" },
          },
        } } },
      },
      responses: {
        201: created("Share created.", { $ref: "#/components/schemas/Share" }),
        200: ok("An identical share already existed (idempotent).", { $ref: "#/components/schemas/Share" }),
        400: badRequest("Invalid share request."),
        401: unauthorized("Authentication required."),
        403: forbidden("You can only share an entitlement you currently hold."),
        404: notFound("Payload or recipient group not found."),
      },
    },
  },

  "/shares/{id}": {
    delete: {
      operationId: "revokeShare",
      summary: "Revoke a share you created",
      tags: ["Shares"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Share revoked.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
        401: unauthorized("Authentication required."),
        404: notFound("Share not found, or not one the caller created."),
      },
    },
  },
};
