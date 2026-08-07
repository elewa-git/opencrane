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

/** OpenAPI path fragments owned by the groups domain (composed into the opencrane-ui spec). */
export const _GroupsOpenapiPaths = {
  "/groups": {
    get: {
      operationId: "listGroups",
      summary: "List all groups with member counts and awareness grants",
      tags: ["Groups"],
      responses: {
        200: ok("Group list.", { type: "array", items: { $ref: "#/components/schemas/Group" } }),
      },
    },
    post: {
      operationId: "createGroup",
      summary: "Create a new group and optional awareness grants",
      tags: ["Groups"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" } } } } },
      },
      responses: {
        201: created("Group created.", { $ref: "#/components/schemas/Group" }),
      },
    },
  },

  "/groups/{id}": {
    get: {
      operationId: "getGroup",
      summary: "Get a single group by identifier",
      tags: ["Groups"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Group detail.", { $ref: "#/components/schemas/Group" }),
        404: notFound("Group not found."),
      },
    },
    put: {
      operationId: "updateGroup",
      summary: "Update a group and replace awareness grants",
      tags: ["Groups"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      },
      responses: {
        200: ok("Group updated.", { $ref: "#/components/schemas/Group" }),
      },
    },
    delete: {
      operationId: "deleteGroup",
      summary: "Delete a group and its awareness grants",
      tags: ["Groups"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Group deleted.", { type: "object", properties: { id: { type: "string" }, status: { type: "string" } } }),
      },
    },
  },
};
