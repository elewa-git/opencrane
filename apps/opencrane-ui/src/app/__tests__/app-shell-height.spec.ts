import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Read one production source file from the application test working directory. */
function _Source(path: string): string
{
	return readFileSync(join(process.cwd(), path), "utf8");
}

describe("OpenCrane app shell height", function _OpenCraneAppShellHeight()
{
	it("passes the root shell height through the router into the conversation workspace", function _ConversationWorkspaceHeightChain()
	{
		const appTemplate = _Source("src/app/app.component.html");
		const appStyles = _Source("src/app/app.component.scss");
		const routeTemplate = _Source("../../libs/frontend/features/conversation-workspace/src/lib/conversation-workspace-route/conversation-workspace-route.component.html");
		const routeStyles = _Source("../../libs/frontend/features/conversation-workspace/src/lib/conversation-workspace-route/conversation-workspace-route.component.scss");
		const pageStyles = _Source("../../libs/frontend/features/conversation-workspace/src/lib/components/conversation-workspace-page/conversation-workspace-page.component.scss");

		expect(appTemplate).toContain("<router-outlet />");
		expect(appStyles).toContain("block-size: 100dvh");
		expect(routeTemplate).toContain("<wo-conversation-workspace-page");
		expect(routeStyles).toContain("block-size: 100%");
		expect(routeStyles).not.toContain("100dvh");
		expect(pageStyles.match(/:host \{ overflow: hidden; display: block; block-size: 100%; \}/gu)).toHaveLength(1);
		expect(pageStyles.match(/:host \{ overflow: hidden; block-size: 100%; \}/gu)).toHaveLength(1);
		expect(pageStyles).not.toContain("block-size: 100dvh");
	});
});
