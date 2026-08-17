import { describe, expect, it } from "vitest";

import { _SafeLoginReturnTo } from "../login/login-return-to";

describe("login continuation URL", function _LoginReturnToSuite()
{
	it("keeps a same-origin invitation URL through authentication", function _InvitationReturn()
	{
		expect(_SafeLoginReturnTo("/invite?token=opaque-signed-token")).toBe("/invite?token=opaque-signed-token");
	});

	it("rejects absolute and protocol-relative redirects", function _RejectExternalReturn()
	{
		expect(_SafeLoginReturnTo("https://attacker.example/invite")).toBe("/");
		expect(_SafeLoginReturnTo("//attacker.example/invite")).toBe("/");
		expect(_SafeLoginReturnTo("/\\attacker.example/invite")).toBe("/");
	});

	it("rejects encoded backslash and protocol-relative redirects", function _RejectEncodedExternalReturn()
	{
		expect(_SafeLoginReturnTo("/%5c%5cattacker.example")).toBe("/");
		expect(_SafeLoginReturnTo("/%255c%255cattacker.example")).toBe("/");
		expect(_SafeLoginReturnTo("/%2f%2fattacker.example")).toBe("/");
	});
});
