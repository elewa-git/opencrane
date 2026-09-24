import { CogneeProviderSessionError } from "./cognee-provider-session-error";
import { CogneeProviderSessionFailureCodes } from "./cognee-provider-session.types";
import type { CogneeProviderCredentials, CogneeProviderSession, CogneeProviderSessionOptions } from "./cognee-provider-session.types";
import { _ParseCogneeProviderCredentials, _ParseCogneeProviderLoginResponse } from "./cognee-provider-session.validator";
import { _CreateCogneeProviderHttpClient, _ValidateCogneeProviderHttpCommand } from "../http/cognee-provider-http";
import type { CogneeProviderHttpClient, CogneeProviderHttpCommand, CogneeProviderHttpResponse } from "../http/cognee-provider-http.types";

/** Authenticated bearer and generation retained only inside one process. */
interface SessionState
{
	/** Ephemeral Cognee bearer. */
	readonly bearerToken: string;
	/** Monotonic local generation used to reject stale HTTP 401 observations. */
	readonly generation: number;
}

/** Decode a bounded pinned JSON response without retaining parser details. */
function _Json(response: CogneeProviderHttpResponse): unknown
{
	try
	{
		const text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
		return JSON.parse(text) as unknown;
	}
	catch
	{
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.MalformedResponse);
	}
}

/** Return true only for the pinned provider's credential-rejection statuses. */
function _CredentialsRejected(status: number): boolean
{
	return status === 400 || status === 401;
}

/** In-process owner of Cognee login, refresh serialization, and one HTTP 401 replay. */
class _CogneeProviderSession implements CogneeProviderSession
{
	/** Bounded HTTP exchange that never stores a bearer. */
	private readonly _http: CogneeProviderHttpClient;
	/** Last successful session, when one exists. */
	private _current: SessionState | undefined;
	/** Shared login operation for concurrent startup or HTTP 401 recovery. */
	private _refresh: Promise<SessionState> | undefined;
	/** Next local session generation. */
	private _nextGeneration = 1;
	/** Whether the one explicitly enabled registration attempt has been consumed. */
	private _registrationAttempted = false;

	/** Create a session around the injected credential and HTTP owners. */
	constructor(private readonly _options: CogneeProviderSessionOptions)
	{
		this._http = _CreateCogneeProviderHttpClient(_options);
	}

	/** Establish a valid provider login without returning its bearer token. */
	async ensureReady(): Promise<void>
	{
		await this._Session();
	}

	/** Send one request and replay only an HTTP 401 with a refreshed session. */
	async exchange(command: CogneeProviderHttpCommand): Promise<CogneeProviderHttpResponse>
	{
		_ValidateCogneeProviderHttpCommand(command, new URL(this._options.baseUrl));
		const initial = await this._Session();
		const first = await this._http.send(command, initial.bearerToken);
		if (first.status !== 401)
			return first;

		const refreshed = await this._RefreshAfterUnauthorized(initial);
		const replay = await this._http.send(command, refreshed.bearerToken);
		if (replay.status !== 401)
			return replay;
		this._DiscardIfCurrent(refreshed);
		throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.AuthenticationRejected);
	}

	/** Return the active session or join the one shared login operation. */
	private async _Session(): Promise<SessionState>
	{
		if (this._current !== undefined)
			return this._current;
		const allowRegistration = this._options.allowFirstInstallRegistration && !this._registrationAttempted;
		return this._Refresh(allowRegistration);
	}

	/** Refresh an observed session unless the HTTP 401 belongs to an older generation. */
	private async _RefreshAfterUnauthorized(rejected: SessionState): Promise<SessionState>
	{
		if (this._current !== undefined && this._current.generation !== rejected.generation)
			return this._current;
		this._DiscardIfCurrent(rejected);
		return this._Refresh(false);
	}

	/** Share one login operation and publish only its complete bearer result. */
	private async _Refresh(allowRegistration: boolean): Promise<SessionState>
	{
		if (this._refresh !== undefined)
			return this._refresh;
		const operation = this._CreateSession(allowRegistration);
		this._refresh = operation;
		try
		{
			return await operation;
		}
		finally
		{
			if (this._refresh === operation)
				this._refresh = undefined;
		}
	}

	/** Read credentials and complete the approved login or first-install sequence. */
	private async _CreateSession(allowRegistration: boolean): Promise<SessionState>
	{
		const credentials = await this._Credentials();
		let bearerToken: string;
		try
		{
			bearerToken = await this._Login(credentials);
		}
		catch (error)
		{
			const canRegister = allowRegistration && error instanceof CogneeProviderSessionError && error.code === CogneeProviderSessionFailureCodes.AuthenticationRejected;
			if (!canRegister)
				throw error;
			this._registrationAttempted = true;
			await this._Register(credentials);
			bearerToken = await this._Login(credentials);
		}
		const session = { bearerToken, generation: this._nextGeneration++ };
		this._current = session;
		return session;
	}

	/** Read and validate the mounted service credential without forwarding reader errors. */
	private async _Credentials(): Promise<CogneeProviderCredentials>
	{
		let value: unknown;
		try
		{
			value = await this._options.credentialReader.read();
		}
		catch
		{
			throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.CredentialsUnavailable);
		}
		const credentials = _ParseCogneeProviderCredentials(value);
		if (credentials === null)
			throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.CredentialsUnavailable);
		return credentials;
	}

	/** Execute the exact pinned form login and return its ephemeral bearer. */
	private async _Login(credentials: CogneeProviderCredentials): Promise<string>
	{
		const body = new URLSearchParams({ username: credentials.email, password: credentials.password }).toString();
		const response = await this._http.send({ method: "POST", path: "/api/v1/auth/login", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
		if (response.status !== 200)
		{
			const code = _CredentialsRejected(response.status) ? CogneeProviderSessionFailureCodes.AuthenticationRejected : CogneeProviderSessionFailureCodes.AuthenticationUnavailable;
			throw new CogneeProviderSessionError(code);
		}
		const login = _ParseCogneeProviderLoginResponse(_Json(response));
		if (login === null)
			throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.MalformedResponse);
		return login.accessToken;
	}

	/** Execute the one explicitly enabled first-install JSON registration. */
	private async _Register(credentials: CogneeProviderCredentials): Promise<void>
	{
		const body = JSON.stringify({ email: credentials.email, password: credentials.password });
		const response = await this._http.send({ method: "POST", path: "/api/v1/auth/register", headers: { "content-type": "application/json" }, body });
		if (response.status !== 201)
			throw new CogneeProviderSessionError(CogneeProviderSessionFailureCodes.RegistrationRejected);
	}

	/** Clear a rejected bearer only when it is still the current generation. */
	private _DiscardIfCurrent(rejected: SessionState): void
	{
		if (this._current?.generation === rejected.generation)
			this._current = undefined;
	}
}

/** Build the package-private session consumed by memory-gateway provider handlers. */
export function _CreateCogneeProviderSession(options: CogneeProviderSessionOptions): CogneeProviderSession
{
	return new _CogneeProviderSession(options);
}
