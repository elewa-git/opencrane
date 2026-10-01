import { randomUUID } from "node:crypto";

import { __HostedArray as _Array, __HostedAsset as _Asset, __HostedNumber as _Number, __HostedRecord as _Record, __HostedRun as _Run, __HostedString as _String, __HostedToolSelection as _ToolSelection, __HostedValidation as _Validation } from "./hosted-generated-file-response";
import { __HostedGeneratedFileDelay as _Delay, __HostedGeneratedFileRemaining as _Remaining, __HostedGeneratedFileRequestSignal as _RequestSignal } from "./hosted-generated-file-timeout";
import type { HostedGeneratedFileAsset, HostedGeneratedFileFetch, HostedGeneratedFileHttpResponse, HostedGeneratedFileOciValidation, HostedGeneratedFileRun, HostedGeneratedFileToolSelection } from "./hosted-generated-file.types";

/** Public marker accepted only by the disposable synthetic OpenAI-compatible provider. */
const _HOSTED_PROVIDER_MARKER = "opencrane-hosted-fixture-public-marker";

/** Public HTTP client that becomes mutation-closed after the first activation command. */
export class HostedGeneratedFilePublicClient
{
	private readonly baseUrl: URL;
	private readonly fetch: HostedGeneratedFileFetch;
	private readonly oidcTransportBaseUrl: URL | null;
	private readonly requestTimeoutMilliseconds: number;
	private readonly cookies = new Map<string, string>();
	private admittedCommand: { readonly conversationId: string; readonly body: object } | null = null;

	/** Bind the fixture to one public origin and optional provider-only transport origin. */
	constructor(baseUrl: URL, oidcTransportBaseUrl: URL | null = null, fetchImplementation: HostedGeneratedFileFetch = globalThis.fetch, requestTimeoutMilliseconds = 300_000)
	{
		if (baseUrl.protocol !== "https:")
			throw new Error("Hosted qualification requires an HTTPS public server origin");
		if (oidcTransportBaseUrl !== null && oidcTransportBaseUrl.protocol !== "https:")
			throw new Error("Hosted qualification requires an HTTPS OIDC transport origin");
		if (!Number.isSafeInteger(requestTimeoutMilliseconds) || requestTimeoutMilliseconds < 1)
			throw new Error("Hosted qualification request timeout must be a positive integer");
		this.baseUrl = baseUrl;
		this.oidcTransportBaseUrl = oidcTransportBaseUrl;
		this.fetch = fetchImplementation;
		this.requestTimeoutMilliseconds = requestTimeoutMilliseconds;
	}

	/** Complete a normal authorization-code login and retain only the server session cookie. */
	async login(expectedIdentity?: { readonly subject: string; readonly email: string }): Promise<void>
	{
		const login = await this._Request("/api/v1/auth/login?returnTo=%2F", { method: "GET" }, [302]);
		const providerLocation = _Location(login);
		const providerUrl = this._ProviderTransportUrl(providerLocation);
		if (expectedIdentity !== undefined)
			providerUrl.searchParams.set("login_hint", expectedIdentity.email);
		const authorization = await this.fetch(providerUrl, { method: "GET", redirect: "manual", signal: _RequestSignal(this.requestTimeoutMilliseconds) });
		if (authorization.status !== 302)
			throw new Error(`OIDC authorization returned ${authorization.status}`);
		const callback = new URL(_Location(authorization), this.baseUrl);
		if (callback.origin !== this.baseUrl.origin || callback.pathname !== "/api/v1/auth/callback")
			throw new Error("OIDC fixture returned outside the configured OpenCrane callback");
		await this._Request(callback, { method: "GET" }, [302]);
		const status = _Record(await (await this._Request("/api/v1/auth/me", { method: "GET" }, [200])).json());
		if (status["authenticated"] !== true)
			throw new Error("OIDC login did not establish an authenticated public session");
		if (expectedIdentity !== undefined)
		{
			const user = _Record(status["user"]);
			if (user["sub"] !== expectedIdentity.subject || user["email"] !== expectedIdentity.email)
				throw new Error("OIDC login established a different synthetic identity");
		}
	}

	/** Create one public Admin invitation and return only its opaque acceptance token. */
	async inviteAdministrator(email: string): Promise<string>
	{
		this._RequireMutable("invite an administrator");
		const response = _Record(await this._Json("/api/v1/organization/members/invitations", "POST", { emails: [email], role: "admin" }, [200, 201], { "Idempotency-Key": randomUUID() }));
		const invitation = _Record(_Array(response["invitations"], "organization invitations")[0]);
		const link = new URL(_String(invitation["inviteLink"], "organization invitation link"), this.baseUrl);
		const token = link.searchParams.get("token");
		if (token === null || token.length === 0)
			throw new Error("Hosted administrator invitation omitted its opaque token");
		return token;
	}

	/** Accept the Owner-issued organization invitation as the current identity. */
	async acceptInvitation(token: string): Promise<void>
	{
		this._RequireMutable("accept an organization invitation");
		const response = _Record(await this._Json("/api/v1/organization/members/invitations/accept", "POST", { token }, [200]));
		const member = _Record(response["member"]);
		if (member["role"] !== "admin" || member["status"] !== "active" || member["isCurrentUser"] !== true)
			throw new Error("Hosted administrator invitation was not accepted");
	}

	/** Configure the synthetic OpenAI provider through the durable public BYOK owner. */
	async configureOpenAiProvider(timeoutMilliseconds: number): Promise<void>
	{
		this._RequireMutable("configure the OpenAI provider");
		let commandId: string | null = null;
		const deadline = Date.now() + timeoutMilliseconds;
		do
		{
			const body = commandId === null ? { apiKey: _HOSTED_PROVIDER_MARKER } : { apiKey: _HOSTED_PROVIDER_MARKER, commandId };
			const response = await this._Request("/api/v1/providers/byok/openai", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, [200, 409, 503], _Remaining(deadline, "OpenAI provider registration"));
			const value = _Record(await response.json());
			if (response.status === 409)
				throw new Error("Hosted OpenAI provider configuration is busy");
			if (response.status === 200)
			{
				if (value["provider"] !== "openai" || value["configured"] !== true || value["litellmRegistered"] !== true)
					throw new Error("Hosted OpenAI provider did not reach registered public status");
				return;
			}
			if (value["code"] !== "PROVIDER_EFFECT_PENDING")
				throw new Error("Hosted OpenAI provider failed before durable admission");
			const pendingCommandId = _String(value["commandId"], "pending OpenAI provider command id");
			if (commandId !== null && commandId !== pendingCommandId)
				throw new Error("Hosted OpenAI provider resume changed its admitted command");
			commandId = pendingCommandId;
			await _Delay(250, deadline, "OpenAI provider registration");
		} while (Date.now() < deadline);
		throw new Error("Hosted OpenAI provider registration did not complete before timeout");
	}

	/** Resolve the exact entitled OpenAI catalogue row to its public credential coordinate. */
	async openAiProviderCredentialId(): Promise<string>
	{
		const response = await this._Json("/api/v1/models", "GET", undefined, [200]);
		const matches = _Array(response, "model definitions").map(_Record).filter(function _Flagship(model) { return model["publicModelName"] === "openai/gpt-5.5"; });
		if (matches.length !== 1)
			throw new Error("Hosted model catalogue did not expose one entitled OpenAI flagship");
		return _String(matches[0]!["providerCredentialId"], "OpenAI provider credential id");
	}

	/** Create and durably register the one generated-output model through its public owner. */
	async createModelDefinition(siloId: string, apiBase: string, providerCredentialId: string, timeoutMilliseconds: number): Promise<string>
	{
		this._RequireMutable("create a model definition");
		if (!/^http:\/\/hosted-generated-file-protocol\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.svc:4000\/v1$/u.test(apiBase))
			throw new Error("Hosted provider API base must be the namespace-derived fixture service URL");
		const body = { scope: "clusterTenant", clusterTenant: siloId, publicModelName: "hosted-generated-file-model", upstreamModel: "openai/hosted-generated-file", apiBase, providerCredentialId, generatedOutputCapabilities: ["code_execution_files"] };
		const deadline = Date.now() + timeoutMilliseconds;
		let response = await this._Request("/api/v1/models", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }, [201, 409, 503], _Remaining(deadline, "model registration"));
		let value = _Record(await response.json());
		if (response.status === 409)
			throw new Error("Hosted model registration is busy");
		if (response.status === 503)
		{
			const modelDefinitionId = _String(value["modelDefinitionId"], "pending model definition id");
			const commandId = _String(value["commandId"], "pending model registration command id");
			if (value["code"] !== "PROVIDER_EFFECT_PENDING")
				throw new Error("Hosted model registration failed before durable admission");
			do
			{
				await _Delay(250, deadline, "model registration");
				response = await this._Request(`/api/v1/models/${encodeURIComponent(modelDefinitionId)}/registration-commands/${encodeURIComponent(commandId)}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }, [200, 503], _Remaining(deadline, "model registration"));
				value = _Record(await response.json());
				if (response.status === 200)
					break;
				if (value["code"] !== "PROVIDER_EFFECT_PENDING" || value["modelDefinitionId"] !== modelDefinitionId || value["commandId"] !== commandId)
					throw new Error("Hosted model registration resume changed its admitted coordinates");
			} while (Date.now() < deadline);
			if (response.status !== 200)
				throw new Error("Hosted model registration did not complete before timeout");
		}
		const generatedOutputCapabilities = _Array(value["generatedOutputCapabilities"], "model generated-output capabilities");
		if (value["scope"] !== "clusterTenant" || value["clusterTenant"] !== siloId || value["publicModelName"] !== "hosted-generated-file-model" || value["upstreamModel"] !== "openai/hosted-generated-file" || value["apiBase"] !== apiBase || value["providerCredentialId"] !== providerCredentialId || generatedOutputCapabilities.length !== 1 || generatedOutputCapabilities[0] !== "code_execution_files")
			throw new Error("Hosted model registration response changed its exact definition");
		return _String(value["id"], "model definition id");
	}

	/** Select the registered model as the exact tenant default. */
	async setTenantModelDefault(siloId: string): Promise<void>
	{
		this._RequireMutable("select a model default");
		const value = _Record(await this._Json("/api/v1/model-routing/defaults", "PUT", { scope: "clusterTenant", clusterTenant: siloId, defaultModel: "hosted-generated-file-model" }, [200]));
		if (value["scope"] !== "clusterTenant" || value["clusterTenant"] !== siloId || value["defaultModel"] !== "hosted-generated-file-model")
			throw new Error("Hosted model default response changed its exact selection");
	}

	/** Complete the server-selected persona interview and approve its real draft. */
	async completePersona(): Promise<string>
	{
		this._RequireMutable("complete persona onboarding");
		await this._Json("/api/v1/me/persona/", "GET", undefined, [200]);
		const started = _Record(await this._Json("/api/v1/me/persona/interview", "POST", {}, [200]));
		const interviewId = _String(started["interviewId"], "persona interview id");
		const questions = _Array(started["questions"], "persona questions");
		for (const value of questions)
		{
			const question = _Record(value);
			const choices = _Array(question["choices"], "persona question choices");
			if (choices.length === 0)
				throw new Error("Hosted persona question omitted choices");
			await this._Json(`/api/v1/me/persona/interviews/${encodeURIComponent(interviewId)}/answers/${encodeURIComponent(_String(question["id"], "persona question id"))}`, "POST", { choiceId: _String(_Record(choices[0])["id"], "persona choice id") }, [201]);
		}
		let score = _Record(await this._Json(`/api/v1/me/persona/interviews/${encodeURIComponent(interviewId)}/complete`, "POST", {}, [200]));
		while (score["resolution"] !== null)
		{
			const resolution = _Record(score["resolution"]);
			const candidates = _Array(resolution["candidates"], "persona resolution candidates");
			if (candidates.length === 0)
				throw new Error("Hosted persona resolution omitted options");
			score = _Record(await this._Json(`/api/v1/me/persona/interviews/${encodeURIComponent(interviewId)}/resolutions/${encodeURIComponent(_String(resolution["kind"], "persona resolution kind"))}`, "POST", { selectedValue: _String(candidates[0], "persona resolution candidate") }, [201]));
		}
		if (score["state"] !== "completed")
			throw new Error("Hosted persona interview did not complete");
		const draft = _Record(await this._Json(`/api/v1/me/persona/interviews/${encodeURIComponent(interviewId)}/draft`, "POST", {}, [201]));
		const personaRevisionId = _String(draft["personaRevisionId"], "persona revision id");
		const approved = _Record(await this._Json(`/api/v1/me/persona/drafts/${encodeURIComponent(personaRevisionId)}/approve`, "POST", {}, [200]));
		if (approved["personaRevisionId"] !== personaRevisionId || approved["state"] !== "approved")
			throw new Error("Hosted persona draft was not approved");
		return personaRevisionId;
	}

	/** Complete all three server-selected onboarding questions and publish the personal agent. */
	async completeOnboarding(): Promise<void>
	{
		this._RequireMutable("complete user onboarding");
		await this._Json("/api/v1/me/onboarding/", "GET", undefined, [200]);
		let chat = _Record(await this._Json("/api/v1/me/onboarding/chat/start", "POST", {}, [200]));
		let answerCount = 0;
		while (chat["currentQuestion"] !== null)
		{
			const question = _Record(chat["currentQuestion"]);
			chat = _Record(await this._Json("/api/v1/me/onboarding/chat/answers", "POST", { expectedConversationId: _String(chat["conversationId"], "onboarding conversation id"), expectedQuestionOrdinal: _Number(question["ordinal"], "onboarding question ordinal"), text: `Deterministic hosted qualification answer ${answerCount + 1}.`, idempotencyKey: randomUUID() }, [200, 201]));
			answerCount += 1;
			if (answerCount > 3)
				throw new Error("Hosted onboarding returned more than three questions");
		}
		if (answerCount !== 3 || chat["answerCount"] !== 3 || chat["canConclude"] !== true)
			throw new Error("Hosted onboarding did not accept exactly three answers");
		const concluded = _Record(await this._Json("/api/v1/me/onboarding/chat/conclude", "POST", {}, [200]));
		if (concluded["state"] !== "completed" || concluded["completedAt"] === null)
			throw new Error("Hosted onboarding did not reach completed readiness");
	}

	/** Resolve the one ready personal-agent coordinate from the public directory. */
	async personalAgentRef(): Promise<string>
	{
		const response = _Record(await this._Json("/api/v1/me/conversations/directory", "GET", undefined, [200]));
		const directory = _Record(response["directory"]);
		if (directory["personalAgentStatus"] !== "ready")
			throw new Error("Hosted personal agent is not ready in the public directory");
		return _String(_Record(directory["personalAgent"])["personalAgentRef"], "personal agent reference");
	}

	/** Read the personal agent's exact active revision and canonical tools. */
	async getPersonalTools(): Promise<HostedGeneratedFileToolSelection>
	{
		return _ToolSelection(await this._Json("/api/v1/me/agent/tools", "GET", undefined, [200]));
	}

	/** Replace personal tools with one discovered revision through the strict public CAS owner. */
	async selectPersonalTool(expectedActiveRevisionId: string, toolRevisionId: string): Promise<HostedGeneratedFileToolSelection>
	{
		this._RequireMutable("select a personal tool");
		return _ToolSelection(await this._Json("/api/v1/me/agent/tools", "PUT", { expectedActiveRevisionId, toolRevisionIds: [toolRevisionId] }, [200]));
	}

	/** Create one real personal agent-session conversation through the existing public owner. */
	async createConversation(personalAgentRef: string): Promise<string>
	{
		this._RequireMutable("create a conversation");
		const response = _Record(await this._Json("/api/v1/me/conversations", "POST", { mode: "agent_session", personalAgentRef, idempotencyKey: randomUUID() }, [201]));
		const conversation = _Record(response["conversation"]);
		return _String(conversation["id"], "conversation id");
	}

	/** Reserve and upload one exact OCI Image Layout ZIP through the participant asset API. */
	async uploadOciArchive(conversationId: string, displayName: string, archive: Uint8Array, contentAddress: string): Promise<HostedGeneratedFileAsset>
	{
		this._RequireMutable("upload an OCI archive");
		const reserved = _Record(await this._Json(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/assets`, "POST", { idempotencyKey: randomUUID(), displayName, mediaType: "application/zip", byteLength: archive.byteLength, contentAddress }, [200, 201]));
		const asset = _Asset(_Record(reserved["asset"]));
		await this._Request(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/assets/${encodeURIComponent(asset.id)}/content`, { method: "PUT", body: Uint8Array.from(archive).buffer, headers: { "content-type": "application/zip", "content-length": String(archive.byteLength) } }, [202]);
		return asset;
	}

	/** Read the caller's current public asset projection. */
	async listAssets(conversationId: string, timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<readonly HostedGeneratedFileAsset[]>
	{
		const response = _Record(await this._Json(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/assets`, "GET", undefined, [200], {}, timeoutMilliseconds));
		const values = response["assets"];
		if (!Array.isArray(values))
			throw new Error("Conversation asset list omitted assets");
		return values.map(value => _Asset(_Record(value)));
	}

	/** Submit one exact published OCI revision to the production validation workflow. */
	async submitOciValidation(asset: HostedGeneratedFileAsset): Promise<HostedGeneratedFileOciValidation>
	{
		this._RequireMutable("submit OCI validation");
		if (asset.artifactId === null || asset.artifactRevisionId === null)
			throw new Error("OCI validation requires a published artifact revision");
		return _Validation(await this._Json("/api/v1/mcp/oci-image-validations", "POST", { idempotencyKey: randomUUID(), artifactId: asset.artifactId, artifactRevisionId: asset.artifactRevisionId }, [201]));
	}

	/** Read one saved production OCI validation. */
	async getOciValidation(validationId: string, timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<HostedGeneratedFileOciValidation>
	{
		return _Validation(await this._Json(`/api/v1/mcp/oci-image-validations/${encodeURIComponent(validationId)}`, "GET", undefined, [200], {}, timeoutMilliseconds));
	}

	/** Promote one actually Imported validation into real discovery work. */
	async promoteOciValidation(validationId: string, name: string): Promise<{ readonly serverId: string; readonly serverRevisionId: string }>
	{
		this._RequireMutable("promote OCI validation");
		const response = _Record(await this._Json(`/api/v1/mcp/oci-image-validations/${encodeURIComponent(validationId)}/server`, "POST", { name, description: "Disposable hosted generated-file qualification" }, [200, 201]));
		return { serverId: _String(response["serverId"], "server id"), serverRevisionId: _String(response["serverRevisionId"], "server revision id") };
	}

	/** Find the one discovered tool on a promoted server through the administrator catalogue. */
	async findServerTool(serverId: string, expectedToolName: string, timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<{ readonly serverRevisionId: string; readonly toolRevisionId: string } | null>
	{
		const response = await this._Json("/api/v1/mcp/servers", "GET", undefined, [200], {}, timeoutMilliseconds);
		if (!Array.isArray(response))
			throw new Error("MCP server catalogue is not an array");
		const server = response.map(_Record).find(candidate => candidate["id"] === serverId);
		if (server === undefined)
			return null;
		const tools = server["tools"];
		if (!Array.isArray(tools))
			throw new Error("MCP server omitted its discovered tools");
		const selected = tools.map(_Record).filter(tool => tool["name"] === expectedToolName);
		if (selected.length === 0)
			return null;
		if (selected.length !== 1 || tools.length !== 1)
			throw new Error("Hosted OCI server discovery did not produce exactly one expected tool");
		return { serverRevisionId: _String(selected[0]!["serverRevisionId"], "discovered server revision id"), toolRevisionId: _String(selected[0]!["toolRevisionId"], "tool revision id") };
	}

	/** Approve, publish, and install the discovered server through existing public owners. */
	async publishAndInstallServer(serverId: string): Promise<void>
	{
		this._RequireMutable("publish an MCP server");
		await this._Json(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}/approve`, "POST", {}, [200]);
		await this._Json(`/api/v1/mcp/servers/${encodeURIComponent(serverId)}/publish`, "POST", {}, [200]);
		await this._Json("/api/v1/mcp/installed", "POST", { serverId }, [201]);
	}

	/** Cross the fixture's mutation boundary with exactly one activation Start command. */
	async activate(conversationId: string, text: string): Promise<{ readonly idempotencyKey: string; readonly outcome: string; readonly position: string }>
	{
		this._RequireMutable("activate a conversation");
		const body = { idempotencyKey: randomUUID(), text, assetIds: [], activation: "start" };
		const response = _Record(await this._Json(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", body, [202]));
		this.admittedCommand = { conversationId, body };
		return { idempotencyKey: body.idempotencyKey, outcome: _String(response["outcome"], "activation outcome"), position: _String(response["position"], "activation position") };
	}

	/** Replay only the byte-equivalent activation command admitted before observation began. */
	async replayActivation(): Promise<{ readonly outcome: string; readonly position: string }>
	{
		if (this.admittedCommand === null)
			throw new Error("Hosted activation replay requires the original admitted command");
		const response = _Record(await this._Json(`/api/v1/me/conversations/${encodeURIComponent(this.admittedCommand.conversationId)}/messages`, "POST", this.admittedCommand.body, [200]));
		return { outcome: _String(response["outcome"], "activation replay outcome"), position: _String(response["position"], "activation replay position") };
	}

	/** Replay one saved activation from a fresh post-restart session. */
	async replaySavedActivation(conversationId: string, text: string, idempotencyKey: string, expectedPosition: string): Promise<{ readonly outcome: string; readonly position: string }>
	{
		const body = { idempotencyKey, text, assetIds: [], activation: "start" };
		const response = _Record(await this._Json(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/messages`, "POST", body, [200]));
		const replay = { outcome: _String(response["outcome"], "activation replay outcome"), position: _String(response["position"], "activation replay position") };
		if (replay.outcome !== "idempotent" || replay.position !== expectedPosition)
			throw new Error("Hosted activation replay changed its immutable admission");
		return replay;
	}

	/** List the caller's public run projections. */
	async listRuns(timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<readonly HostedGeneratedFileRun[]>
	{
		const response = _Record(await this._Json("/api/v1/me/runs", "GET", undefined, [200], {}, timeoutMilliseconds));
		return _Array(response["runs"], "owned runs").map(_Run);
	}

	/** Re-read one exact owned run after restart. */
	async getRun(runId: string): Promise<HostedGeneratedFileRun>
	{
		return _Run(await this._Json(`/api/v1/me/runs/${encodeURIComponent(runId)}`, "GET", undefined, [200]));
	}

	/** Resolve another active non-Owner member from the Owner's public directory. */
	async membershipIdForEmail(email: string): Promise<string>
	{
		const directory = _Record(await this._Json("/api/v1/organization/members", "GET", undefined, [200]));
		const matches = _Array(directory["members"], "organization members").map(_Record).filter(function _Match(member) { return member["email"] === email && member["role"] !== "owner" && member["isCurrentUser"] === false; });
		if (matches.length !== 1 || matches[0]!["status"] !== "active")
			throw new Error("Hosted requester membership is not one removable active non-Owner");
		return _String(matches[0]!["membershipId"], "requester membership id");
	}

	/** Remove one exact non-Owner membership through the supported public authority. */
	async removeMember(membershipId: string): Promise<void>
	{
		const response = _Record(await this._Json(`/api/v1/organization/members/${encodeURIComponent(membershipId)}/remove`, "POST", {}, [200]));
		const member = _Record(response["member"]);
		if (member["membershipId"] !== membershipId || member["status"] !== "suspended")
			throw new Error("Hosted requester membership removal did not suspend the exact member");
	}

	/** Prove the live session is product-denied by membership before any domain handler. */
	async assertMembershipDenied(paths: readonly string[]): Promise<void>
	{
		for (const path of paths)
		{
			const response = await this._Request(path, { method: "GET" }, [403]);
			const body = _Record(await response.json());
			if (body["code"] !== "MEMBERSHIP_REQUIRED")
				throw new Error("Hosted revoked request did not fail at the membership gate");
		}
	}

	/** Read participant-visible history without driving workflow state. */
	async history(conversationId: string, timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<Record<string, unknown>>
	{
		return _Record(await this._Json(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/history`, "GET", undefined, [200], {}, timeoutMilliseconds));
	}

	/** Download one authorized Ready asset through the public byte route. */
	async download(conversationId: string, assetId: string): Promise<{ readonly bytes: Uint8Array; readonly cacheControl: string | null; readonly mediaType: string | null }>
	{
		const response = await this._Request(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/assets/${encodeURIComponent(assetId)}/content`, { method: "GET" }, [200]);
		return { bytes: new Uint8Array(await response.arrayBuffer()), cacheControl: response.headers.get("cache-control"), mediaType: response.headers.get("content-type") };
	}

	/** Require a revoked member's live session to fail at the product membership gate. */
	async assertDownloadDenied(conversationId: string, assetId: string): Promise<void>
	{
		const response = await this._Request(`/api/v1/me/conversations/${encodeURIComponent(conversationId)}/assets/${encodeURIComponent(assetId)}/content`, { method: "GET" }, [403]);
		if (_Record(await response.json())["code"] !== "MEMBERSHIP_REQUIRED")
			throw new Error("Hosted revoked download did not fail at the membership gate");
	}

	/** Reject every setup mutation after the initial activation entered production ownership. */
	private _RequireMutable(operation: string): void
	{
		if (this.admittedCommand !== null)
			throw new Error(`Hosted qualification cannot ${operation} after activation admission`);
	}

	/** Send JSON through the checked public-session transport. */
	private async _Json(path: string, method: string, body: object | undefined, statuses: readonly number[], extraHeaders: Readonly<Record<string, string>> = {}, timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<unknown>
	{
		const headers = { ...extraHeaders, ...(body === undefined ? {} : { "content-type": "application/json" }) };
		const response = await this._Request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, statuses, timeoutMilliseconds);
		return response.json();
	}

	/** Send one public request with the current cookie and same-origin mutation evidence. */
	private async _Request(path: string | URL, init: RequestInit, statuses: readonly number[], timeoutMilliseconds = this.requestTimeoutMilliseconds): Promise<HostedGeneratedFileHttpResponse>
	{
		const url = path instanceof URL ? path : new URL(path, this.baseUrl);
		if (url.origin !== this.baseUrl.origin)
			throw new Error("Hosted qualification public request escaped its configured origin");
		const headers = new Headers(init.headers);
		if (this.cookies.size > 0)
			headers.set("cookie", [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "));
		if (init.method !== undefined && !["GET", "HEAD"].includes(init.method.toUpperCase()))
			headers.set("origin", this.baseUrl.origin);
		const response = await this.fetch(url, { ...init, headers, redirect: "manual", signal: _RequestSignal(timeoutMilliseconds, init.signal) });
		this._CaptureCookies(response.headers);
		if (!statuses.includes(response.status))
			throw new Error(`Hosted public request ${init.method ?? "GET"} ${url.pathname} returned ${response.status}`);
		return response;
	}

	/** Retain response cookies by name without exposing their values in evidence. */
	private _CaptureCookies(headers: Headers): void
	{
		const values = typeof (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
			? (headers as Headers & { getSetCookie(): string[] }).getSetCookie()
			: [headers.get("set-cookie")].filter((value): value is string => value !== null);
		for (const value of values)
		{
			const first = value.split(";", 1)[0];
			const separator = first?.indexOf("=") ?? -1;
			if (first !== undefined && separator > 0)
				this.cookies.set(first.slice(0, separator), first.slice(separator + 1));
		}
	}

	/** Rewrite only the provider authorization hop onto the host transport origin. */
	private _ProviderTransportUrl(location: string): URL
	{
		const canonical = new URL(location);
		if (canonical.protocol !== "https:")
			throw new Error("OIDC authorization redirect must use HTTPS");
		if (this.oidcTransportBaseUrl === null)
			return canonical;
		return new URL(`${canonical.pathname}${canonical.search}`, this.oidcTransportBaseUrl);
	}
}

/** Read a required redirect location. */
function _Location(response: HostedGeneratedFileHttpResponse): string
{
	const location = response.headers.get("location");
	if (location === null)
		throw new Error("Hosted qualification redirect omitted Location");
	return location;
}
