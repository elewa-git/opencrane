import { ConversationToolProposalRefusals } from "./conversation-tool-proposal.types";

/** Rolls back proposal admission while exposing only a closed refusal to the private transport. */
export class ConversationToolProposalRefusal extends Error
{
	/** Retain the safe category without including tool arguments or upstream failure details. */
	public constructor(public readonly refusal: ConversationToolProposalRefusals)
	{
		super(refusal);
	}
}
