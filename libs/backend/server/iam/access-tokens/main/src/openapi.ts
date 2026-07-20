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

/** OpenAPI path fragments owned by the access-tokens domain (composed into the opencrane-ui spec). */
export const _AccessTokensOpenapiPaths = {
  "/access-tokens": {
    get: {
      operationId: "listAccessTokens",
      summary: "List all issued access tokens (hashes only, never plaintext)",
      tags: ["Access Tokens"],
      responses: {
        200: ok("Token list.", { type: "array", items: { $ref: "#/components/schemas/AccessToken" } }),
      },
    },
    post: {
      operationId: "createAccessToken",
      summary: "Create a new access token. Returns plaintext token once — store it securely.",
      tags: ["Access Tokens"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                owner: { type: "string" },
                expiresAt: { type: "string", format: "date-time" },
              },
            },
          },
        },
      },
      responses: {
        201: created("Token created. The plainTextToken field will not be returned again.", {
          type: "object",
          required: ["id", "plainTextToken"],
          properties: { id: { type: "string" }, plainTextToken: { type: "string" } },
        }),
      },
    },
  },

  "/access-tokens/{id}": {
    delete: {
      operationId: "deleteAccessToken",
      summary: "Revoke and delete an access token",
      tags: ["Access Tokens"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        204: { description: "Token deleted." },
        404: notFound("Token not found."),
      },
    },
  },
};
