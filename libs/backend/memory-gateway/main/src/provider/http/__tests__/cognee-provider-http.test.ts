import { describe, expect, it, vi } from "vitest";

import { CogneeProviderSessionFailureCodes } from "../../auth/cognee-provider-session.types";
import { _CreateCogneeProviderHttpClient } from "../cognee-provider-http";
import type { CogneeProviderFetch } from "../cognee-provider-http.types";

function _Client(fetch: CogneeProviderFetch, maximumResponseBytes = 32, requestTimeoutMilliseconds = 100)
{
	return _CreateCogneeProviderHttpClient({ baseUrl: "http://cognee:8000", fetch, maximumResponseBytes, requestTimeoutMilliseconds });
}

describe("Cognee provider HTTP", function _CogneeProviderHttpTests()
{
	it("copies replayable bytes for each request and keeps the bearer out of the command", async function _ReplayableBytes()
	{
		const bodies: number[][] = [];
		const authorizations: Array<string | null> = [];
		const fetchMock = vi.fn(async function _Fetch(_input: string | URL | Request, init?: RequestInit): Promise<Response>
		{
			const body = init?.body as Uint8Array;
			bodies.push([...body]);
			authorizations.push(new Headers(init?.headers).get("authorization"));
			body[0] = 99;
			return new Response("ok");
		});
		const client = _Client(fetchMock);
		const command = { method: "POST", path: "/api/v1/add", body: new Uint8Array([1, 2, 3]) };

		await client.send(command, "private-token");
		await client.send(command, "private-token");

		expect(bodies).toEqual([[1, 2, 3], [1, 2, 3]]);
		expect(authorizations).toEqual(["Bearer private-token", "Bearer private-token"]);
		expect(command.body).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("bounds a chunked response without returning partial bytes", async function _ChunkedOverflow()
	{
		const fetchMock = vi.fn(async function _Fetch(): Promise<Response>
		{
			const body = new ReadableStream<Uint8Array>({
				start(controller)
				{
					controller.enqueue(new Uint8Array([1, 2, 3]));
					controller.enqueue(new Uint8Array([4, 5, 6]));
					controller.close();
				},
			});
			return new Response(body);
		});

		await expect(_Client(fetchMock, 5).send({ method: "GET", path: "/api/v1/datasets" })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.ResponseTooLarge });
	});

	it("keeps the timeout active while consuming the response body", async function _BodyTimeout()
	{
		const fetchMock = vi.fn(async function _Fetch(): Promise<Response>
		{
			return new Response(new ReadableStream<Uint8Array>({ start() { return; } }));
		});

		await expect(_Client(fetchMock, 32, 5).send({ method: "GET", path: "/api/v1/datasets" })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.Timeout });
	});

	it("rejects unsafe origins, protocol-relative paths, and transport headers", async function _UnsafeInputs()
	{
		const fetchMock = vi.fn(async function _Unexpected(): Promise<Response> { throw new Error("unexpected fetch"); });
		expect(function _CredentialsInOrigin()
		{
			_CreateCogneeProviderHttpClient({ baseUrl: "http://user:password@cognee:8000", fetch: fetchMock, maximumResponseBytes: 32, requestTimeoutMilliseconds: 100 });
		}).toThrow(expect.objectContaining({ code: CogneeProviderSessionFailureCodes.UnsafeRequest }));
		const client = _Client(fetchMock);
		await expect(client.send({ method: "GET", path: "//other.example/api/v1/datasets" })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.UnsafeRequest });
		await expect(client.send({ method: "GET", path: "/api/v1/datasets", headers: { Cookie: "private" } })).rejects.toMatchObject({ code: CogneeProviderSessionFailureCodes.UnsafeRequest });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
