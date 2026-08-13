import type { ConversationElicitation, ElicitationResponseProjection, SubmitElicitationResponse, paths } from "@opencrane/contracts";

/** Exact generated-client request body for the response endpoint. */
export type GeneratedElicitationSubmission = paths["/me/conversations/{conversationId}/elicitations/{requestId}/responses"]["post"]["requestBody"]["content"]["application/json"];

/** Signed-in browser port for generic participant input. */
export interface ConversationElicitationGateway
{
	/** Read one exact active-participant request. */
	read(conversationId: string, requestId: string): Promise<ConversationElicitation>;
	/** Submit one typed idempotent response. */
	respond(conversationId: string, requestId: string, submission: SubmitElicitationResponse): Promise<ElicitationResponseProjection>;
	/** Read bounded canonical request references for Activity. */
	listActivity(limit?: number): Promise<readonly ConversationElicitation[]>;
}
