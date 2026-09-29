import { Buffer } from "node:buffer";

import { z } from "zod";

import { RoutineCommandValidationError } from "./routine-command.errors";
import type { RoutinePageCursorPayload, RoutinePageCursorPayloadCipher, RoutinePageCursorPayloadCoordinates } from "./routine-page-cursor-adapter.types";
import { RoutinePageCursorEndpoints, type RoutinePageCursorCodec, type RoutinePageCursorContext, type RoutinePagePosition } from "./routine-read.types";

/** Keeps cursor ciphertext separate from routine instructions and conversation content. */
const _PURPOSE = "opencrane:routine-page-cursor:v1";
/** Bounds public tokens before parsing or decryption work begins. */
const _MAXIMUM_TOKEN_LENGTH = 2_048;

/** Strict plaintext position encrypted inside one opaque continuation token. */
const _PositionSchema: z.ZodType<RoutinePagePosition> = z.object({ createdAt: z.string().datetime({ offset: true }), id: z.string().min(1).max(200).refine(function _Exact(value): boolean { return value === value.trim(); }) }).strict();

/** Strict serialized cipher envelope carried by the public token. */
const _EnvelopeSchema = z.object({ keyId: z.string().min(1).max(200), nonce: z.string().base64url(), authTag: z.string().base64url(), ciphertext: z.string().base64url(), ciphertextDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/u) }).strict();

/** Encrypts page positions with the server's mounted rotating keyring. */
export class RoutinePageCursorCipherAdapter implements RoutinePageCursorCodec
{
	/** Stores the cipher without importing its conversation-history implementation. */
	public constructor(private readonly cipher: RoutinePageCursorPayloadCipher) {}

	/** @inheritdoc */
	public async decode(token: string, context: RoutinePageCursorContext): Promise<RoutinePagePosition>
	{
		try
		{
			if (token.length === 0 || token.length > _MAXIMUM_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(token))
				throw new Error("invalid token");
			const decoded = Buffer.from(token, "base64url");
			if (decoded.toString("base64url") !== token)
				throw new Error("non-canonical token");
			const parsed = _EnvelopeSchema.parse(JSON.parse(decoded.toString("utf8")));
			if (Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url") !== token)
				throw new Error("non-canonical envelope");
			const nonce = _Bytes(parsed.nonce, 12);
			const authTag = _Bytes(parsed.authTag, 16);
			const ciphertext = _Bytes(parsed.ciphertext);
			const payload: RoutinePageCursorPayload = { keyId: parsed.keyId, nonce, authTag, ciphertext, ciphertextDigest: parsed.ciphertextDigest };
			const plaintext = this.cipher.decrypt(payload, _Coordinates(context));
			return _PositionSchema.parse(JSON.parse(plaintext));
		}
		catch
		{
			throw new RoutineCommandValidationError("routine page cursor is invalid for this request");
		}
	}

	/** @inheritdoc */
	public async encode(position: RoutinePagePosition, context: RoutinePageCursorContext): Promise<string>
	{
		const normalized = _PositionSchema.parse(position);
		const encrypted = this.cipher.encrypt(JSON.stringify(normalized), _Coordinates(context));
		const envelope = { keyId: encrypted.keyId, nonce: Buffer.from(encrypted.nonce).toString("base64url"), authTag: Buffer.from(encrypted.authTag).toString("base64url"), ciphertext: Buffer.from(encrypted.ciphertext).toString("base64url"), ciphertextDigest: encrypted.ciphertextDigest };
		const token = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
		if (token.length > _MAXIMUM_TOKEN_LENGTH)
			throw new Error("routine page cursor exceeds its public size limit");
		return token;
	}
}

/** Decodes canonical base64url bytes and optionally requires their exact length. */
function _Bytes(value: string, length?: number): Buffer
{
	const bytes = Buffer.from(value, "base64url");
	if (bytes.toString("base64url") !== value || length !== undefined && bytes.length !== length)
		throw new Error("routine page cursor contains invalid cipher bytes");
	return bytes;
}

/** Binds a cursor to its version, endpoint, silo, caller, issuer, subject, and optional routine. */
function _Coordinates(context: RoutinePageCursorContext): RoutinePageCursorPayloadCoordinates
{
	const routine = context.endpoint === RoutinePageCursorEndpoints.Firings ? context.routineId : null;
	if (context.endpoint === RoutinePageCursorEndpoints.Firings && routine === null)
		throw new RoutineCommandValidationError("routine firing cursor requires its routine");
	const endpoint = `${_PURPOSE}:${context.endpoint}`;
	const payloadRef = JSON.stringify([_PURPOSE, context.endpoint, context.caller.principalId, context.caller.issuer, context.caller.subjectId, routine]);
	return { siloId: context.caller.siloId, conversationId: endpoint, authorSubject: context.caller.subjectId, payloadRef };
}
