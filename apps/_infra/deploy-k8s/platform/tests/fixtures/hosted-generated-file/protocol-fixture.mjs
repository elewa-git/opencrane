#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAXIMUM_REQUEST_BYTES = 1024 * 1024;
const PUBLIC_UPSTREAM_MARKER = "opencrane-hosted-fixture-public-marker";
// App registration uses `openai/...`; pinned LiteLLM removes that prefix on its outgoing provider wire.
const LITELLM_WIRE_MODEL = "hosted-generated-file";

function _required(value, name)
{
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`${name} is required`);
  return value.trim();
}

function _json(response, status, value)
{
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json",
  });
  response.end(body);
}

function _bearer(request)
{
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
}

async function _body(request)
{
  const chunks = [];
  let length = 0;
  for await (const chunk of request)
  {
    length += chunk.byteLength;
    if (length > MAXIMUM_REQUEST_BYTES)
      throw new Error("request exceeds fixture byte limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, length).toString("utf8");
}

function _base64Url(value)
{
  return Buffer.from(value).toString("base64url");
}

function _jwt(privateKey, keyId, claims)
{
  const header = _base64Url(JSON.stringify({ alg: "RS256", kid: keyId, typ: "JWT" }));
  const payload = _base64Url(JSON.stringify(claims));
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export function createProtocolFixture(configuration)
{
  const issuer = new URL(_required(configuration.issuer, "issuer"));
  const clientId = _required(configuration.clientId, "clientId");
  const clientSecret = configuration.clientSecret?.trim() ?? "";
  const redirectUri = _required(configuration.redirectUri, "redirectUri");
  const identities = new Map((configuration.identities ?? []).map(identity => {
    const loginHint = _required(identity.loginHint, "identity.loginHint");
    return [loginHint, {
      email: _required(identity.email, "identity.email"),
      loginHint,
      name: _required(identity.name, "identity.name"),
      subject: _required(identity.subject, "identity.subject"),
    }];
  }));
  if (identities.size !== 2)
    throw new Error("exactly two OIDC identities are required");
  const evidenceKey = _required(configuration.evidenceKey, "evidenceKey");
  const upstreamModel = _required(configuration.upstreamModel, "upstreamModel");
  if (upstreamModel !== LITELLM_WIRE_MODEL)
    throw new Error(`upstreamModel must be ${LITELLM_WIRE_MODEL}`);
  const privateKey = configuration.signingPrivateKey?.type === "private"
    ? configuration.signingPrivateKey
    : createPrivateKey(configuration.signingPrivateKey);
  const keyId = _required(configuration.keyId, "keyId");
  const publicJwk = createPublicKey(privateKey).export({ format: "jwk" });
  const generatedCsvArguments = configuration.generatedCsvArguments;
  const authorizationCodes = new Map();
  const accessTokens = new Map();
  const evidence = {
    authorizationCount: 0,
    tokenExchangeCount: 0,
    modelRequestCount: 0,
    toolResponseCount: 0,
    continuationResponseCount: 0,
    offeredToolNames: [],
  };

  async function _handle(request, response)
  {
    try
    {
      const requestUrl = new URL(request.url ?? "/", issuer);
      if (request.method === "GET" && requestUrl.pathname === "/healthz")
        return _json(response, 200, { ready: true });

      if (request.method === "GET" && requestUrl.pathname === "/.well-known/openid-configuration")
      {
        return _json(response, 200, {
          issuer: issuer.origin,
          authorization_endpoint: `${issuer.origin}/authorize`,
          token_endpoint: `${issuer.origin}/token`,
          userinfo_endpoint: `${issuer.origin}/userinfo`,
          jwks_uri: `${issuer.origin}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: clientSecret ? ["client_secret_post", "client_secret_basic"] : ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "email", "profile"],
        });
      }

      if (request.method === "GET" && requestUrl.pathname === "/jwks")
        return _json(response, 200, { keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }] });

      if (request.method === "GET" && requestUrl.pathname === "/authorize")
      {
        const fields = Object.fromEntries(requestUrl.searchParams);
        if (fields.response_type !== "code" || fields.client_id !== clientId || fields.redirect_uri !== redirectUri
          || fields.code_challenge_method !== "S256" || !fields.code_challenge || !fields.state || !fields.nonce)
          return _json(response, 400, { error: "invalid_request" });
        const identity = identities.get(fields.login_hint ?? "");
        if (!identity)
          return _json(response, 400, { error: "login_required" });
        const code = randomBytes(24).toString("base64url");
        authorizationCodes.set(code, {
          challenge: fields.code_challenge,
          clientId: fields.client_id,
          identity,
          nonce: fields.nonce,
          redirectUri: fields.redirect_uri,
        });
        evidence.authorizationCount += 1;
        const callback = new URL(fields.redirect_uri);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", fields.state);
        response.writeHead(302, { "cache-control": "no-store", location: callback.href });
        return response.end();
      }

      if (request.method === "POST" && requestUrl.pathname === "/token")
      {
        const fields = new URLSearchParams(await _body(request));
        const code = fields.get("code") ?? "";
        const saved = authorizationCodes.get(code);
        authorizationCodes.delete(code);
        const basic = request.headers.authorization?.startsWith("Basic ")
          ? Buffer.from(request.headers.authorization.slice("Basic ".length), "base64").toString("utf8").split(":", 2)
          : [];
        const suppliedClientId = fields.get("client_id") ?? basic[0] ?? "";
        const suppliedClientSecret = fields.get("client_secret") ?? basic[1] ?? "";
        const verifier = fields.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (!saved || fields.get("grant_type") !== "authorization_code" || suppliedClientId !== clientId
          || (clientSecret && suppliedClientSecret !== clientSecret) || fields.get("redirect_uri") !== saved.redirectUri
          || challenge !== saved.challenge || !saved.identity || fields.has("login_hint"))
          return _json(response, 400, { error: "invalid_grant" });
        const now = Math.floor(Date.now() / 1000);
        const accessToken = randomBytes(32).toString("base64url");
        accessTokens.set(accessToken, saved.identity);
        evidence.tokenExchangeCount += 1;
        return _json(response, 200, {
          access_token: accessToken,
          expires_in: 300,
          id_token: _jwt(privateKey, keyId, {
            aud: clientId,
            email: saved.identity.email,
            email_verified: true,
            exp: now + 300,
            iat: now,
            iss: issuer.origin,
            name: saved.identity.name,
            nonce: saved.nonce,
            sub: saved.identity.subject,
          }),
          scope: "openid email profile",
          token_type: "Bearer",
        });
      }

      if (request.method === "GET" && requestUrl.pathname === "/userinfo")
      {
        const identity = accessTokens.get(_bearer(request));
        return identity
          ? _json(response, 200, { sub: identity.subject, email: identity.email, email_verified: true, name: identity.name })
          : _json(response, 401, { error: "invalid_token" });
      }

      if (request.method === "POST" && requestUrl.pathname === "/v1/chat/completions")
      {
        const input = JSON.parse(await _body(request));
        if (_bearer(request) !== PUBLIC_UPSTREAM_MARKER || input.model !== upstreamModel)
          return _json(response, 401, { error: "invalid_api_key" });
        evidence.modelRequestCount += 1;
        const hasToolResult = Array.isArray(input.messages) && input.messages.some(message => message?.role === "tool");
        if (hasToolResult)
        {
          evidence.continuationResponseCount += 1;
          return _json(response, 200, { choices: [{ finish_reason: "stop", index: 0, message: { content: "The requested CSV file is ready.", role: "assistant" } }] });
        }
        if (!Array.isArray(input.tools) || input.tools.length !== 1 || input.parallel_tool_calls !== false)
          return _json(response, 400, { error: "expected_one_offered_tool" });
        const offeredName = input.tools[0]?.function?.name;
        if (typeof offeredName !== "string" || offeredName === "")
          return _json(response, 400, { error: "invalid_offered_tool" });
        evidence.offeredToolNames.push(offeredName);
        evidence.toolResponseCount += 1;
        return _json(response, 200, {
          choices: [{
            finish_reason: "tool_calls",
            index: 0,
            message: {
              content: null,
              role: "assistant",
              tool_calls: [{ id: `call_${randomUUID()}`, type: "function", function: { arguments: JSON.stringify(generatedCsvArguments), name: offeredName } }],
            },
          }],
        });
      }

      if (request.method === "GET" && requestUrl.pathname === "/__fixture/evidence")
      {
        if (_bearer(request) !== evidenceKey) return _json(response, 401, { error: "invalid_api_key" });
        return _json(response, 200, { ...evidence });
      }

      return _json(response, 404, { error: "not_found" });
    }
    catch
    {
      return _json(response, 400, { error: "invalid_request" });
    }
  }

  return { handle: _handle, evidence };
}

export function startProtocolFixture(configuration)
{
  const fixture = createProtocolFixture(configuration);
  const server = configuration.tls
    ? createHttpsServer(configuration.tls, fixture.handle)
    : createHttpServer(fixture.handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(configuration.port, configuration.host, () => resolve(server));
  });
}

async function _main()
{
  const issuer = _required(process.env.HOSTED_FIXTURE_ISSUER, "HOSTED_FIXTURE_ISSUER");
  if (!issuer.startsWith("https://"))
    throw new Error("HOSTED_FIXTURE_ISSUER must use HTTPS");
  const keyPath = _required(process.env.HOSTED_FIXTURE_TLS_KEY_PATH, "HOSTED_FIXTURE_TLS_KEY_PATH");
  const certificatePath = _required(process.env.HOSTED_FIXTURE_TLS_CERTIFICATE_PATH, "HOSTED_FIXTURE_TLS_CERTIFICATE_PATH");
  const generatedCsvArguments = JSON.parse(_required(process.env.HOSTED_FIXTURE_CSV_ARGUMENTS, "HOSTED_FIXTURE_CSV_ARGUMENTS"));
  const configuration = {
    issuer,
    clientId: _required(process.env.HOSTED_FIXTURE_OIDC_CLIENT_ID, "HOSTED_FIXTURE_OIDC_CLIENT_ID"),
    clientSecret: process.env.HOSTED_FIXTURE_OIDC_CLIENT_SECRET,
    redirectUri: _required(process.env.HOSTED_FIXTURE_OIDC_REDIRECT_URI, "HOSTED_FIXTURE_OIDC_REDIRECT_URI"),
    identities: [
      {
        loginHint: _required(process.env.HOSTED_FIXTURE_OIDC_OWNER_EMAIL, "HOSTED_FIXTURE_OIDC_OWNER_EMAIL"),
        subject: _required(process.env.HOSTED_FIXTURE_OIDC_OWNER_SUBJECT, "HOSTED_FIXTURE_OIDC_OWNER_SUBJECT"),
        email: _required(process.env.HOSTED_FIXTURE_OIDC_OWNER_EMAIL, "HOSTED_FIXTURE_OIDC_OWNER_EMAIL"),
        name: "Hosted Qualification Owner",
      },
      {
        loginHint: _required(process.env.HOSTED_FIXTURE_OIDC_REQUESTER_EMAIL, "HOSTED_FIXTURE_OIDC_REQUESTER_EMAIL"),
        subject: _required(process.env.HOSTED_FIXTURE_OIDC_REQUESTER_SUBJECT, "HOSTED_FIXTURE_OIDC_REQUESTER_SUBJECT"),
        email: _required(process.env.HOSTED_FIXTURE_OIDC_REQUESTER_EMAIL, "HOSTED_FIXTURE_OIDC_REQUESTER_EMAIL"),
        name: "Hosted Qualification Admin",
      },
    ],
    evidenceKey: _required(process.env.HOSTED_FIXTURE_EVIDENCE_KEY, "HOSTED_FIXTURE_EVIDENCE_KEY"),
    upstreamModel: _required(process.env.HOSTED_FIXTURE_UPSTREAM_MODEL, "HOSTED_FIXTURE_UPSTREAM_MODEL"),
    signingPrivateKey: readFileSync(_required(process.env.HOSTED_FIXTURE_SIGNING_KEY_PATH, "HOSTED_FIXTURE_SIGNING_KEY_PATH")),
    keyId: _required(process.env.HOSTED_FIXTURE_SIGNING_KEY_ID, "HOSTED_FIXTURE_SIGNING_KEY_ID"),
    generatedCsvArguments,
    host: process.env.HOSTED_FIXTURE_HOST?.trim() || "0.0.0.0",
    port: Number(process.env.HOSTED_FIXTURE_PORT ?? "9443"),
  };
  const fixture = createProtocolFixture(configuration);
  const tlsServer = createHttpsServer({ key: readFileSync(keyPath), cert: readFileSync(certificatePath) }, fixture.handle);
  const modelServer = createHttpServer(fixture.handle);
  await Promise.all([
    new Promise((resolve, reject) => { tlsServer.once("error", reject); tlsServer.listen(configuration.port, configuration.host, resolve); }),
    new Promise((resolve, reject) => { modelServer.once("error", reject); modelServer.listen(4000, configuration.host, resolve); }),
  ]);
  process.stderr.write("[hosted-protocol-fixture] ready\n");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
{
  _main().catch(error => {
    process.stderr.write(`[hosted-protocol-fixture] ${error instanceof Error ? error.message : "startup failed"}\n`);
    process.exitCode = 1;
  });
}
