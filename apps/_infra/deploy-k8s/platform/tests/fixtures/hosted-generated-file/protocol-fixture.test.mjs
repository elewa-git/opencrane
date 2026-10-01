import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { after, before, test } from "node:test";

import { startProtocolFixture } from "./protocol-fixture.mjs";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const publicUpstreamMarker = "opencrane-hosted-fixture-public-marker";
const evidenceKey = "synthetic-evidence-key";
const clientSecret = "synthetic-client-secret";
let server;
let origin;

function decodeJwtPayload(token)
{
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

before(async () => {
  server = await startProtocolFixture({
    issuer: "http://127.0.0.1",
    clientId: "hosted-client",
    clientSecret,
    redirectUri: "https://opencrane.example.test/auth/callback",
    identities: [
      { loginHint: "owner@hosted.example.test", subject: "hosted-owner", email: "owner@hosted.example.test", name: "Hosted Qualification Owner" },
      { loginHint: "admin@hosted.example.test", subject: "hosted-admin", email: "admin@hosted.example.test", name: "Hosted Qualification Admin" },
    ],
    evidenceKey,
    upstreamModel: "hosted-generated-file",
    signingPrivateKey: privateKey,
    keyId: "hosted-key",
    generatedCsvArguments: { displayName: "county-summary.csv", headers: ["County", "Customers"], rows: [["Nairobi", 3], ["Kisumu", 2]] },
    host: "127.0.0.1",
    port: 0,
  });
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("completes one-use OIDC authorization code and PKCE exchange", async () => {
  const discovery = await fetch(`${origin}/.well-known/openid-configuration`).then(response => response.json());
  assert.equal(discovery.issuer, "http://127.0.0.1");
  assert.deepEqual(discovery.code_challenge_methods_supported, ["S256"]);

  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorization = new URL(`${origin}/authorize`);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: "hosted-client",
    redirect_uri: "https://opencrane.example.test/auth/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "state-1",
    nonce: "nonce-1",
    login_hint: "owner@hosted.example.test",
  }).toString();
  const authorized = await fetch(authorization, { redirect: "manual" });
  assert.equal(authorized.status, 302);
  const callback = new URL(authorized.headers.get("location"));
  assert.equal(callback.searchParams.get("state"), "state-1");
  const tokenInput = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: "hosted-client",
    client_secret: clientSecret,
    redirect_uri: "https://opencrane.example.test/auth/callback",
    code: callback.searchParams.get("code"),
    code_verifier: verifier,
  });
  const token = await fetch(`${origin}/token`, { method: "POST", body: tokenInput }).then(response => response.json());
  assert.match(token.id_token, /^[^.]+\.[^.]+\.[^.]+$/u);
  assert.equal(token.token_type, "Bearer");
  const replay = await fetch(`${origin}/token`, { method: "POST", body: tokenInput });
  assert.equal(replay.status, 400);
  const user = await fetch(`${origin}/userinfo`, { headers: { authorization: `Bearer ${token.access_token}` } }).then(response => response.json());
  assert.deepEqual(user, { sub: "hosted-owner", email: "owner@hosted.example.test", email_verified: true, name: "Hosted Qualification Owner" });
});

test("selects the invited admin identity and isolates each authorization code", async () => {
  const authorize = async (loginHint, state) => {
    const verifier = `${loginHint}-verifier`.padEnd(64, "x");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL(`${origin}/authorize`);
    url.search = new URLSearchParams({ response_type: "code", client_id: "hosted-client", redirect_uri: "https://opencrane.example.test/auth/callback", code_challenge: challenge, code_challenge_method: "S256", state, nonce: `${state}-nonce`, login_hint: loginHint }).toString();
    const response = await fetch(url, { redirect: "manual" });
    assert.equal(response.status, 302);
    return { callback: new URL(response.headers.get("location")), verifier };
  };
  const exchange = async ({ callback, verifier }) => fetch(`${origin}/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: "hosted-client", client_secret: clientSecret, redirect_uri: "https://opencrane.example.test/auth/callback", code: callback.searchParams.get("code"), code_verifier: verifier }) }).then(response => response.json());

  const owner = await exchange(await authorize("owner@hosted.example.test", "owner"));
  const admin = await exchange(await authorize("admin@hosted.example.test", "admin"));
  const ownerInfo = await fetch(`${origin}/userinfo`, { headers: { authorization: `Bearer ${owner.access_token}` } }).then(response => response.json());
  const adminInfo = await fetch(`${origin}/userinfo`, { headers: { authorization: `Bearer ${admin.access_token}` } }).then(response => response.json());
  assert.equal(ownerInfo.sub, "hosted-owner");
  assert.equal(ownerInfo.email, "owner@hosted.example.test");
  assert.equal(adminInfo.sub, "hosted-admin");
  assert.equal(adminInfo.email, "admin@hosted.example.test");
  assert.deepEqual(
    { sub: decodeJwtPayload(owner.id_token).sub, email: decodeJwtPayload(owner.id_token).email },
    { sub: "hosted-owner", email: "owner@hosted.example.test" },
  );
  assert.deepEqual(
    { sub: decodeJwtPayload(admin.id_token).sub, email: decodeJwtPayload(admin.id_token).email },
    { sub: "hosted-admin", email: "admin@hosted.example.test" },
  );
  assert.notEqual(owner.access_token, admin.access_token);
  assert.notEqual(owner.id_token, admin.id_token);
});

test("denies missing and unknown OIDC login hints", async () => {
  const base = { response_type: "code", client_id: "hosted-client", redirect_uri: "https://opencrane.example.test/auth/callback", code_challenge: "challenge", code_challenge_method: "S256", state: "state", nonce: "nonce" };
  for (const loginHint of [undefined, "unknown@hosted.example.test"]) {
    const url = new URL(`${origin}/authorize`);
    url.search = new URLSearchParams({ ...base, ...(loginHint ? { login_hint: loginHint } : {}) }).toString();
    const response = await fetch(url);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: loginHint ? "login_required" : "login_required" });
  }
});

test("accepts the public upstream marker and records both calls", async () => {
  const inferenceHeaders = { authorization: `Bearer ${publicUpstreamMarker}`, "content-type": "application/json" };
  const tool = await fetch(`${origin}/v1/chat/completions`, {
    method: "POST",
    headers: inferenceHeaders,
    body: JSON.stringify({ model: "hosted-generated-file", parallel_tool_calls: false, messages: [{ role: "user", content: "Create the report" }], tools: [{ type: "function", function: { name: "compiled_revision_name", parameters: { type: "object" } } }] }),
  }).then(response => response.json());
  assert.equal(tool.choices[0].message.tool_calls[0].function.name, "compiled_revision_name");
  assert.deepEqual(JSON.parse(tool.choices[0].message.tool_calls[0].function.arguments), { displayName: "county-summary.csv", headers: ["County", "Customers"], rows: [["Nairobi", 3], ["Kisumu", 2]] });

  const continuation = await fetch(`${origin}/v1/chat/completions`, {
    method: "POST",
    headers: inferenceHeaders,
    body: JSON.stringify({ model: "hosted-generated-file", messages: [{ role: "tool", content: "captured" }] }),
  }).then(response => response.json());
  assert.equal(continuation.choices[0].finish_reason, "stop");
  assert.equal(continuation.choices[0].message.content, "The requested CSV file is ready.");

  const evidence = await fetch(`${origin}/__fixture/evidence`, { headers: { authorization: `Bearer ${evidenceKey}` } }).then(response => response.json());
  assert.deepEqual(evidence.offeredToolNames, ["compiled_revision_name"]);
  assert.equal(evidence.toolResponseCount, 1);
  assert.equal(evidence.continuationResponseCount, 1);

  assert.equal(evidence.modelRequestCount, 2);
});

test("rejects LiteLLM administration, invalid credentials, and the prefixed registration model on the provider wire", async () => {
  for (const path of ["/key/generate", "/model/new", "/credentials"]) {
    const response = await fetch(`${origin}${path}`, { method: "POST", headers: { authorization: `Bearer ${publicUpstreamMarker}`, "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 404);
  }
  const unauthorizedProvider = await fetch(`${origin}/v1/chat/completions`, { method: "POST", headers: { authorization: "Bearer wrong-key", "content-type": "application/json" }, body: JSON.stringify({ model: "hosted-generated-file" }) });
  assert.equal(unauthorizedProvider.status, 401);
  const prefixedWireModel = await fetch(`${origin}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${publicUpstreamMarker}`, "content-type": "application/json" }, body: JSON.stringify({ model: "openai/hosted-generated-file" }) });
  assert.equal(prefixedWireModel.status, 401);
  const unauthorizedEvidence = await fetch(`${origin}/__fixture/evidence`, { headers: { authorization: `Bearer ${publicUpstreamMarker}` } });
  assert.equal(unauthorizedEvidence.status, 401);
});
