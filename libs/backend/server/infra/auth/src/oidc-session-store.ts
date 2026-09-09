import type { Request } from "express";
import { Store, type Session, type SessionData } from "express-session";

import type { OidcAuthConfig } from "./oidc-config.types";
import { OidcSessionCodec } from "./oidc-session-codec";
import type { OidcSessionRepository } from "./oidc-session-repository.types";

/**
 * Shares encrypted sessions across server instances and rejects saves that race logout.
 * Fixed server-side deadlines apply regardless of the browser cookie's rolling expiry.
 * @see https://github.com/expressjs/session/blob/v1.19.0/README.md#session-store-implementation
 */
export class OidcSessionStore extends Store
{
	/** Encrypts data and validates the lifetime recorded in each signed identifier. */
	private readonly _codec: OidcSessionCodec;
	/** Persists session content and logout markers in PostgreSQL. */
	private readonly _repository: OidcSessionRepository;
	/** Tracks the revision read by this request without changing express-session's data hash. */
	private readonly _revisions = new WeakMap<SessionData, number>();
	/** Throttles cleanup per process; it never determines session validity. */
	private _pruneAfter = 0;

	/** Requires an explicit storage port; there is no process-local fallback. */
	constructor(config: OidcAuthConfig, repository: OidcSessionRepository)
	{
		super();
		this._codec = new OidcSessionCodec(config);
		this._repository = repository;
	}

	/** Supplies express-session with new identifiers during creation and regeneration. */
	generateId(): string { return this._codec.generateId(); }

	/** Transfers the loaded revision when express-session inflates plain data into a Session. */
	override createSession(request: Request, data: SessionData): Session & SessionData
	{
		const revision = this._revisions.get(data);
		const session = super.createSession(request, data);
		if (revision !== undefined)
			this._revisions.set(session, revision);
		return session;
	}

	/** Loads valid data from storage; unavailable or altered storage fails the request. */
	override get(id: string, callback: Parameters<Store["get"]>[1]): void
	{
		this._Read(id).then(function _Loaded(data) { callback(null, data); }, function _Failed(error: unknown) { callback(error); });
	}

	/** Saves the loaded revision and records the next revision before a subsequent login save. */
	override set(id: string, data: SessionData, callback?: (error?: unknown) => void): void
	{
		this._Save(id, data).then(function _Saved() { callback?.(); }, function _Failed(error: unknown) { callback?.(error); });
	}

	/** Commits logout even if the first session save is still in flight. */
	override destroy(id: string, callback?: (error?: unknown) => void): void
	{
		this._Destroy(id).then(function _Destroyed() { callback?.(); }, function _Failed(error: unknown) { callback?.(error); });
	}

	/** Leaves the fixed database deadline unchanged; touching never creates or revives a row. */
	touch(_id: string, _data: SessionData, callback?: () => void): void { callback?.(); }

	/** Reads and validates the encrypted identity before handing it to Express. */
	private async _Read(id: string): Promise<SessionData | null>
	{
		const command = this._codec.coordinates(id);
		if (command === null)
			return null;
		await this._Prune();
		const stored = await this._repository.read(command);
		if (stored === null)
			return null;
		const current = this._codec.coordinates(id);
		if (current === null || stored.validUntil <= current.now)
			return null;
		const data = this._codec.decode(stored.payload, current);
		if (this._codec.validUntil(id, data, current).getTime() !== stored.validUntil.getTime())
			throw new Error("OIDC session expiry is inconsistent");
		this._revisions.set(data, stored.revision);
		return data;
	}

	/** Persists valid content without retrying an optimistic conflict as a new session. */
	private async _Save(id: string, data: SessionData): Promise<void>
	{
		await this._Prune();
		const command = this._codec.coordinates(id);
		if (command === null)
			throw new Error("OIDC session identifier is invalid or expired");
		const validUntil = this._codec.validUntil(id, data, command);
		const payload = this._codec.encode(data, command);
		const expectedRevision = this._revisions.get(data) ?? null;
		const revision = await this._repository.save({ ...command, payload, validUntil, expectedRevision });
		const current = this._codec.coordinates(id);
		if (current === null || validUntil <= current.now)
			throw new Error("OIDC session expired while it was being saved");
		this._revisions.set(data, revision);
	}

	/** Keeps a marker only while the immutable identifier could still be presented. */
	private async _Destroy(id: string): Promise<void>
	{
		const command = this._codec.coordinates(id);
		if (command !== null)
			await this._repository.destroy(command);
	}

	/** Prunes at most 100 rows per minute per active server without adding a scheduler. */
	private async _Prune(): Promise<void>
	{
		const now = Date.now();
		if (now < this._pruneAfter)
			return;
		this._pruneAfter = now + 60_000;
		await this._repository.prune(this._codec.namespace, new Date(now));
	}
}
