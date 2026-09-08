import { readFileSync } from "node:fs";

import type { PrismaClient } from "@prisma/client";
import { AesGcmConversationPrivatePayloadCipher, ConversationComputerHistory, ConversationHistoryAuthority, GROUP_CHILD_TASK, PrismaGroupChildAuthority, _CreateGroupChildRouter, PrismaAgentSessionCreationUnitOfWork, PrismaConversationMetadataUnitOfWork, PrismaSelfConversationHistoryUnitOfWork, _CreateConversationMetadataRouter, _CreateSelfConversationHistoryRouter, type GroupChildTaskInput, type ConversationPrivatePayloadKeyringDocument } from "@opencrane/backend/server/conversations";
import { PrismaManagedAgentConversationResolver } from "@opencrane/backend/server/agents/agent-services";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { ___RunInPrismaUnitOfWork } from "@opencrane/backend/server/infra/prisma-unit-of-work";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import { _ResolveRequestPrincipal } from "@opencrane/backend/server/infra/auth";
import type { AgentSandboxReleaseProfileConfig } from "./config.types";
import { _ProcessShutdownSignal } from "./process-shutdown";
import { _log } from "./log";

/** Composes participant history from the sole KurrentDB port and mounted payload keyring. */
export function _CreateConversationHistoryComposition(
  prisma: PrismaClient,
  historyStore: HistoryStore,
  keyringPath: string,
  releaseProfile: AgentSandboxReleaseProfileConfig,
  workflows: IWorkflowEngine,
) {
  const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(
    _ReadConversationPrivatePayloadKeyring(keyringPath),
  );
  const authority = new PrismaSelfConversationHistoryUnitOfWork(prisma, historyStore, {
    cipher,
    computerReader: new ConversationComputerHistory(historyStore),
  }, new ConversationHistoryAuthority(historyStore));
  const resolveCaller = function _ResolveCaller(
    request: import("express").Request,
  ) {
    const principal = _ResolveRequestPrincipal(request);
    return principal === null || principal.verifiedAuthenticationAt === null
      ? null
      : {
          siloId: principal.siloId,
          subjectId: principal.externalSubject,
          principalId: principal.principalId,
		  externalIssuer: principal.externalIssuer,
		  verifiedAuthenticationAt: principal.verifiedAuthenticationAt.toISOString(),
        };
  };
  const creation = new PrismaAgentSessionCreationUnitOfWork(
    prisma,
    historyStore,
    [
      {
        workloadProfile: releaseProfile.profileName,
        profileRevisionId: releaseProfile.profileRevisionId,
      },
    ],
  );
  const managedDependencies = {
    identityHistory: new AgentIdentityHistory(historyStore),
    membershipConfig: _CreateHumanMembershipEvidenceConfig(),
    profiles: [{ workloadProfile: releaseProfile.profileName, profileRevisionId: releaseProfile.profileRevisionId }],
  };
  const metadata = new PrismaConversationMetadataUnitOfWork(prisma, creation, function _ListCompanyAssistants(caller)
  {
    return ___RunInPrismaUnitOfWork(prisma, function _ReadDirectory(transaction)
    {
      return new PrismaManagedAgentConversationResolver(transaction, managedDependencies).list(caller);
    }, { isolationLevel: "ReadCommitted", operation: "company assistant directory" });
  });
  const children = new PrismaGroupChildAuthority(prisma, historyStore, cipher, {
    resolve: function _ResolveManagedAssistant(transaction, caller, agentServiceId)
    {
      return new PrismaManagedAgentConversationResolver(transaction, managedDependencies).resolve(caller, agentServiceId);
    },
  }, workflows, authority, _log);
  workflows.register({ ...GROUP_CHILD_TASK, run: function _ResumeGroupChild(context, input: GroupChildTaskInput)
  {
    return children.run(input, context.attempt);
  } });
  const router = _CreateConversationMetadataRouter(metadata, resolveCaller, _log);
  router.use(_CreateGroupChildRouter(children, resolveCaller, _log));
  router.use(
    _CreateSelfConversationHistoryRouter({ authority, resolveCaller, logger: _log, events: { historyStore, shutdownSignal: _ProcessShutdownSignal, logger: _log } }),
  );
  return router;
}

/** Reads and structurally narrows one Secret-mounted JSON keyring before the cipher validates its keys. */
export function _ReadConversationPrivatePayloadKeyring(path: string): ConversationPrivatePayloadKeyringDocument
{
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      "Conversation private payload keyring must be readable JSON",
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Conversation private payload keyring must be an object");
  const document = value as Record<string, unknown>;
  if (
    typeof document["currentKeyId"] !== "string" ||
    typeof document["keys"] !== "object" ||
    document["keys"] === null ||
    Array.isArray(document["keys"])
  )
    throw new Error(
      "Conversation private payload keyring must contain currentKeyId and keys",
    );
  for (const encoded of Object.values(
    document["keys"] as Record<string, unknown>,
  )) {
    if (typeof encoded !== "string")
      throw new Error(
        "Conversation private payload keyring keys must be encoded strings",
      );
  }
  return {
    currentKeyId: document["currentKeyId"],
    keys: document["keys"] as Record<string, string>,
  };
}
