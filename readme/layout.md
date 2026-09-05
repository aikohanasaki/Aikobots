# Layout sizing compatibility patch

## Release note

Built-in layouts now calculate dependent panel sizes from their own chat width.
Compact layouts also apply their intended font, icon, composer, and top-bar sizes.
On desktop, navigation and prompt/CFG panels default to at least 450px wide,
limited by available viewport space. They overlap wide chats instead of shrinking
the chat. Existing panel actions, scrolling, mobile sizing, and iOS structural
overrides remain in place.

Chat Width is disabled when the active layout owns that width or Moving UI has
assigned an inline width to the chat. Use the existing movable-panel reset to
restore layout sizing. Switching layouts does not reset saved panel arrangements.
A movable-panel width restriction alone does not disable theme preset selection.

No custom CSS migration or settings conversion is required. Uploaded layouts keep
their existing geometry; the desktop panel floor applies only to built-in layouts.

## Width precedence and custom CSS

- Inline movable-panel widths take precedence over ordinary layout widths.
- Left Dock, Workspace Right, and Compact Ops own their chat width. Classic,
  Wide, Compact, and Top Composer delegate it to the Chat Width control.
- A custom declaration of `--sheldWidth` retains the existing control lock.
  Declaring `--aiko-layout-chat-width` also locks the control unless its value
  directly references `var(--sheldWidth)` (including the form with a fallback).
- To keep the slider active, use, for example:
  `--aiko-layout-chat-width: min(var(--sheldWidth, 50vw), 100dvw)`.
  Indirect aliases are conservatively treated as layout-owned widths; this patch
  does not implement a general CSS variable dependency resolver.

The shared `:root` contract is unchanged. CSS resolves variable dependencies on
the element where they are declared. Changing a source variable on `body` does
not recalculate dependent values inherited from `:root`. Custom layouts should
declare dependent widths or heights on the same `body.layout-custom` selector
when they need them to follow an overridden input. Built-in presets do this
explicitly without changing inheritance for uploaded layouts.

The shared smart-theme rules in `public/style.css` capture built-in panel widths
on `body`, then apply the desktop floor through panel-local variables. They do
not impose a minimum on manually resized inline widths. The
`--aiko-builtin-*` variables are internal implementation details.

## Regression checks

Run `npm run test:frontend:smoke -- --layouts` for the focused browser matrix;
the full frontend smoke also includes it. Set `FRONTEND_SMOKE_BROWSER` to
`chromium`, `firefox`, or `webkit` to select an installed Playwright browser.
Desktop WebKit is not a substitute for native iOS Safari validation.
The native resize-grip check first probes a plain CSS box and reports a skip if
the browser port does not support pointer automation of native resize grips.
