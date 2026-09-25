import { describe, expect, it } from "vitest";

import { McpCredentialRequirement } from "../../mcp/mcp-operator.types";
import { ElicitationConnectionOwnerKinds } from "../conversation-elicitation.types";
import { ___ElicitationExecutionConnectionSchema } from "../conversation-elicitation.validator";

const _CONNECTION = { ownerKind: ElicitationConnectionOwnerKinds.CompanyAssistant, ownerLabel: "Inventory assistant", credentialRequirement: McpCredentialRequirement.PrincipalCredential };

describe("tool approval connection disclosure", function _Suite()
{
	it.each(Object.values(ElicitationConnectionOwnerKinds))("preserves the named %s owner for every credential requirement", function _Owner(ownerKind)
	{
		for (const credentialRequirement of Object.values(McpCredentialRequirement))
		{
			const disclosure = { ..._CONNECTION, ownerKind, credentialRequirement };
			expect(___ElicitationExecutionConnectionSchema.parse(disclosure)).toEqual(disclosure);
		}
	});
	it.each(["", " ", "x".repeat(201), "owner\nadmin", "owner\u202Eadmin", "owner\u2066admin", "owner\u007F", "owner\u061Cadmin", "owner\u200Eadmin", "owner\u200Fadmin"])("rejects an unsafe or unbounded owner label", function _Label(ownerLabel)
	{
		expect(___ElicitationExecutionConnectionSchema.safeParse({ ..._CONNECTION, ownerLabel }).success).toBe(false);
	});
	it.each(["principalId", "subjectId", "email", "endpoint", "credentialSecretUid", "credentialSecretVersion", "generation"])("rejects unexpected %s disclosure", function _PrivateField(field)
	{
		expect(___ElicitationExecutionConnectionSchema.safeParse({ ..._CONNECTION, [field]: "private" }).success).toBe(false);
	});
	it.each([{}, null, { ..._CONNECTION, ownerKind: "admin" }, { ..._CONNECTION, credentialRequirement: "optional" }, { ..._CONNECTION, ownerLabel: undefined }])("rejects missing or unknown disclosure fields", function _Invalid(value)
	{
		expect(___ElicitationExecutionConnectionSchema.safeParse(value).success).toBe(false);
	});
	it("retains international text and markup as data for escaped rendering", function _Text()
	{
		const disclosure = { ..._CONNECTION, ownerLabel: "Équipe <script> & Amina" };
		expect(___ElicitationExecutionConnectionSchema.parse(disclosure)).toEqual(disclosure);
	});
});
