import { AgentRevisionState, AgentServiceKind, AgentServiceState, PersonaRevisionState, OrgMemberStatus, Prisma, type PrismaClient } from "@prisma/client";
import { ProductAuthorizationResourceKinds } from "@opencrane/models/authorization";
import type { ConversationCaller } from "../authorization/conversation-caller.types";
import { PrismaConversationProductAuthorizationRepository } from "../authorization/db/conversation-product-authorization";
import { _IsActiveConversationMember } from "../authorization/prisma-conversation-membership";
import type { CompanyAssistantDirectory } from "./conversation-metadata.types";

/** Owns creation-directory reads and the caller-scoped personal assistant selection. */
export class PrismaConversationDirectoryReader
{
	/** Connects this owner to its transaction dependencies. */
	public constructor(private readonly prisma: PrismaClient, private readonly companyAssistants: CompanyAssistantDirectory) {}

  /**
   * Returns member references and the caller's readable personal assistant for conversation creation.
   * The caller's current approved persona selects candidates before authorization, so another
   * member's private assistant cannot hide or replace their own.
   * Called by: _CreateConversationMetadataRouter.
   * @param caller The signed-in identity resolved by the server for the selected silo.
   * @returns A ready assistant, or an unavailable or ambiguous state without an assistant reference.
   * @throws When the caller no longer has active organisation membership.
   * @see PrismaConversationProductAuthorizationRepository.canReadResources
   */
  public directory(caller: ConversationCaller): Promise<unknown>
  {
    const companyAssistants = this.companyAssistants;
    return this._read(async function _Directory(transaction)
    {
      if (!(await _IsActiveConversationMember(transaction, caller)))
        throw new Error("conversation directory unavailable");
      const rows = await transaction.orgMembership.findMany({
        where: { clusterTenant: caller.siloId, status: OrgMemberStatus.Active },
        select: { id: true, subject: true, displayName: true },
        orderBy: { id: "asc" },
      });
      const persona = await transaction.personaProfile.findUnique({
        where: { siloId_userId: { siloId: caller.siloId, userId: caller.subjectId } },
        select: { activeRevision: { select: { id: true, state: true, approvedAt: true } } },
      });
      const revision = persona?.activeRevision;
      const agents = revision?.state === PersonaRevisionState.Approved && revision.approvedAt !== null
        ? await transaction.agentService.findMany({
            where: {
              siloId: caller.siloId,
              kind: AgentServiceKind.Personal,
              state: AgentServiceState.Active,
              activeRevisionId: { not: null },
              activeRevision: { is: { siloId: caller.siloId, state: AgentRevisionState.Published, personaRevisionId: revision.id } },
            },
            select: { id: true, name: true },
            orderBy: { id: "asc" },
            take: 2,
          }) : [];
      const authorization =
        new PrismaConversationProductAuthorizationRepository(transaction);
      const allReadable = await authorization.canReadResources(
        caller,
        agents.map((agent) => ({
          kind: ProductAuthorizationResourceKinds.AgentService,
          id: agent.id,
        })),
      );
      const available = allReadable ? agents : [];
      return {
        companyAssistants: (await companyAssistants(caller)).map(agent => ({ agentServiceId: agent.agentServiceId, displayName: agent.name })),
        participants: rows.map((row) => ({
          participantRef: row.id,
          displayName: row.displayName?.trim() || "Unnamed member",
          isSelf: row.subject === caller.subjectId,
        })),
        personalAgentStatus: _PersonalAgentStatus(available.length),
        personalAgent:
          available.length === 1
            ? {
                personalAgentRef: available[0]!.id,
                displayName: available[0]!.name,
              }
            : null,
      };
    });
  }
  /** Runs one repeatable projection read. */
  private _read<Result>(
    work: (transaction: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }
}

/** Maps an exact authorized personal-agent count to the closed directory state. */
function _PersonalAgentStatus(
  count: number,
): "ready" | "unavailable" | "ambiguous" {
  if (count === 1)
return "ready";
  if (count === 0)
return "unavailable";
  return "ambiguous";
}