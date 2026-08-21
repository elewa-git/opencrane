function notFound(description: string)
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

function badRequest(description: string)
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

/**
 * Publishes the group response and mutation schemas through the aggregated OpenAPI document.
 * `parentId` arranges groups for clients but does not add inherited members or grants.
 *
 * Called by: `_DomainOpenapiSchemas` in the API-spec package.
 */
export const _GroupsOpenapiSchemas = {
  Group: {
    type: "object" as const,
    required: ["id", "name", "scope", "parentId", "members", "memberCount", "grants"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      scope: { type: "string", enum: ["org", "department", "team", "project", "personal"] },
      parentId: { type: "string", nullable: true, description: "Parent group identifier, or null for a hierarchy root." },
      description: { type: "string" },
      members: { type: "array", items: { type: "string" } },
      memberCount: { type: "integer" },
      grants: { type: "array", items: { type: "object" } },
    },
  },
  GroupMutationResponse: {
    type: "object" as const,
    required: ["id", "status"],
    properties: {
      id: { type: "string" },
      status: { type: "string", enum: ["created", "updated", "deleted"] },
    },
  },
};

/**
 * Documents the group routes next to the router that owns their request and error semantics.
 * Called by: `_DomainOpenapiPaths`, which composes these fragments into the public API spec.
 */
export const _GroupsOpenapiPaths = {
  "/groups": {
    get: {
      operationId: "listGroups",
      summary: "List all groups with hierarchy, members, and grants",
      tags: ["Groups"],
      responses: {
        200: ok("Group list.", { type: "array", items: { $ref: "#/components/schemas/Group" } }),
      },
    },
    post: {
      operationId: "createGroup",
      summary: "Create a new group",
      tags: ["Groups"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: false, required: ["name", "scope"], properties: { name: { type: "string", minLength: 1 }, scope: { type: "string", enum: ["org", "department", "project", "personal"] }, parentId: { type: "string", minLength: 1, nullable: true }, description: { type: "string" }, members: { type: "array", items: { type: "string", minLength: 1 } } } } } },
      },
      responses: {
        201: created("Group created.", { $ref: "#/components/schemas/GroupMutationResponse" }),
        400: badRequest("Invalid group request."),
        404: notFound("Parent group not found."),
        409: conflict("A group with this name already exists."),
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
      summary: "Update a group",
      tags: ["Groups"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", additionalProperties: false, properties: { name: { type: "string", minLength: 1 }, scope: { type: "string", enum: ["org", "department", "project", "personal"] }, parentId: { type: "string", minLength: 1, nullable: true }, description: { type: "string" }, members: { type: "array", items: { type: "string", minLength: 1 } } } } } },
      },
      responses: {
        200: ok("Group updated.", { $ref: "#/components/schemas/GroupMutationResponse" }),
        400: badRequest("Invalid group request."),
        404: notFound("Group or parent group not found."),
        409: conflict("Group hierarchy conflict."),
      },
    },
    delete: {
      operationId: "deleteGroup",
      summary: "Delete a group",
      tags: ["Groups"],
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        200: ok("Group deleted.", { $ref: "#/components/schemas/GroupMutationResponse" }),
        404: notFound("Group not found."),
        409: conflict("Group still has children."),
      },
    },
  },
};
