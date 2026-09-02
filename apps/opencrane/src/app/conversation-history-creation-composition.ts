import type { PrismaClient } from "@prisma/client";

import { ManagedAgentIdentityHistoryProvisioner, ProxiedAgentIdentityHistoryProvisioner, AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER, __ManagedAgentServicePrincipal } from "@opencrane/backend/server/agents/agent-services";
import { ConversationAgentBindingResolver, ConversationComputerAgentServiceKinds, ConversationComputerCreationActivationAuthority, ConversationComputerHistory, ConversationCreationAnchorVerifier, ConversationHistoryAuthority, ConversationHistoryReader, HistoryAnchoredConversationCreationAuthority, HistoryAnchoredConversationCreationService, PrismaConversationAgentBindingUnitOfWork, PrismaConversationCreationCompilerUnitOfWork, PrismaConversationCreationProjectionUnitOfWork, PrismaConversationCreationReservationUnitOfWork, type ConversationAgentIdentitySelector, type ConversationComputerProfileSelector, type ConversationCreationAuthority, type ConversationManagedAgentPrincipalValidator } from "@opencrane/backend/server/conversations";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";

import { _CreateConversationComputerAgentServiceProfileSelector } from "./conversation-computer-activation-composition";
import type { ConversationComputerActivationConfig } from "./config.types";

/**
 * Builds the creation authority shared by the authenticated HTTP router and socket transport.
 *
 * Each request supplies its own {@link ConversationCaller}, so the factory below can bind every
 * reservation lookup to that caller before it reaches immutable history. Agent-session creation
 * Agent sessions select profiles only from the mounted release configuration, then atomically
 * establish their initial computer and activation work after the conversation anchor exists.
 *
 * Called by: {@link _Main} in index.ts.
 * @param prisma - Opens the short reservation and projection transactions.
 * @param historyStore - Owns immutable conversation anchors and AgentIdentity streams.
 * @param activationConfig - Supplies the mounted release-owned computer profiles, when enabled.
 * @param siloId - Restricts profile selections and computer activation streams to this deployment.
 * @returns The request-time authority mounted by both conversation transports.
 */
export function _CreateHistoryAnchoredConversationCreationAuthority(prisma: PrismaClient, historyStore: HistoryStore, activationConfig: ConversationComputerActivationConfig | null, siloId: string): ConversationCreationAuthority
{
	const profiles = activationConfig === null ? _UnavailableProfiles() : _CreateConversationComputerAgentServiceProfileSelector(activationConfig, siloId);
	const identities = _CreateAgentIdentitySelector(historyStore);
	const verifier = new PrismaConversationAgentBindingUnitOfWork(prisma, _ManagedPrincipalValidator);
	const bindings = new ConversationAgentBindingResolver(verifier, { profiles, identities });
	const compiler = new PrismaConversationCreationCompilerUnitOfWork(prisma);
	const history = { create(caller: { readonly principalId: string; readonly subjectId: string; readonly issuer: string; readonly siloId: string })
	{
		const reservations = new PrismaConversationCreationReservationUnitOfWork(prisma, caller);
		const anchors = new ConversationHistoryAuthority(historyStore);
		const verifier = new ConversationCreationAnchorVerifier(historyStore);
		const projectionReader = new ConversationHistoryReader(historyStore);
		const projection = new PrismaConversationCreationProjectionUnitOfWork(prisma, projectionReader);
		return new HistoryAnchoredConversationCreationAuthority(reservations, anchors, verifier, projection);
	} };
	const computerHistory = new ConversationComputerHistory(historyStore);
	const computers = new ConversationComputerCreationActivationAuthority({ history: computerHistory, clock: { now: function _Now() { return new Date(); } } });
	return new HistoryAnchoredConversationCreationService({ compiler, agentBindings: bindings, history, computers, clock: { now: function _Now() { return new Date(); } } });
}

/**
 * Returns no computer profile for any AgentService.
 *
 * {@link ConversationAgentBindingResolver} maps this `null` result to `ProfileUnavailable` before
 * it provisions an AgentIdentity, so Agent-session creation fails closed while direct and group
 * creation bypass profile selection.
 */
function _UnavailableProfiles(): ConversationComputerProfileSelector
{
	return { async select() { return null; } };
}

/**
 * Builds the identity selector that runs after AgentService verification has closed its SQL transaction.
 *
 * {@link ConversationAgentBindingResolver} supplies database-verified service facts to this selector,
 * so the identity provisioners never receive a browser-chosen identity or extend that transaction
 * while writing their history streams.
 */
function _CreateAgentIdentitySelector(historyStore: HistoryStore): ConversationAgentIdentitySelector
{
	const history = new AgentIdentityHistory(historyStore);
	const managed = new ManagedAgentIdentityHistoryProvisioner(history, { now: function _Now() { return new Date(); } });
	const proxied = new ProxiedAgentIdentityHistoryProvisioner(history, { now: function _Now() { return new Date(); } });
	return {
		async ensure(command)
		{
			if (command.agentServiceKind === ConversationComputerAgentServiceKinds.Managed)
				return managed.ensure(command);
			return proxied.ensure({ siloId: command.siloId, agentServiceId: command.agentServiceId, proxiedPrincipalId: command.principalId, delegationPolicyId: command.delegationPolicyId, agentServiceName: command.agentServiceName });
		},
	};
}

/**
 * Checks that a managed AgentService names the internal Principal derived from its service id.
 *
 * The binding verifier rejects any other issuer, subject, origin, or identifier before profile and
 * identity authorities receive the service facts.
 */
const _ManagedPrincipalValidator: ConversationManagedAgentPrincipalValidator = {
	validate(command)
	{
		return command.principalId === __ManagedAgentServicePrincipal(command.agentServiceId)
			&& command.issuer === MANAGED_AGENT_SERVICE_PRINCIPAL_ISSUER
			&& command.provenance === "internal"
			&& command.subject === command.agentServiceId;
	},
};
