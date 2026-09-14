import { _CreatePersonalMemoryOperationWorkflowComposition } from "./personal-memory-operation-workflow-composition";
import { _CreatePersonalMemoryCommandComposition } from "./personal-memory-command-composition";
import type { ConversationHistoryComposition } from "./conversation-history-composition.types";
import type { PersonalMemoryWorkflowCompositionOptions } from "./personal-memory-operation-workflow-composition.types";
import { _ReadConversationPrivatePayloadKeyring } from "@opencrane/backend/server/conversations/history";

import type { PrismaClient } from "@prisma/client";
import { AesGcmConversationPrivatePayloadCipher, ConversationHistoryAuthority } from "@opencrane/backend/server/conversations/history";
import { ConversationComputerHistory } from "@opencrane/backend/server/conversations/computers";
import { _ResolveConversationCaller, _RegisterGroupChildWorkflow, PrismaCompanyAssistantDirectory, PrismaGroupChildAgentResolver, PrismaGroupChildAuthority, _CreateGroupChildRouter, PrismaAgentSessionCreationUnitOfWork, PrismaConversationMetadataUnitOfWork, PrismaSelfConversationHistoryUnitOfWork, _CreateConversationMetadataRouter, _CreateSelfConversationHistoryRouter } from "@opencrane/backend/server/conversations";
import { AgentIdentityHistory } from "@opencrane/backend/server/iam/identity";
import { _CreateHumanMembershipEvidenceConfig } from "@opencrane/backend/server/iam/membership";
import { PrismaConversationMessageAttachmentRepository } from "@opencrane/backend/server/conversation-assets";
import type { IWorkflowEngine } from "@opencrane/backend/server/infra/workflows/contract";
import type { HistoryStore } from "@opencrane/backend/server/infra/history-store";
import type { AgentSandboxReleaseProfileConfig } from "../configuration/config.types";
import { _ProcessShutdownSignal } from "../process/process-shutdown";
import { _log } from "../process/log";

/** Composes participant history from the sole KurrentDB port and mounted payload keyring. */
export function _CreateConversationHistoryComposition(
  prisma: PrismaClient,
  historyStore: HistoryStore,
  keyringPath: string,
  releaseProfile: AgentSandboxReleaseProfileConfig,
  workflows: IWorkflowEngine,
  memoryWorkflow: PersonalMemoryWorkflowCompositionOptions,
): ConversationHistoryComposition
{
  const cipher = AesGcmConversationPrivatePayloadCipher.fromDocument(
    _ReadConversationPrivatePayloadKeyring(keyringPath),
  );
  const authority = new PrismaSelfConversationHistoryUnitOfWork(prisma, historyStore, {
    cipher,
    computerReader: new ConversationComputerHistory(historyStore),
  }, new ConversationHistoryAuthority(historyStore), function _CreateAttachmentAdmission(transaction) { return new PrismaConversationMessageAttachmentRepository(transaction); });
  _CreatePersonalMemoryOperationWorkflowComposition(prisma, authority, workflows, memoryWorkflow);
  const resolveCaller = _ResolveConversationCaller;
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
  const directory = new PrismaCompanyAssistantDirectory(prisma, managedDependencies);
  const metadata = new PrismaConversationMetadataUnitOfWork(prisma, creation, directory.list.bind(directory));
  const children = new PrismaGroupChildAuthority(prisma, historyStore, cipher, new PrismaGroupChildAgentResolver(managedDependencies), workflows, authority, _log);
  _RegisterGroupChildWorkflow(workflows, children);
  const router = _CreateConversationMetadataRouter(metadata, resolveCaller, _log);
  router.use(_CreateGroupChildRouter(children, resolveCaller, _log));
  router.use(
    _CreateSelfConversationHistoryRouter({ authority, resolveCaller, logger: _log, events: { historyStore, shutdownSignal: _ProcessShutdownSignal, logger: _log } }),
  );
  return { conversations: router, memory: _CreatePersonalMemoryCommandComposition(prisma, authority, workflows) };
}
