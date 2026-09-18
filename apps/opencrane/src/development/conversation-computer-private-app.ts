import express, { type Express } from "express";

import { _CreateConversationComputerTurnRouter } from "@opencrane/backend/server/conversations";

import type { HostDevelopmentConversationComputerPrivateAppOptions } from "./conversation-computer-host-realizer.types";

/** Mount only the private operations supported by a workstation conversation computer. */
export function _CreateHostDevelopmentConversationComputerPrivateApp(options: HostDevelopmentConversationComputerPrivateAppOptions): Express
{
	const app = express();
	app.disable("x-powered-by");
	app.use(express.json({ limit: "4kb", strict: true }));
	// The shared router also serves the production review credential. Host mode stops it here because
	// a workstation child has no review listener, checkpoint, browser, or command gateway.
	app.all("/api/internal/conversation-computer/review-credential", function _RefuseReviewCredential(_request, response): void { response.sendStatus(404); });
	app.use("/api/internal/conversation-computer", _CreateConversationComputerTurnRouter(options));
	return app;
}
