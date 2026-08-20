import { describe, expect, it } from "vitest";

import { __AdmissionLockKey } from "../admission-lock-key";

/** The byte PostgreSQL text cannot hold, written this way so no source file carries a literal NUL. */
const _NUL = String.fromCharCode(0);

describe("__AdmissionLockKey", function _AdmissionLockKeySuite()
{
	// PostgreSQL rejects a NUL byte in text with SQLSTATE 22021, which fails the whole statement.
	// Separating the two parts with NUL is what made every message submit return 503.
	it("introduces no byte PostgreSQL text cannot hold", function _AddsNoControlByte()
	{
		expect(__AdmissionLockKey("testv4", "idempotency-key")).not.toContain(_NUL);
		expect(__AdmissionLockKey("silo-1", "conversation:7753e9bb/message")).not.toContain(_NUL);
	});

	it("keeps distinct pairs distinct where a plain join would collide", function _StaysInjective()
	{
		// A separator either part may itself contain cannot separate them: "a:b" + "c" and "a" + "b:c"
		// both read as "a:b:c". The length prefix removes the ambiguity without reserving a character.
		expect(__AdmissionLockKey("a:b", "c")).not.toEqual(__AdmissionLockKey("a", "b:c"));
		expect(__AdmissionLockKey("ab", "c")).not.toEqual(__AdmissionLockKey("a", "bc"));
	});

	it("gives one silo and key the same lock on every attempt", function _StaysStable()
	{
		expect(__AdmissionLockKey("testv4", "key-1")).toEqual(__AdmissionLockKey("testv4", "key-1"));
	});
});
