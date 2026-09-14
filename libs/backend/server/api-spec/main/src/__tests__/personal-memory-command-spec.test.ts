import { describe, expect, it } from "vitest";

import { spec } from "../spec";

describe("personal memory command API contract", function _Suite()
{
	it("publishes closed, content-free command admission and status schemas", function _Contract()
	{
		const post = spec.paths["/me/memory/commands"].post;
		const get = spec.paths["/me/memory/commands/{commandId}"].get;
		const requestSchema = post.requestBody.content["application/json"].schema;
		const receiptSchema = get.responses[200].content["application/json"].schema;
		const commandIdSchema = get.parameters[0].schema;

		expect(post.requestBody.required).toBe(true);
		expect(requestSchema.oneOf).toHaveLength(3);
		for (const variant of requestSchema.oneOf)
		{
			expect(variant).toMatchObject({ type: "object", additionalProperties: false });
			expect(variant.required).toContain("commandId");
			expect(variant.properties.commandId).toEqual(commandIdSchema);
		}

		expect(receiptSchema).toMatchObject({ type: "object", additionalProperties: false });
		expect(receiptSchema.required).toEqual(["commandId", "operationId", "kind", "state", "revision", "resultFactId"]);
		expect(Object.keys(receiptSchema.properties)).toEqual(receiptSchema.required);
		expect(receiptSchema.properties).not.toHaveProperty("source");
		expect(receiptSchema.properties).not.toHaveProperty("payload");
		expect(receiptSchema.properties).not.toHaveProperty("provider");
		expect(receiptSchema.properties).not.toHaveProperty("dataset");
		expect(receiptSchema.properties).not.toHaveProperty("content");
	});

	it("requires authentication and documents the admission, retry, read, and failure statuses", function _Statuses()
	{
		const post = spec.paths["/me/memory/commands"].post;
		const get = spec.paths["/me/memory/commands/{commandId}"].get;

		expect(post.responses).toEqual(expect.objectContaining({ 200: expect.any(Object), 202: expect.any(Object), 400: expect.any(Object), 401: expect.any(Object), 404: expect.any(Object), 409: expect.any(Object), 503: expect.any(Object) }));
		expect(get.responses).toEqual(expect.objectContaining({ 200: expect.any(Object), 400: expect.any(Object), 401: expect.any(Object), 404: expect.any(Object), 503: expect.any(Object) }));
		expect(get.responses).not.toHaveProperty("409");
		expect(post.responses[401].description).toContain("Authentication required");
		expect(get.responses[401].description).toContain("Authentication required");
	});
});
