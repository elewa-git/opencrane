import { describe, expect, it } from "vitest";
import { AgentCapabilityGrantEffects, AgentCapabilityGrantKinds, AgentIdentityStates, McpInvocationActions, WebDestinationSelectorKinds, WebEgressProtocols } from "../index";
import type { AgentIdentity, WebEgressGrant } from "../index";

describe("agent identity and capability grant contracts", function ()
{
	it("keeps managed sub-chat identities separate from their parent identity", function ()
	{
		const identity: AgentIdentity = {
			schemaVersion: 1,
			id: "identity-subchat-1",
			siloId: "silo-1",
			agentServiceId: "agent-service-1",
			name: "Research helper",
			avatarArtifactRevisionId: null,
			state: AgentIdentityStates.Active,
			createdByPrincipalId: "principal-owner-1",
			createdAt: "2026-08-31T20:00:00.000Z",
			kind: "managed_subchat",
			principalId: "principal-subchat-1",
			parentAgentIdentityId: "identity-parent-1",
			parentConversationId: "conversation-parent-1",
			conversationId: "conversation-subchat-1",
			requestedByPrincipalId: "principal-owner-1",
		};

		expect(identity.conversationId).not.toBe(identity.parentConversationId);
	});

	it("keeps web egress grants typed and PostgreSQL-authorized", function ()
	{
		const grant: WebEgressGrant = {
			schemaVersion: 1,
			id: "grant-web-1",
			siloId: "silo-1",
			agentIdentityId: "identity-agent-1",
			kind: AgentCapabilityGrantKinds.WebEgress,
			effect: AgentCapabilityGrantEffects.Allow,
			validFrom: "2026-08-31T20:00:00.000Z",
			grantedByPrincipalId: "principal-owner-1",
			reason: "The agent needs the approved documentation site.",
			destinations: [{ kind: WebDestinationSelectorKinds.ExactDomain, domain: "docs.example.com", includeApex: true }],
			protocols: [WebEgressProtocols.Https],
			ports: [443],
		};

		expect(grant.kind).toBe(AgentCapabilityGrantKinds.WebEgress);
		expect(McpInvocationActions.Invoke).toBe("invoke");
	});
});
