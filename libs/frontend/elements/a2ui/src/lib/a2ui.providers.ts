import { InjectionToken, type EnvironmentProviders, type Provider } from "@angular/core";
import { MarkdownRenderer, provideA2UI } from "@a2ui/angular/v0_8";

import { _OpenCraneA2uiCatalog } from "./a2ui.catalog";
import { _OpenCraneA2uiTheme } from "./a2ui.theme";
import type { A2uiMarkdownSanitizer } from "./a2ui.types";

/**
 * Neutral sanitizer port used for agent-authored A2UI text.
 *
 * The browser composition root supplies an implementation. This elements package deliberately
 * does not depend on a conversation store, transcript renderer, or other feature/state package.
 */
const _A2UI_MARKDOWN_SANITIZER = new InjectionToken<A2uiMarkdownSanitizer>("A2UI_MARKDOWN_SANITIZER");

/** Create the renderer shape required by the upstream A2UI markdown provider. */
function _createMarkdownRenderer(sanitizer: A2uiMarkdownSanitizer): Pick<MarkdownRenderer, "render">
{
	return {
		render: function _Render(markdown: string): Promise<string>
		{
			return Promise.resolve(sanitizer(markdown));
		}
	};
}

/**
 * Provide the constrained OpenCrane A2UI catalogue, theme, and injected sanitizer.
 *
 * @param sanitizer - Browser-owned markdown-to-safe-HTML implementation. Callers must not pass a
 * markdown renderer that returns unsanitized agent-authored HTML.
 */
export function provideOpenCraneA2ui(sanitizer: A2uiMarkdownSanitizer): (Provider | EnvironmentProviders)[]
{
	return [
		{ provide: _A2UI_MARKDOWN_SANITIZER, useValue: sanitizer },
		provideA2UI({ catalog: _OpenCraneA2uiCatalog(), theme: _OpenCraneA2uiTheme() }),
		{ provide: MarkdownRenderer, useFactory: _createMarkdownRenderer, deps: [_A2UI_MARKDOWN_SANITIZER] }
	];
}
