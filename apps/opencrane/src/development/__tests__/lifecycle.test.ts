import type { Server } from "node:http";

import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelfConversationSocketServer } from "@opencrane/backend/server/conversations";

import { _StartDevelopmentLifecycle } from "../lifecycle";

afterEach(function _RestoreProcessListeners()
{
	vi.restoreAllMocks();
});

describe("Tier 2 development lifecycle", function _Suite()
{
	it("attaches the conversation socket server to the loopback public listener", function _AttachesConversationSocket(): void
	{
		const publicServer = { close: vi.fn() } as unknown as Server;
		const publicApp = {
			listen: vi.fn(function _Listen(_port: number, _host: string, listening: () => void): Server
			{
				listening();
				return publicServer;
			})
		} as unknown as Express;
		const conversationSockets = {
			attach: vi.fn(),
			close: vi.fn()
		} as SelfConversationSocketServer;
		vi.spyOn(process, "once").mockReturnValue(process);

		_StartDevelopmentLifecycle(
			publicApp,
			null,
			conversationSockets,
			{ $disconnect: vi.fn() } as never,
			{ startWorkers: vi.fn(), close: vi.fn() },
			8080,
			8081,
			vi.fn()
		);

		expect(publicApp.listen).toHaveBeenCalledWith(8080, "127.0.0.1", expect.any(Function));
		expect(conversationSockets.attach).toHaveBeenCalledWith(publicServer);
	});
});
