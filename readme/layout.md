# Aikobots standalone CSS layout authoring manual

This is a complete authoring reference for a person or AI assistant creating an uploaded Aikobots layout. You can copy this entire document into an AI conversation or attach it as a file. Repository access, the other documentation files, and knowledge of SillyTavern are not prerequisites. Source links are optional references for maintainers.

A layout is one CSS file applied to the existing Aikobots interface. It controls arrangement, spacing, typography, and theme-aware surfaces. Aikobots supplies the HTML, controls, state, and shared structural styles. The built-in layouts perform the same job; the complete examples below show how to use that existing system without inventing a second interface.

**Expected result:** one plain UTF-8 `.css` file that uploads successfully, affects only the active custom layout, remains usable on desktop and mobile, and preserves chat and panel actions. CSS can change presentation; it cannot create a working new chat pane, add application commands, change data access, or move elements to a different DOM parent.

## Contents

- [Use this manual with an AI assistant](#use-this-manual-with-an-ai-assistant)
- [Instructions for generating CSS](#instructions-for-generating-css)
- [Working starter file](#working-starter-file)
- [Source files and page structure](#source-files-and-page-structure)
- [Layout variables](#layout-variables)
- [Typography, icons, and composer sizing](#typography-icons-and-composer-sizing)
- [Complete layout recipes](#complete-layout-recipes)
- [SmartTheme styling and setting locks](#smarttheme-styling-and-setting-locks)
- [Images, fonts, and upload limits](#images-fonts-and-upload-limits)
- [Mobile and existing UI compatibility](#mobile-and-existing-ui-compatibility)
- [Troubleshooting and recovery](#troubleshooting-and-recovery)
- [Validation and repository maintenance](#validation-and-repository-maintenance)

## Use this manual with an AI assistant

Give the assistant the **contents** of this manual. A link alone is insufficient if the assistant cannot open it. Describe the layout in terms of the existing screen: chat alignment and width, reading density, composer placement, and which area should remain available for background art or panels.

Use this request with the manual attached or pasted below it:

```text
Create one complete Aikobots custom layout CSS file using the attached manual.

My design:
- Chat position and width: [centered, left, or right; preferred width]
- Message density: [comfortable or compact]
- Composer: [bottom or top]
- Typography: [inherit the theme, or describe the requested change]
- Background assets: [actual uploaded layout asset URLs, or none]
- Mobile behavior: full-width chat with accessible controls

Use the existing Aikobots HTML and the variables documented in the manual.
Scope every style rule to body.layout-custom.
Use SmartTheme colors. Preserve drawers, scrolling, editing, reasoning, swipes,
disabled/hidden states, and keyboard access.
Include every required variable dependency and a mobile reset.
Do not invent asset URLs, controls, selectors, or JavaScript.
Return only the complete CSS, without Markdown fences or omitted sections.
If a requested behavior cannot be achieved through this CSS interface, explain
that limitation before proposing a CSS alternative.
```

The bracketed lines are inputs to fill in, not text to put into CSS. You do not need to choose every option: the default is a centered, comfortably spaced chat, bottom composer, inherited fonts/colors, no image, and full-width mobile layout.

An assistant should work in this order:

1. Pick the closest complete example from this document.
2. Decide which dimensions the layout owns and which remain controlled by settings. Keep the Chat Width slider dependency if the user wants that control.
3. Change those inputs and retain their dependent expressions in the same body rule.
4. Add only the requested targeted appearance rules. Keep state and behavior with the app.
5. Include responsive overrides and ensure every supplied URL is permitted.
6. Check the result against the validation checklist. Distinguish CSS inspection from actual in-app testing.

For manual authoring, use the same examples in a plain-text editor. Save with a `.css` extension rather than `.css.txt`, upload with the CSS upload button in **User Settings → Layout**, and select the uploaded entry. You do not need a terminal, npm, a build tool, or a server restart for an uploaded layout. Retain your source file and use a distinct filename for experiments so you can return to the previous version.

## Instructions for generating CSS

1. Produce a complete, uploadable `.css` file. When asked for CSS, return CSS only, without Markdown fences, HTML, JavaScript, or build dependencies.
2. Start with the template below. Put variables first, targeted overrides second, and responsive overrides last. Change only what the requested design needs.
3. Scope every selector to `body.layout-custom`, including each selector in comma-separated lists and media queries. Avoid global resets, unscoped `:root`, and broad descendant selectors such as `body.layout-custom *`.
4. Prefer documented `--aiko-layout-*` variables. Keep chat, top bar, drawers, and dependent panel dimensions consistent. Redeclare dependent variables on the same element as their inputs.
5. Use active SmartTheme colors and fonts. Reuse existing theme styling before adding rules; do not invent colors, selectors, or contract variables.
6. Preserve scrolling, wrapping, keyboard focus, disabled/hidden states, drawer actions, message editing, swipes, and composer controls. Do not style `.closedDrawer`; target `.drawer-content.openDrawer` for open-drawer appearance only. Do not force panels open or hide controls to make a design fit.
7. Use standards-based CSS supported by modern Firefox, Chrome, and Safari. Avoid vendor prefixes, browser-detection hacks, unnecessary `!important`, fixed content heights, and new positioning or stacking contexts unless required by the design. Use flat rules compatible with the upload parser.
8. Include the mobile reset at `max-width: 1000px`. Preserve existing safe-area and mobile structural behavior. Respect reduced motion if adding animation.
9. Use actual uploaded layout image URLs supplied by the user. Never invent asset names in a finished file or embed remote images, data/base64 URLs, or file URLs. Keep user/chat/lorebook content out of generated CSS, attributes, logs, and persistent layout state.

For an AI request, provide this guide plus the desired arrangement, density, composer position, and any uploaded asset URLs. Inherit theme settings for anything unspecified.

## Working starter file

The Layout drawer includes a **Create your own layout** link below its selector and upload buttons, before the sizing controls. It opens this guide on the production `v5` branch in a new tab; a small note explains that users can follow the guide themselves or share it with an AI assistant, then upload the finished CSS. The link and note inherit the existing smart-theme styling and wrap on mobile.

Save as `my-layout.css`, upload through **User Settings → Layout → Upload layout CSS**, then select it in the Layout dropdown. This example owns an 840px maximum chat width and gives navigation/prompt panels a viewport-limited 450px width. Panels may overlap the chat.

```css
body.layout-custom {
    --aiko-layout-chat-width: min(840px, 92dvw);
    --aiko-layout-chat-left: 0;
    --aiko-layout-chat-right: 0;
    --aiko-layout-chat-margin-inline: auto;

    /* Resolve dependencies alongside the overridden chat width. */
    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: var(--aiko-layout-chat-left);
    --aiko-layout-topbar-right: var(--aiko-layout-chat-right);
    --aiko-layout-topbar-margin-inline: var(--aiko-layout-chat-margin-inline);
    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-min-width: min(450px, 100dvw);
    --aiko-layout-drawer-left: var(--aiko-layout-chat-left);
    --aiko-layout-drawer-right: var(--aiko-layout-chat-right);
    --aiko-layout-drawer-margin-inline: var(--aiko-layout-chat-margin-inline);

    --aiko-layout-left-panel-width: min(450px, 100dvw);
    --aiko-layout-left-panel-width-fallback: min(450px, 100vw);
    --aiko-layout-right-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-right-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);
    --aiko-layout-floating-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-floating-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);

    --aiko-layout-message-padding-block-start: 8px;
    --aiko-layout-message-padding-inline: 10px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: 100dvw;
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;
        /* Top bar and drawer alignment follow the body variables above. */
        --aiko-layout-left-panel-width: 100dvw;
        --aiko-layout-left-panel-width-fallback: 100vw;
    }
}
```

## Source files and page structure

| Source | Purpose |
|---|---|
| [layout-contract.css](../public/css/layouts/layout-contract.css) | Default variables on `:root` |
| [layout-structure.css](../public/css/layouts/layout-structure.css) | Shared geometry, scrolling, drawer states, mobile rules |
| [public/style.css](../public/style.css) | SmartTheme colors, typography, controls, and core feature styling |
| [public/index.html](../public/index.html) | Main DOM and message template |
| [power-user.js](../public/scripts/power-user.js) | Layout selection, theme controls, and CSS lock detection |
| [layouts.js](../src/endpoints/layouts.js) | Upload validation and asset limits |

The contract and base theme are included in the production CSS bundle. Separately loaded styles then apply in this order: `layout-structure.css` → selected stylesheet (`#aiko-layout-css`) → `css/user.css`. Normal specificity and inline-style precedence still apply. The active layout is marked by `data-aiko-layout` and a class on `<body>`.

Uploaded CSS runs against `body.layout-custom`. All custom files use that class; Aikobots swaps the active stylesheet rather than applying all uploaded files at once. The layout ID is `custom:filename.css`, but you do not need to target that ID in CSS.

The Layout upload and the Custom CSS editor are different surfaces. Upload this manual's files as layouts. A rule scoped to `body.layout-custom` in the general Custom CSS editor also matches whichever uploaded layout is selected; its placement later in the cascade can override the file you are testing.

### Geometry and stacking

The top bar, chat shell, generic drawers, and navigation panels are separately positioned surfaces. They are not columns in one page-level CSS grid. Changing `#sheld` to a grid does not place a sibling navigation drawer next to it. Use the width/offset variables to align separately positioned surfaces.

| Surface | Shared desktop geometry | Consequence for custom CSS |
|---|---|---|
| `#top-bar` | Absolute; top-bar width/left/right variables; height `--topBarBlockSize`; z-index 3005 | Align through variables; leave icon hit targets available |
| `#top-settings-holder` | Uses the same top-bar width and horizontal offsets | Changing only the decorative bar does not align its controls |
| `#sheld` | Absolute flex column; z-index 30; at least 100px wide/high | Preserve flex sizing and viewport-limited height |
| `#chat` | Flexible vertical scroll region; `min-height: 0` | Do not give the whole conversation an expanding fixed content height |
| `.drawer-content` | Normally absolute and closed by default | Width/position are layout inputs; display and open state are app-owned |
| `.fillLeft`, `.fillRight` | Fixed against their respective viewport edges; open panels are flex columns | Their inner content scrolls; opening one may overlap chat |
| `#floatingPrompt`, `#cfgConfig` | Fixed, hidden until opened; z-index 4000; capped at 90dvw/90dvh on desktop | Width variables do not override those caps or open the panel |
| `#movingDivs > div` | Movable surfaces at z-index 4000 | Saved inline geometry can supersede your dimensions |

Do not raise the chat above the navigation controls to solve an overlap. Do not add `transform`, `filter`, opacity, or containment to large ancestors just to decorate them: these can change stacking or positioning behavior. Ordinary popup dialogs live outside the chat shell and have their own constrained scrolling surfaces.

### Composer structure

The relevant nesting is:

```text
#sheld
├─ #chat
└─ #form_sheld
   ├─ bulk-edit controls (when active)
   └─ #send_form
      ├─ #file_form (attachment controls, when active)
      └─ #nonQRFormItems
         ├─ #leftSendForm
         │  └─ #options_button
         ├─ textarea#send_textarea
         └─ #rightSendForm
            ├─ #mes_stop
            ├─ #mes_impersonate
            ├─ #mes_regenerate
            ├─ #mes_continue
            └─ #send_but
```

This is a targeting map, not replacement markup. Some controls appear only for a connection or generation state. Keep stop, send, attachment, and bulk-edit controls reachable. Do not force `#send_but` visible or `#mes_stop` hidden.

The composer and chat order variables work because `#form_sheld` and `#chat` share a flex parent. CSS `order` changes visual placement; it does not change DOM or keyboard traversal order. Retain the existing input, resizing/growth behavior, and wrapping form. Do not use a fixed composer height that clips a multiline draft.

Built-in files live in [public/css/layouts](../public/css/layouts). Their names identify useful starting concepts; the complete recipes in this document provide the required CSS without opening those files. “Workspace Right” means a chat docked left with working space on the right, not a right-docked chat.

| Display Name | Layout ID | Body Class | CSS File |
|---|---|---|---|
| Classic | `classic` | `layout-classic` | `classic.css` |
| Wide | `wide` | `layout-wide` | `wide.css` |
| Compact | `compact` | `layout-compact` | `compact.css` |
| Left Dock | `leftDock` | `layout-left-dock` | `left-dock.css` |
| Workspace Right | `workspaceRight` | `layout-workspace-right` | `workspace-right.css` |
| Compact Ops | `compactOps` | `layout-compact-ops` | `compact-ops.css` |
| Top Composer | `topComposer` | `layout-top-composer` | `top-composer.css` |
| Custom Upload | `custom:filename.css` | `layout-custom` | uploaded CSS |

| Selector | Meaning |
|---|---|
| `#top-bar` | Top icon bar |
| `#top-settings-holder` | Wrapper around top-bar drawers |
| `#sheld` | Main chat shell |
| `#chat` | Scrollable message list |
| `#form_sheld` | Composer/input wrapper |
| `#send_form` | Actual send form |
| `.drawer-content` | Generic drawer/panel |
| `.fillLeft` | Left-side full-height panel |
| `.fillRight` | Right-side full-height panel |
| `#floatingPrompt` | Floating prompt panel |
| `#cfgConfig` | CFG configuration panel |

`#sheld` is a positioned flex column containing `#chat` and `#form_sheld`. Preserve the chat's `flex: 1 1 auto`, `min-height: 0`, and vertical scrolling. `#send_textarea` is the editable composer input. Open `.fillLeft`/`.fillRight` panels rely on their inner `.scrollableInner` for scrolling.

Message structure, simplified for selector targeting (do not generate replacement HTML):

```text
.mes
├─ .mesAvatarWrapper
│  ├─ .avatar > img
│  ├─ .mesIDDisplay
│  ├─ .mes_timer
│  └─ .tokenCounterDisplay
├─ .swipe_left
├─ .mes_block
│  ├─ .ch_name
│  │  ├─ .name_text
│  │  ├─ .timestamp
│  │  ├─ .mes_buttons (normal actions, including .extraMesButtons)
│  │  └─ .mes_edit_buttons (edit-mode actions)
│  ├─ details.mes_reasoning_details
│  │  ├─ summary.mes_reasoning_summary
│  │  └─ .mes_reasoning
│  ├─ .mes_text
│  ├─ .mes_media_wrapper
│  ├─ .mes_file_wrapper
│  └─ .mes_bias
└─ .swipeRightBlock
   ├─ .swipe_right
   └─ .swipes-counter
```

The tree omits some header wrappers, bulk-selection controls, and optional runtime content. Do not assume the displayed header children are all direct children. Target their named classes without a direct-child combinator unless the nesting is shown explicitly.

| Message selector/state | Authoring guidance |
|---|---|
| `.mes[is_user="true"]` | User message styling; use the existing attribute rather than inferring from names or position |
| `.mes[is_user="false"]` | Non-user message styling; this can include system/tool variants, not only ordinary AI replies |
| `.mes[is_system="true"]`, `.mes_ghost` | App-owned system/visibility presentation; do not infer permissions or force controls visible |
| `.mesAvatarWrapper` | Holds avatar and metadata, not just an image; hiding it also hides that metadata |
| `.mes_text` | Rendered content; may include paragraphs, lists, quotes, code, and tables |
| `.mes_reasoning_details` / `.mes_reasoning_summary` | Native disclosure and its interactive summary; preserve open/closed and empty-state behavior |
| `.mes_reasoning` | Rendered reasoning content; preserve wrapping and available controls |
| `.edit_textarea`, `.reasoning_edit_textarea` | Runtime editing surfaces; preserve width, input behavior, and scrolling |
| `.mes_edit_buttons` | Confirm/cancel/clone/delete/move controls shown by the app during editing |
| `.mes_media_wrapper`, `.mes_file_wrapper` | Media and attachment content; do not impose a fixed message height |
| `.swipe_left`, `.swipe_right`, `.swipes-counter` | Existing swipe navigation; keep the space reserved for it |
| `.for_checkbox`, `.del_checkbox` | Bulk-selection UI; leave visibility to the app |
| `.last_mes` | Current last-message styling; changes as messages arrive |

Do not hardcode `mesid`, `ch_name`, message text, or user identities into reusable CSS. Do not use `content: attr(...)` to expose message attributes. A layout must not reveal elements that the app hides for eligibility, access, or state.

Long text and reasoning already use `overflow-wrap: anywhere`. Preserve horizontal scrolling inside code blocks and avoid global word-breaking rules on all descendants. A `max-height` on each message with hidden overflow can silently hide most of a long answer; do not use it as a density adjustment.

## Layout variables

Every name below exists in the contract. Leave unchanged variables inherited instead of copying the whole contract.

| Area | Variables | Meaning/default |
|---|---|---|
| Chat width | `--aiko-layout-chat-width` | `var(--sheldWidth, 50vw)` |
| Chat position | `--aiko-layout-chat-top`, `--aiko-layout-chat-left`, `--aiko-layout-chat-right`, `--aiko-layout-chat-margin-inline` | Below top bar; centered with left/right `0`, margin `auto` |
| Chat height | `--aiko-layout-chat-height`, `--aiko-layout-chat-height-fallback`, `--aiko-layout-chat-max-height` | Viewport minus top bar and 1px |
| Chat scroll limit | `--aiko-layout-chat-scroll-max-height`, `--aiko-layout-chat-scroll-max-height-fallback` | Viewport minus top bar and composer |
| Top bar | `--aiko-layout-topbar-width`, `--aiko-layout-topbar-left`, `--aiko-layout-topbar-right`, `--aiko-layout-topbar-margin-inline` | Chat width, centered |
| Left panel | `--aiko-layout-left-panel-width`, `--aiko-layout-left-panel-width-fallback` | Half the space outside chat, minus 1px |
| Right panel | `--aiko-layout-right-panel-width`, `--aiko-layout-right-panel-width-fallback` | Half the space outside chat, minus 1px |
| Drawer width | `--aiko-layout-drawer-width`, `--aiko-layout-drawer-min-width` | Chat width; minimum 450px on desktop |
| Drawer position | `--aiko-layout-drawer-top`, `--aiko-layout-drawer-left`, `--aiko-layout-drawer-right`, `--aiko-layout-drawer-margin-inline` | Below top bar, centered |
| Drawer height | `--aiko-layout-drawer-max-height`, `--aiko-layout-drawer-max-height-fallback` | Viewport minus top bar and composer |
| Side panel height | `--aiko-layout-panel-max-height`, `--aiko-layout-panel-max-height-fallback` | Viewport minus top bar |
| Floating panel | `--aiko-layout-floating-panel-width`, `--aiko-layout-floating-panel-width-fallback` | Half the space outside chat, minus 1px |
| Message width | `--aiko-layout-message-max-width`, `--aiko-layout-message-margin-inline` | `none`, `0` |
| Message padding | `--aiko-layout-message-padding-block-start`, `--aiko-layout-message-padding-inline` | Both `10px` |
| Order | `--aiko-layout-composer-order`, `--aiko-layout-chat-order` | Both `initial`; set `1` and `2` for top composer |

The `-fallback` dimensions use `vw`/`vh` where the primary dimensions use `dvw`/`dvh`. Update both when changing those dimensions.

### Exact contract defaults

This is the complete shared layout contract as a **read-only reference**. Aikobots already provides it; do not upload this root block as your layout. The examples below override only the parts they need on `body.layout-custom`.

```css
/* Reference only: already supplied by Aikobots. */
:root {
    --sheldWidth: 50vw;
    --aiko-layout-chat-width: var(--sheldWidth, 50vw);
    --aiko-layout-chat-top: var(--topBarBlockSize);
    --aiko-layout-chat-height: calc(100dvh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-height-fallback: calc(100vh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-max-height: calc(100dvh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-scroll-max-height: calc(100dvh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-chat-scroll-max-height-fallback: calc(100vh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-chat-left: 0;
    --aiko-layout-chat-right: 0;
    --aiko-layout-chat-margin-inline: auto;

    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: 0;
    --aiko-layout-topbar-right: 0;
    --aiko-layout-topbar-margin-inline: auto;

    --aiko-layout-left-panel-width: calc((100dvw - var(--aiko-layout-chat-width) - 2px) / 2);
    --aiko-layout-left-panel-width-fallback: calc((100vw - var(--aiko-layout-chat-width) - 2px) / 2);
    --aiko-layout-right-panel-width: calc((100dvw - var(--aiko-layout-chat-width) - 2px) / 2);
    --aiko-layout-right-panel-width-fallback: calc((100vw - var(--aiko-layout-chat-width) - 2px) / 2);

    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-min-width: 450px;
    --aiko-layout-drawer-top: var(--topBarBlockSize);
    --aiko-layout-drawer-left: 0;
    --aiko-layout-drawer-right: 0;
    --aiko-layout-drawer-margin-inline: auto;
    --aiko-layout-drawer-max-height: calc(100dvh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-drawer-max-height-fallback: calc(100vh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-panel-max-height: calc(100dvh - var(--topBarBlockSize));
    --aiko-layout-panel-max-height-fallback: calc(100vh - var(--topBarBlockSize));
    --aiko-layout-floating-panel-width: calc(((100dvw - var(--aiko-layout-chat-width)) / 2) - 1px);
    --aiko-layout-floating-panel-width-fallback: calc(((100vw - var(--aiko-layout-chat-width)) / 2) - 1px);

    --aiko-layout-message-max-width: none;
    --aiko-layout-message-margin-inline: 0;
    --aiko-layout-message-padding-block-start: 10px;
    --aiko-layout-message-padding-inline: 10px;

    --aiko-layout-composer-order: initial;
    --aiko-layout-chat-order: initial;
}
```

The ordinary desktop side widths are calculated from a centered-chat assumption. Docking the chat does not make those formulas a workspace layout automatically. Choose panel widths explicitly, or use the workspace recipe below. The built-in-only 450px panel floor is separate from these root defaults.

A custom property holds CSS tokens, not an automatically inferred number. Use lengths for dimensions (`px`, `rem`, `vw`, `dvw`, etc.), unitless values for scales and order, `auto` for the undocked edge, and valid margin values for inline margins. A missing or wrongly typed variable can invalidate the consuming property even though the uploaded stylesheet parses successfully.

### Dependencies and width precedence

CSS resolves a custom property's `var()` dependencies on the element where it is declared. Changing chat width on `body` does **not** recalculate top-bar or panel widths inherited from `:root`. Redeclare dependent expressions on `body.layout-custom`, as the starter does. The same applies to typography, icon sizes, composer dimensions, and heights.

Built-in presets resolve their dependencies on `body`. Their desktop navigation and prompt/CFG panels have a 450px floor, limited by the viewport, and overlap wide chats. Uploaded layouts do not inherit this built-in floor; choose their panel geometry explicitly. Do not use the internal `--aiko-builtin-*` variables in custom CSS. Existing uploaded layouts need no migration.

Inline widths assigned by Moving UI override ordinary layout widths. While Moving UI is enabled and the chat has an inline width, Chat Width is disabled. Use the existing movable-panel reset to restore layout sizing; switching layouts preserves saved arrangements. A movable width restriction alone does not disable theme presets.

Left Dock, Workspace Right, and Compact Ops own chat width. Classic, Wide, Compact, and Top Composer delegate to the slider. For custom CSS, declaring `--sheldWidth` locks Chat Width. Declaring `--aiko-layout-chat-width` also locks it unless its value directly references `var(--sheldWidth)` (a fallback is allowed). To delegate to the slider, replace the starter's width with:

```css
body.layout-custom {
    --aiko-layout-chat-width: min(var(--sheldWidth, 50vw), 100dvw);
}
```

Keep that direct reference in **every** declaration of `--aiko-layout-chat-width`, including the mobile rule: lock inspection includes nested rules. Shared mobile structure already forces viewport width. Indirect aliases are conservatively treated as layout-owned widths; there is no general variable dependency resolver.

### Common variations

- **Narrow/wide:** change the starter width to `min(760px, 94dvw)` or `min(1100px, 96dvw)`.
- **Left dock:** use width `min(840px, calc(100dvw - 48px))`, chat left `24px`, right `auto`, and inline margin `0`. The starter's top-bar/drawer aliases follow. Keep its mobile reset.
- **Right dock:** use that same constrained width, chat left `auto`, right `24px`, and inline margin `0`.
- **Compact spacing:** reduce message padding and `.mes_block` padding. Avatar dimensions are `--avatar-base-width` and `--avatar-base-height`; preserve readable controls and room for message actions.
- **Top composer:** set composer order to `1` and chat order to `2`; a scoped `#form_sheld` rule can set `margin-top: 0` and `margin-bottom: 1px`.

## Typography, icons, and composer sizing

Changing only `--fontScale` or `--topBarIconScale` on the body is insufficient. Values derived on `:root` have already resolved their inputs before they are inherited. These are the relevant theme defaults:

| Variable | Default expression/value | Units and role |
|---|---|---|
| `--fontScale` | `1` | Unitless scale |
| `--mainFontSize` | `calc(var(--fontScale) * 15px)` | Base application font size |
| `--mainFontFamily` | `"Noto Sans", sans-serif` | Font list |
| `--monoFontFamily` | `'Noto Sans Mono', 'Courier New', Consolas, monospace` | Monospace font list |
| `--chatTextLineHeightScale` | `1` | Unitless message line-height multiplier |
| `--chatTextLetterSpacing` | `0px` | Message letter spacing |
| `--bottomFormBlockPadding` | `calc(var(--mainFontSize) / 2.5)` | Composer block padding input |
| `--bottomFormIconSize` | `calc(var(--mainFontSize) * 1.9)` | Composer icon dimension |
| `--bottomFormBlockSize` | `calc(var(--bottomFormIconSize) + var(--bottomFormBlockPadding))` | Composer sizing input |
| `--topBarIconScale` | `1` | Unitless top icon scale |
| `--topBarIconSpacing` | `0px` | Top icon spacing |
| `--topBarIconSize` | `calc(var(--mainFontSize) * 2 * var(--topBarIconScale))` | Top icon dimension |
| `--topBarBlockPadding` | `calc(var(--mainFontSize) / 3)` | Top-bar padding input |
| `--topBarBlockSize` | `calc(var(--topBarIconSize) + var(--topBarBlockPadding))` | Top-bar height and chat offset input |
| `--mes-right-spacing` | `30px` | Space at the right of message text for existing controls |
| `--avatar-base-width`, `--avatar-base-height` | `50px`, `50px` | Base avatar dimensions |
| `--avatar-base-border-radius` | `2px` | Base avatar rounding |
| `--avatar-base-border-radius-round` | `50%` | Round-avatar variant |
| `--avatar-base-border-radius-rounded` | `10px` | Rounded-avatar variant |
| `--inline-avatar-small-factor` | `0.6` | Unitless inline-avatar scale |
| `--blurStrength` | `10` | Unitless blur input; `--SmartThemeBlurStrength` is `calc(var(--blurStrength) * 1px)` |
| `--shadowWidth` | `2` | Unitless text-shadow sizing input |

Defaults are starting values; the user's settings/theme may supply different values. Referencing them preserves that choice. Declaring them on the custom body can lock the corresponding control.

### Complete dependency block for compact typography

This is a complete **add-on block** for the starter, not a separate replacement for its width/alignment rules. Place it before the starter's final mobile media query. All dependencies are included here, so no external source file is needed.

```css
body.layout-custom {
    --fontScale: 0.9;
    --topBarIconScale: 0.8;
    --bottomFormBlockPadding: 3px;
    --avatar-base-width: 36px;
    --avatar-base-height: 36px;
    --mes-right-spacing: 18px;

    --aiko-layout-message-padding-block-start: 4px;
    --aiko-layout-message-padding-inline: 6px;

    /* Resolve inherited dependencies where this preset overrides their inputs. */
    --mainFontSize: calc(var(--fontScale) * 15px);
    --bottomFormIconSize: calc(var(--mainFontSize) * 1.9);
    --bottomFormBlockSize: calc(var(--bottomFormIconSize) + var(--bottomFormBlockPadding));
    --topBarIconSize: calc(var(--mainFontSize) * 2 * var(--topBarIconScale));
    --topBarBlockPadding: calc(var(--mainFontSize) / 3);
    --topBarBlockSize: calc(var(--topBarIconSize) + var(--topBarBlockPadding));
    --aiko-layout-chat-top: var(--topBarBlockSize);
    --aiko-layout-chat-height: calc(100dvh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-height-fallback: calc(100vh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-max-height: calc(100dvh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-scroll-max-height: calc(100dvh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-chat-scroll-max-height-fallback: calc(100vh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-drawer-top: var(--topBarBlockSize);
    --aiko-layout-drawer-max-height: calc(100dvh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-drawer-max-height-fallback: calc(100vh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-panel-max-height: calc(100dvh - var(--topBarBlockSize));
    --aiko-layout-panel-max-height-fallback: calc(100vh - var(--topBarBlockSize));
}
```

The dependency path is font scale → font size → icon/padding sizes → bar/composer sizes → chat and panel positions/heights. Because these expressions are all on the body, a later media query can change an input and the body-level dependents will follow it.

This block owns both desktop and mobile font-scale controls. If you want the user's font preference, omit `--fontScale: 0.9` but retain the body-level `--mainFontSize` and other formulas whenever you change a dependent input such as the icon scale. If you only want tighter messages, leave this entire typography block out and change the message padding variables instead.

Avoid reducing text and hit targets indiscriminately. For a desktop-only compact design, restore comfortable input values on mobile inside the final media query:

```css
@media screen and (max-width: 1000px) {
    body.layout-custom {
        --fontScale: 1;
        --topBarIconScale: 1;
        --bottomFormBlockPadding: calc(var(--mainFontSize) / 2.5);
        --avatar-base-width: 44px;
        --avatar-base-height: 44px;
        --mes-right-spacing: 30px;
        --aiko-layout-message-padding-block-start: 8px;
        --aiko-layout-message-padding-inline: 10px;
    }
}
```

That is an add-on to a layout that already has the dependency block. It does not restore user ownership of the font controls: the file still declares their values. CSS viewport breakpoints and the app's detected desktop/mobile font preferences are different mechanisms.

### Diagnosing a dependency mismatch

If the chat changes width but the top bar stays at its old width, inspect the declarations, not just their names. The correct relationship is two declarations in the same body rule:

```css
body.layout-custom {
    --aiko-layout-chat-width: min(900px, 94dvw);
    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
}
```

This is a dependency illustration, not a complete layout: also keep the starter's drawer and panel rules. If the font shrinks but the top bar retains its old height, the missing declarations are usually `--mainFontSize`, `--topBarIconSize`, `--topBarBlockPadding`, and `--topBarBlockSize`, followed by the chat/panel height expressions. Raising specificity or adding `!important` does not repair a value that resolved against the wrong input.

## Complete layout recipes

Each code block in this section is a **whole CSS file**. Choose one as a starting point. Do not concatenate whole recipes: later body declarations would replace earlier choices. Optional add-on snippets elsewhere in the manual are labeled as such.

The earlier working starter is recipe A: a centered reading layout. These alternatives include their own alignment, dependent panel widths, and mobile rules. They inherit the application's drawer behavior and state.

| Recipe | Desktop behavior | Ownership and mobile behavior |
|---|---|---|
| A: working starter | Chat capped at 840px, centered; 450px overlay panels | Owns chat width and message spacing; full width on mobile |
| B: adjustable wide | Chat follows the Chat Width slider, capped at 1180px and 96dvw | Keeps Chat Width available unless Moving UI overrides it; full width on mobile through shared structure |
| C: right workspace | Chat on the left; right navigation/prompt panels fit the remaining right area | Owns width; opening panels remains a user action; full width on mobile |
| D: right-docked reading | Chat on the right with a 24px desktop gap; room for background on the left | Owns width; panels may overlap; centered/full width on mobile |
| E: compact top composer | Smaller desktop font/icons with the complete dependency chain; composer above chat | Owns width/font/icon/message settings; comfortable sizes on mobile, composer still above chat |

All five adjust message spacing, which can lock Chat Style and theme preset controls. “Keeps Chat Width available” does not mean every other appearance control remains unlocked.

### B. Adjustable wide layout

Save as `adjustable-wide.css`. On a 1440px viewport with Chat Width at 50%, the chat is 720px wide. At higher slider settings it stops growing at the smaller of 1180px and 96% of the viewport. The direct slider reference is deliberately present in the mobile declaration too.

```css
body.layout-custom {
    --aiko-layout-chat-width: min(1180px, var(--sheldWidth, 50vw), 96dvw);
    --aiko-layout-chat-left: 0;
    --aiko-layout-chat-right: 0;
    --aiko-layout-chat-margin-inline: auto;

    /* Resolve dependencies alongside the overridden chat width. */
    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: var(--aiko-layout-chat-left);
    --aiko-layout-topbar-right: var(--aiko-layout-chat-right);
    --aiko-layout-topbar-margin-inline: var(--aiko-layout-chat-margin-inline);
    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-min-width: min(450px, 100dvw);
    --aiko-layout-drawer-left: var(--aiko-layout-chat-left);
    --aiko-layout-drawer-right: var(--aiko-layout-chat-right);
    --aiko-layout-drawer-margin-inline: var(--aiko-layout-chat-margin-inline);

    --aiko-layout-left-panel-width: min(450px, 100dvw);
    --aiko-layout-left-panel-width-fallback: min(450px, 100vw);
    --aiko-layout-right-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-right-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);
    --aiko-layout-floating-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-floating-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);

    --aiko-layout-message-padding-block-start: 8px;
    --aiko-layout-message-padding-inline: 10px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: min(var(--sheldWidth, 50vw), 100dvw);
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;
        /* Top bar and drawer alignment follow the body variables above. */
        --aiko-layout-left-panel-width: 100dvw;
        --aiko-layout-left-panel-width-fallback: 100vw;
    }
}
```

### C. Left chat with a right-side workspace

Save as `right-workspace.css`. `--my-layout-gap` is a private helper defined by this file, not a built-in contract variable. On a 1440px viewport, the chat is 691.2px wide at x=24px. The right area is 700.8px wide and ends 24px from the right edge. These dimensions are width allocations; this file does not pin panels open or create new panels.

The ordinary left navigation remains a 450px overlay. The right navigation and floating prompt/CFG panels align to the right workspace. Panel dragging or saved inline geometry can override that placement.

```css
body.layout-custom {
    --my-layout-gap: 24px;
    --aiko-layout-chat-width: min(720px, 48dvw);
    --aiko-layout-chat-left: var(--my-layout-gap);
    --aiko-layout-chat-right: auto;
    --aiko-layout-chat-margin-inline: 0;

    /* Resolve dependencies alongside the overridden chat width. */
    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: var(--aiko-layout-chat-left);
    --aiko-layout-topbar-right: var(--aiko-layout-chat-right);
    --aiko-layout-topbar-margin-inline: var(--aiko-layout-chat-margin-inline);
    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-min-width: min(450px, 100dvw);
    --aiko-layout-drawer-left: var(--aiko-layout-chat-left);
    --aiko-layout-drawer-right: var(--aiko-layout-chat-right);
    --aiko-layout-drawer-margin-inline: var(--aiko-layout-chat-margin-inline);

    --aiko-layout-left-panel-width: min(450px, 100dvw);
    --aiko-layout-left-panel-width-fallback: min(450px, 100vw);
    --aiko-layout-right-panel-width: calc(100dvw - var(--aiko-layout-chat-width) - (var(--my-layout-gap) * 2));
    --aiko-layout-right-panel-width-fallback: calc(100vw - var(--aiko-layout-chat-width) - (var(--my-layout-gap) * 2));
    --aiko-layout-floating-panel-width: var(--aiko-layout-right-panel-width);
    --aiko-layout-floating-panel-width-fallback: var(--aiko-layout-right-panel-width-fallback);

    --aiko-layout-message-padding-block-start: 8px;
    --aiko-layout-message-padding-inline: 10px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

body.layout-custom .fillRight,
body.layout-custom #floatingPrompt,
body.layout-custom #cfgConfig {
    left: auto;
    right: var(--my-layout-gap);
}

@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: 100dvw;
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;
        /* Top bar and drawer alignment follow the body variables above. */
        --aiko-layout-left-panel-width: 100dvw;
        --aiko-layout-left-panel-width-fallback: 100vw;
        --aiko-layout-right-panel-width: 100dvw;
        --aiko-layout-right-panel-width-fallback: 100vw;
    }

    body.layout-custom .fillRight,
    body.layout-custom #floatingPrompt,
    body.layout-custom #cfgConfig {
        left: 0;
        right: auto;
    }
}
```

### D. Right-docked reading layout

Save as `right-reading.css`. The desktop chat, top bar, and generic drawers share a right edge 24px from the viewport edge. Navigation panels retain their normal viewport-edge placement and can overlap the chat. The mobile rule resets the chat's left/right/margin inputs; top-bar and drawer aliases follow.

```css
body.layout-custom {
    --aiko-layout-chat-width: min(840px, calc(100dvw - 48px));
    --aiko-layout-chat-left: auto;
    --aiko-layout-chat-right: 24px;
    --aiko-layout-chat-margin-inline: 0;

    /* Resolve dependencies alongside the overridden chat width. */
    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: var(--aiko-layout-chat-left);
    --aiko-layout-topbar-right: var(--aiko-layout-chat-right);
    --aiko-layout-topbar-margin-inline: var(--aiko-layout-chat-margin-inline);
    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-min-width: min(450px, 100dvw);
    --aiko-layout-drawer-left: var(--aiko-layout-chat-left);
    --aiko-layout-drawer-right: var(--aiko-layout-chat-right);
    --aiko-layout-drawer-margin-inline: var(--aiko-layout-chat-margin-inline);

    --aiko-layout-left-panel-width: min(450px, 100dvw);
    --aiko-layout-left-panel-width-fallback: min(450px, 100vw);
    --aiko-layout-right-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-right-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);
    --aiko-layout-floating-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-floating-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);

    --aiko-layout-message-padding-block-start: 8px;
    --aiko-layout-message-padding-inline: 10px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: 100dvw;
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;
        /* Top bar and drawer alignment follow the body variables above. */
        --aiko-layout-left-panel-width: 100dvw;
        --aiko-layout-left-panel-width-fallback: 100vw;
    }
}
```

### E. Compact desktop with a top composer

Save as `compact-top.css`. This example includes the entire font/icon/height dependency chain and its width geometry. It restores larger typography and avatars on mobile. The composer stays visually above chat on both sizes.

The second body block intentionally adds typography to the first block's geometry. The final body block before the media query selects order. They all target the same element, so their variable expressions participate in the same computed style.

```css
body.layout-custom {
    --aiko-layout-chat-width: min(960px, 96dvw);
    --aiko-layout-chat-left: 0;
    --aiko-layout-chat-right: 0;
    --aiko-layout-chat-margin-inline: auto;

    /* Resolve dependencies alongside the overridden chat width. */
    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: var(--aiko-layout-chat-left);
    --aiko-layout-topbar-right: var(--aiko-layout-chat-right);
    --aiko-layout-topbar-margin-inline: var(--aiko-layout-chat-margin-inline);
    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-min-width: min(450px, 100dvw);
    --aiko-layout-drawer-left: var(--aiko-layout-chat-left);
    --aiko-layout-drawer-right: var(--aiko-layout-chat-right);
    --aiko-layout-drawer-margin-inline: var(--aiko-layout-chat-margin-inline);

    --aiko-layout-left-panel-width: min(450px, 100dvw);
    --aiko-layout-left-panel-width-fallback: min(450px, 100vw);
    --aiko-layout-right-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-right-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);
    --aiko-layout-floating-panel-width: var(--aiko-layout-left-panel-width);
    --aiko-layout-floating-panel-width-fallback: var(--aiko-layout-left-panel-width-fallback);

    --aiko-layout-message-padding-block-start: 8px;
    --aiko-layout-message-padding-inline: 10px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

body.layout-custom {
    --fontScale: 0.9;
    --topBarIconScale: 0.8;
    --bottomFormBlockPadding: 3px;
    --avatar-base-width: 36px;
    --avatar-base-height: 36px;
    --mes-right-spacing: 18px;

    --aiko-layout-message-padding-block-start: 4px;
    --aiko-layout-message-padding-inline: 6px;

    /* Resolve inherited dependencies where this preset overrides their inputs. */
    --mainFontSize: calc(var(--fontScale) * 15px);
    --bottomFormIconSize: calc(var(--mainFontSize) * 1.9);
    --bottomFormBlockSize: calc(var(--bottomFormIconSize) + var(--bottomFormBlockPadding));
    --topBarIconSize: calc(var(--mainFontSize) * 2 * var(--topBarIconScale));
    --topBarBlockPadding: calc(var(--mainFontSize) / 3);
    --topBarBlockSize: calc(var(--topBarIconSize) + var(--topBarBlockPadding));
    --aiko-layout-chat-top: var(--topBarBlockSize);
    --aiko-layout-chat-height: calc(100dvh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-height-fallback: calc(100vh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-max-height: calc(100dvh - var(--topBarBlockSize) - 1px);
    --aiko-layout-chat-scroll-max-height: calc(100dvh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-chat-scroll-max-height-fallback: calc(100vh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-drawer-top: var(--topBarBlockSize);
    --aiko-layout-drawer-max-height: calc(100dvh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-drawer-max-height-fallback: calc(100vh - calc(var(--topBarBlockSize) + var(--bottomFormBlockSize)));
    --aiko-layout-panel-max-height: calc(100dvh - var(--topBarBlockSize));
    --aiko-layout-panel-max-height-fallback: calc(100vh - var(--topBarBlockSize));
}

body.layout-custom {
    --aiko-layout-composer-order: 1;
    --aiko-layout-chat-order: 2;
}

body.layout-custom #form_sheld {
    margin-top: 0;
    margin-bottom: 1px;
}

body.layout-custom #send_textarea {
    padding: 3px 5px;
}

@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: 100dvw;
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;
        /* Top bar and drawer alignment follow the body variables above. */
        --aiko-layout-left-panel-width: 100dvw;
        --aiko-layout-left-panel-width-fallback: 100vw;
        --fontScale: 1;
        --topBarIconScale: 1;
        --bottomFormBlockPadding: calc(var(--mainFontSize) / 2.5);
        --avatar-base-width: 44px;
        --avatar-base-height: 44px;
        --mes-right-spacing: 30px;
        --aiko-layout-message-padding-block-start: 8px;
        --aiko-layout-message-padding-inline: 10px;
    }
}
```

To keep the composer at the bottom on mobile, add `--aiko-layout-composer-order: initial` and `--aiko-layout-chat-order: initial` to the final mobile body rule, then restore the wrapper's normal margin in a scoped rule inside that media query: `body.layout-custom #form_sheld { margin: 1px auto 0; }`. Keep DOM and keyboard order unchanged.

## SmartTheme styling and setting locks

Reference these colors with `var(...)` so the layout follows the selected theme:

| UI Control | CSS Variable | Typical Use |
|---|---|---|
| Main Text | `--SmartThemeBodyColor` | Primary text, icons, checkbox base color |
| Italics Text | `--SmartThemeEmColor` | Secondary/emphasis text |
| Underlined Text | `--SmartThemeUnderlineColor` | Underlined/generated text accents |
| Quote Text | `--SmartThemeQuoteColor` | Accent color, quotes, selected states |
| Text Shadow | `--SmartThemeShadowColor` | Text shadows and panel shadows |
| Chat Background | `--SmartThemeChatTintColor` | Main chat surface tint |
| UI Background | `--SmartThemeBlurTintColor` | Drawers, popups, menus, general UI panels |
| UI Border | `--SmartThemeBorderColor` | Borders, outlines, dividers |
| User Message | `--SmartThemeUserMesBlurTintColor` | User message background tint |
| AI Message | `--SmartThemeBotMesBlurTintColor` | AI message background tint |

Use `--mainFontFamily` for main text and `--monoFontFamily` for code. Inherit checkbox styling: its `--SmartThemeCheckboxBgColorR/G/B/A` components and `--SmartThemeCheckboxTickColorValue` / `--SmartThemeCheckboxTickColor` derive from the theme. `--SmartThemeBlurStrength` derives from `--blurStrength`.

For a tinted chat surface:

```css
body.layout-custom #sheld {
    background-color: color-mix(in srgb, var(--SmartThemeChatTintColor) 92%, transparent);
    border: 1px solid var(--SmartThemeBorderColor);
}
```

### Theme-aware appearance add-ons

These snippets extend one complete layout. Place them before its mobile rules. They use theme values instead of redefining the palette.

A light border and tinted surface can distinguish messages without replacing their internal layout:

```css
body.layout-custom .mes[is_user="true"] {
    background-color: var(--SmartThemeUserMesBlurTintColor);
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 10px;
}

body.layout-custom .mes[is_user="false"] {
    background-color: var(--SmartThemeBotMesBlurTintColor);
    border: 1px solid var(--SmartThemeBorderColor);
    border-radius: 10px;
}
```

That second rule includes non-user variants. If you only intend ordinary AI responses, preserve special/system presentation rather than assuming every non-user message has the same role. Keep the normal `.mes_block`, header, swipe, and editing geometry.

For more breathing room in rendered prose, use the existing text settings instead of overriding all paragraphs and code descendants:

```css
body.layout-custom {
    --chatTextLineHeightScale: 1.08;
    --chatTextLetterSpacing: 0px;
}
```

This owns the corresponding text controls. `--chatTextLetterSpacing` is a length; `--chatTextLineHeightScale` is a multiplier, not a pixel value.

For a subtle open-drawer border, use:

```css
body.layout-custom .drawer-content.openDrawer {
    border-color: var(--SmartThemeBorderColor);
}
```

Do not add `display`, `height`, or `visibility` to that rule. A generic open drawer uses block layout, but open `.fillLeft`/`.fillRight` drawers need flex layout for their scrolling content. Overriding all open drawers to one display type breaks that distinction.

Use colors deliberately: `--SmartThemeEmColor` is emphasis text, not a guaranteed high-contrast control label; `--SmartThemeShadowColor` is a shadow color, not a text color. Do not lower opacity on an entire parent to make its background subtle, because that also fades text and focus indicators. Mix the background color with `transparent` instead.

If adding decorative motion, limit it to the requested selector, use a private keyframe name, and disable that motion for both `prefers-reduced-motion: reduce` and `body.layout-custom.reduced-motion`. Do not reset all application transitions. Keyframe steps are not DOM selectors, but every rule that applies their animation must be scoped to the custom body. The safest default is no new animation.

Reading a theme variable does not take ownership of it. Declaring a lockable variable on the active body (or root), or styling a recognized surface/property, disables its setting. Any layout lock also disables UI Theme preset controls, including imports that could replace Custom CSS. The Custom CSS editor remains available. Even spacing rules on a listed surface can lock its setting; do not bypass disabled states.

UI Theme imported settings with direct CSS variable locks:

| UI Theme Key | UI Control | CSS Lock Signal |
|---|---|---|
| `blur_strength` | Blur Strength | `--blurStrength`, `--SmartThemeBlurStrength` |
| `shadow_width` | Shadow Width | `--shadowWidth`, `text-shadow` declarations |
| `font_scale` | Desktop Font Scale | `--fontScale`, `--mainFontSize` |
| `mobile_font_scale` | Mobile Font Scale | `--fontScale`, `--mainFontSize` |
| `chat_text_line_height` | Message Line Height | `--chatTextLineHeightScale` |
| `chat_text_letter_spacing` | Message Text Spacing | `--chatTextLetterSpacing` |
| `top_bar_icon_scale` | Top Bar Icon Size | `--topBarIconScale`, `--topBarIconSize` |
| `top_bar_icon_spacing` | Top Bar Spacing | `--topBarIconSpacing` |
| `chat_width` | Chat Width | `--sheldWidth`; see width rules above |

Desktop and mobile font scales are saved independently and selected by the parsed device type, not viewport width. Mobile and tablet devices use `mobile_font_scale`; desktop devices use `font_scale`. Legacy settings and themes without `mobile_font_scale` inherit their existing `font_scale`.

UI Theme imported settings with selector/property locks:

| UI Theme Key | UI Control | CSS Lock Signal |
|---|---|---|
| `avatar_style` | Avatars | `.avatar`, `.mesAvatarWrapper`, `#user_avatar_block`, `body.big-avatars`, `body.square-avatars`, `body.rounded-avatars`, avatar size/radius variables |
| `chat_display` | Chat Style | `.mes`, `.mes_block`, `.mes_text`, `.ch_name`, `body.bubblechat`, `body.documentstyle`, message layout variables |
| `media_display` | Media Style | `.mes_media_wrapper`, `.mes_file_wrapper` |
| `toastr_position` | Notifications | `.toast`, `#toast-container`, `.toast-top-*`, `.toast-bottom-*` |
| `fast_ui_mode` | No Blur Effect | `body.no-blur`, `backdrop-filter`, blur variables |
| `noShadows` | No Text Shadows | `body.noShadows`, `text-shadow`, `--shadowWidth` |
| `waifuMode` | Visual Novel Mode | `body.waifuMode`, `#expression-wrapper`, `.expression-holder`, `.zoomed_avatar` |
| `timer_enabled` | Message Timer | `.mes_timer`, `body.no-timer` |
| `timestamps_enabled` | Chat Timestamps | `.timestamp`, `body.no-timestamps` |
| `timestamp_model_icon` | Model Icons | `.timestamp-icon`, `.icon-svg`, `body.no-modelIcons` |
| `mesIDDisplay_enabled` | Message IDs | `.mesIDDisplay`, `body.no-mesIDDisplay` |
| `hideChatAvatars_enabled` | Hide Chat Avatars | `body.hideChatAvatars`, `.mesAvatarWrapper` |
| `message_token_count_enabled` | Message Token Count | `.tokenCounterDisplay`, `body.no-tokenCount` |
| `expand_message_actions` | Expand Message Actions | `.mes_buttons`, `.extraMesButtons`, `body.expandMessageActions` |
| `compact_input_area` | Compact Input Area | `#send_form`, `#send_form.compact` |
| `show_swipe_num_all_messages` | Swipe # for All Messages | `.swipes-counter`, `body.swipeAllMessages` |
| `top_bar_icon_overrides` | Top Bar Icons | `.drawer-icon`, top-bar drawer IDs such as `#ai-config-button` and `#user-settings-button` |
| `hotswap_enabled` | Hotswap | `.hotswap`, `#favorites_carousel_wrapper`, `body.no-hotswap` |
| `click_to_edit` | Click to Edit | `.mes_text` |
| `enableZenSliders` | Zen Sliders | `body.enableZenSliders`, `.neo-range-slider`, `.neo-range-input`, generated `*_zenslider` controls |
| `enableLabMode` | Mad Lab Mode | `body.enableLabMode`, `#labModeWarning` |
| `bogus_folders` | Bogus Folders | `.bogus_folder_select`, `.bogus_folder_counter`, `.bogus_folder_back_placeholder` |
| `zoomed_avatar_magnification` | Avatar Hover Magnification | `.zoomed_avatar`, `.zoomed_avatar_container` |
| `reduced_motion` | Reduced Motion | `body.reduced-motion`, `animation`, `animation-duration`, `transition`, `transition-duration` |

### What the setting locks mean in practice

- Color/font declarations on the active body lock their corresponding pickers/font inputs. A normal `color: var(--SmartThemeBodyColor)` declaration reads a color and does not lock that picker.
- Declarations in nested media/support rules are inspected too. Do not depend on a mobile-only width declaration being ignored on desktop.
- Selector inspection is conservative: even a padding-only rule for `.mes_text` signals ownership of Chat Style and Click to Edit.
- A rule targeting `.mesAvatarWrapper` can lock both avatar presentation and Hide Chat Avatars. If that is not intended, prefer message padding adjustments.
- Property signals such as `text-shadow`, `backdrop-filter`, `animation`, and `transition` can lock related controls even in a narrowly scoped rule.
- The inactive body classes listed in the tables describe supported state names, not classes you should add or remove. CSS cannot toggle a setting, and forcing a conflicting visual state makes its UI misleading.
- A layout can remain selected while its theme preset controls are disabled. That is an ownership safeguard, not evidence that the layout failed to load.
- If a setting should remain user-controlled, remove the corresponding ownership declaration/selector. Do not style the setting itself to appear enabled.

The tables are sufficient for the documented authoring patterns. [power-user.js](../public/scripts/power-user.js) is an optional source reference for the implementation's exact detection patterns; no code from it belongs in an uploaded stylesheet.

## Images, fonts, and upload limits

Upload a static PNG, JPEG, or WebP through **User Settings → Layout** using the image upload button. The server stores the processed image as WebP. Use the returned `/api/layouts/assets/file/….webp` URL exactly, including its generated filename; the original uploaded filename is not the asset URL. Put image declarations on a scoped selector such as `body.layout-custom #sheld`.

Only use assets uploaded for that user. Remote images, protocol-relative URLs, data/base64 URLs, and `file://` URLs are blocked. If no asset URL is provided, omit the image declaration.

Prefer inherited fonts. If explicitly requested, Google Fonts stylesheet imports are permitted only from `https://fonts.googleapis.com/css` or `/css2`, written as `@import url("…");` before other rules. Other imports and arbitrary remote font URLs are not allowed. Keep font declarations scoped to the custom body.

| Upload | Limits |
|---|---|
| CSS | 5 MiB; 25 custom layouts; `.css` extension |
| Filename | At most 120 characters; ASCII letters, numbers, spaces, underscores, dots, hyphens; no paths or leading dot |
| Image source | Static PNG/JPEG/WebP; 10 MiB; dimensions at most 4096 × 4096 |
| Stored image | WebP; 2 MiB per processed image; 50 assets; 20 MiB total |

### Complete image declaration pattern

The following is a **template add-on**, not a finished asset reference. Replace `REPLACE-WITH-YOUR-UPLOADED-ASSET.webp` with the exact generated filename supplied by the Layout image uploader before using it. If you do not have an uploaded URL, omit this entire rule.

```css
body.layout-custom #sheld {
    background-color: var(--SmartThemeChatTintColor);
    background-image:
        linear-gradient(
            color-mix(in srgb, var(--SmartThemeChatTintColor) 88%, transparent),
            color-mix(in srgb, var(--SmartThemeChatTintColor) 88%, transparent)
        ),
        url("/api/layouts/assets/file/REPLACE-WITH-YOUR-UPLOADED-ASSET.webp");
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
}
```

The first background layer is a theme tint to maintain readable content. This styles the chat shell surface; it does not upload the image or change the app's background selection. Existing message and composer tints may cover parts of it. Do not remove all their backgrounds to expose artwork at the cost of readability.

For artwork in the empty area of a docked layout, the user can use the app's normal background picker without putting an asset URL in layout CSS. If explicitly asked to set a body background, target `body.layout-custom` and use a supplied layout-asset URL; be aware that the app's existing background layers can cover the body background. Do not rearrange or hide those layers as an assumed fix.

Use `background-position` to choose cropping: `cover` fills the surface and crops edges; `contain` preserves the whole image and may leave empty space. Avoid fixed pixel dimensions for the image surface. The stored filename normally differs from the source filename and new uploads are WebP, including uploads originally named `.png` or `.jpg`.

### Font choices without external files

The default is to inherit the selected theme. A self-contained system-font choice needs no download:

```css
body.layout-custom {
    --mainFontFamily: system-ui, sans-serif;
    --monoFontFamily: ui-monospace, monospace;
}
```

This deliberately owns the theme font inputs. Fonts installed on one person's machine are not necessarily installed on another; always provide a generic fallback.

If the user explicitly wants Google Fonts, use a stylesheet import in the permitted form. For example:

```css
@import url("https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600&display=swap");

body.layout-custom {
    --mainFontFamily: "Noto Sans", sans-serif;
}
```

This is an optional add-on: the import must be placed at the top of the final CSS file before style rules, and the body declaration can join its existing body rule. It depends on network access and font availability; the fallback font remains necessary. Do not replace it with a quoted-string `@import "…"`, attach extra import conditions, import arbitrary stylesheets, or add a direct remote `@font-face` URL. The uploader accepts the specific `url(...)` import form described above.

### What upload validation does and does not establish

The uploader parses the CSS and rejects malformed CSS, non-CSS/HTML markers, forbidden control characters, and disallowed URLs/imports. Put only CSS in the file, including its comments; copying HTML snippets or Markdown fences from this manual into the upload can fail validation.

Passing upload validation does not prove that selectors exist, that computed dimensions fit, that a CSS feature works on every browser, or that controls remain usable. Unknown variables and unsupported declarations may be ignored by browsers without an upload error. Use flat rules, the contract names in this manual, and the in-app checks below.

The filename is used to identify the custom layout. Use simple names such as `reading-layout.css`; spaces/underscores/hyphens may be normalized in the displayed name. Uploads are user assets, not a mechanism for referencing another account's assets or obtaining hidden lorebook data.

## Mobile and existing UI compatibility

At widths **up to and including 1000px**, shared structure forces the chat and major panels to viewport width and disables resizing. Keep the responsive reset so dependent variables also follow that geometry. Test short viewports and the on-screen keyboard as well as narrow widths. Existing iOS/PWA structural overrides can supersede custom geometry even on wide iPads; preserve them and safe-area behavior. Desktop WebKit testing does not establish native iOS Safari compatibility.

### Drawer lifecycle and mobile structure

There are two separate drawer patterns:

| Pattern | Closed state | Open state | Authoring boundary |
|---|---|---|---|
| Top/navigation drawer | `.drawer-content` is hidden and zero-height by default | `.openDrawer` is applied by the app; generic content scrolls, full-height panels use inner scrolling | Style dimensions and surfaces; do not override state/display |
| Inline settings drawer | `.inline-drawer` contains a toggle/header and `.inline-drawer-content` | Existing app code expands/collapses the content | Preserve toggle hit targets and disclosure state; do not force all content visible |

`.closedDrawer` is a JavaScript state marker and intentionally has no standalone visual rule. It is not mechanically interchangeable with every `:not(.openDrawer)` check. Leave it out of custom selectors.

At mobile widths, these shared rules take precedence over many desktop variables:

- `#top-bar` and `#top-settings-holder` become fixed and full width.
- `#sheld`, `#character_popup`, and drawers are constrained to the viewport; width and left-position overrides include existing `!important` rules.
- Major navigation/prompt panels become full-width surfaces. Inner scrolling remains necessary.
- Drag handles and resize affordances are hidden, and shell/drawer resizing is disabled.
- Visual Novel Mode has its own reduced-height, lower-screen chat placement.
- iOS/PWA preservation rules may also apply at larger widths; they retain viewport and safe-area calculations that a custom layout must not cancel.

Consequently, a desktop two-column design becomes an ordinary full-width mobile chat with panels opening over it. Do not try to keep 450px columns side by side on a phone. Media queries must also reset any **direct** positioning rules you add; resetting variables cannot undo a separate `right: 24px` rule on a panel.

### Accessibility and content resilience

Preserve the application's visible focus treatment. Never use a broad `outline: none` or `pointer-events: none` rule on interactive UI. Do not make actions appear only on hover, because touch and keyboard users need to reach them. A decorative pseudo-element must not cover hit targets or replace the accessible name of a control.

Do not add labels or instructions with CSS `content`; layout files do not have a localization lifecycle for those strings. Keep existing localized text, titles, and accessible labels. Test longer labels and non-Latin text, including names and multiline messages.

Use spacing and reasonable maximum widths to improve density. Do not solve overflow by hiding entire panels, messages, attached files, edit buttons, or the composer. Avoid disabling page zoom or text selection. Preserve native disclosure semantics and the app's disabled/hidden states.

The key long-chat invariant is one usable chat scroll region with a reachable composer. Do not use `height: auto` on the shell as a way to fit the conversation into the document, or set overflow hidden on the message list. Large histories should remain inside the existing scrolling model.

Core feature styling belongs to the smart theme in `public/style.css`. Custom layouts should normally leave these surfaces inherited; targeted spacing changes must preserve:

| Surface | Required behavior |
|---|---|
| Recommended Chat Setup | Readable searchable `#recommended_chat_setup_lorebook` and `#recommended_chat_setup_side_prompts` inside `#recommended_chat_setup_configuration`; disabled controls; full-width `#recommended_chat_setup_button` above Creator's Notes; mobile editor flow |
| Memory Books main popup and Active Cast | Separate preferences/automatic-memory sub-popups; group binding grids and cast manager stack below 600px; movable cast drawer stays viewport-limited with its existing collapse state |
| Memory Books regeneration | `.stmb-regenerate-entry` remains hidden unless the renderer makes it eligible; `.stmb-regeneration-columns` shows original/replacement side by side and stacks below 600px; `.stmb-regeneration-content` scrolls/resizes within the popup; disabled actions stay disabled |
| Memory Books wand and connections | Existing `#stmb-menu-item` in `#memory_books_wand_container` keeps `.list-group-item` focus/interaction; connection selectors and model/temperature overrides remain readable and keyboard accessible |
| Memory Books lists and guidance | `.stmb-topical-source-selector` scrolls with readable `.stmb-topical-source-select-label` checkbox rows; `.stmb-group-participants-list` stays within half the viewport height; `.stmb-setting-focus-highlight` remains visible |
| Memory boundary and floating triggers | `.stmb_memory_boundary_divider` and `.stmb_memory_boundary_button` stay offset above message text; draggable boundary button and `.wi-floating-book-trigger` retain `touch-action: none` |
| Memory Books help | `.stmb-help-drawer` retains native disclosure; `.stmb-help-drawer-content` keeps accessible copy/download/tree links and stacks below 600px |
| World Info preset/lock bar | `.world-info-locks-bar` retains hover/focus visibility, selector width, wrapping `.menu_button` actions, and selector-above-actions stacking below 600px |
| Floating World Info source icons | `.wi-floating-book-group-source` stays readable beside its lorebook name on one line with existing priority colors, localized tooltip, and accessible label; do not force absent icons visible |
| Patron chat tabs | `#top_chat_bar_tabs` stays in the existing Top Chat Bar; `#top_chat_bar_tabs_list` retains horizontal scrolling without a visible scrollbar; compact `.top_chat_tab` avatars, close buttons, full accessible labels/titles, and `.top_chat_tab_status` remain usable; preserve spinner/success/error and standard-user locked states |
| Notification history | `#toast-history-trigger` keeps native `hidden` state until populated, counts and accessible summary; `.toast-history-list` and `.toast-history-suppressions` retain severity borders, readable text/timestamps, and suppression controls |

CSS must not replace runtime behavior such as tab switching, generation admission, close confirmations, or popup actions. Do not put message content, notification history, or secure lorebook data into layout state or generated styles.

## Troubleshooting and recovery

Use this order: confirm which layout is active, remove unintended overrides, check variable dependencies, then inspect direct selector rules. Make one small change at a time.

| Symptom | Likely explanation | First correction |
|---|---|---|
| Upload rejects the file | Markdown fences/HTML were copied, CSS is malformed, filename/size is invalid, or an import/URL is forbidden | Save plain CSS; check the reported validation error and the limits above |
| Layout uploads but looks unchanged | Wrong layout selected, mismatched body selector, or an unknown variable/selector | Select the uploaded entry and use `body.layout-custom`; compare names with this manual |
| Chat width changes but top bar/drawers do not | Dependent widths still resolve on the root | Redeclare top-bar/drawer widths and offsets with the chat inputs on the body |
| Font changes but bar/composer sizes do not | Missing font-to-icon-to-height dependencies | Use the complete typography block, including offsets and max-height values |
| Chat Width is disabled unexpectedly | A layout-owned width, an indirect alias, a nested width declaration without slider reference, or Moving UI inline width | Inspect all width declarations; keep the direct slider reference or reset movable panels as appropriate |
| Theme preset selection becomes disabled | CSS owns a recognized color/font/control surface | Remove only unintended ownership; expected layout locks should remain |
| CSS says one width but a dragged panel keeps another | Saved inline Moving UI geometry wins | Use the existing movable-panel reset, then recheck; do not fight inline styles with blanket importance |
| Side panels become tiny on a wide chat | Root “remaining space divided by two” formulas leave little space | Use the starter's explicit panel widths or workspace recipe |
| A drawer is permanently visible or never opens | Broad display/visibility/height rules conflict with state | Remove those overrides; leave `.closedDrawer` untouched |
| A navigation drawer opens but cannot scroll | Its flex or inner scrolling arrangement was replaced | Restore the shared display model and `.scrollableInner` scrolling |
| Mobile layout retains desktop offsets | Direct panel positioning was not reset, or an old rule still wins | Reset direct rules inside the mobile query as in recipe C |
| Composer or bottom messages are clipped | Fixed heights, missing `min-height: 0`, stale height dependencies, or overwritten overflow | Restore the shared shell/chat behavior and full dependent height expressions |
| Image is blank | Wrong generated name, original extension used, asset missing, or a foreground surface covers it | Use the actual returned asset URL and inspect which surface is being styled |
| Image is cropped | `background-size: cover` fills the surface | Adjust position or choose `contain` if full-image visibility matters |
| Custom font does not load | Import form is invalid, URL not permitted, network blocked, or family name mismatched | Use a system fallback and the documented import syntax |
| Styles remain after switching layouts | Rules were unscoped or also added to the general Custom CSS editor | Scope each selector separately and check that later override layer |
| Layout works on desktop but differs on iPad/iOS | Existing platform/mobile preservation rules override geometry | Preserve those rules; state the limit instead of adding a browser-specific hack |
| Editing or swiping breaks after cosmetic changes | Message action space, edit surfaces, or state rules were hidden/clipped | Remove message structural overrides and start from padding-only changes |
| A requested new pane/button has no behavior | CSS cannot create an application feature | Explain that it requires application code; keep the layout within the existing interface |

For visual problems, switch back to **Classic** from the Layout dropdown to stop applying the custom file. Reset movable panels if saved geometry still affects the screen. Preserve your original CSS locally before editing or re-uploading it. Do not clear browser storage, delete chats, remove messages, or reset application data to repair a stylesheet.

If a layout hides the controls needed to switch away, a user comfortable with browser developer tools can temporarily disable the stylesheet element with ID `aiko-layout-css`, then use the normal Layout selector. This is a temporary browser presentation change, not a reason to edit stored chats or server data.

When reporting a problem, include the CSS file, viewport dimensions, selected layout/theme, whether Moving UI is enabled, and the affected control. A screenshot may help if it contains no sensitive chat or lorebook content. Never include secure lorebook data or chat contents in an example intended to debug layout geometry.

## Validation and repository maintenance

### Acceptance checks for a generated file

A file is ready to share when it is complete (no ellipses or unresolved placeholders), all selectors are scoped, its asset URLs are supplied/allowed, its dependencies resolve where inputs are overridden, and the required actions are still usable.

Use the following minimum scenarios when a running Aikobots instance is available:

| Scenario | What to check |
|---|---|
| 1440 × 900 desktop | Expected chat/bar/drawer alignment, appropriate panel widths, and no overlap that prevents using controls |
| 1024 × 768 desktop | The narrowest desktop layout still fits; workspace widths remain positive |
| 1000 × 800 boundary | Full-width mobile structure engages at exactly 1000px |
| 390 × 844 phone | No horizontal page overflow; panels, composer, and long translated labels fit |
| 320 × 568 narrow phone | Text wraps, buttons remain reachable, and no hard minimum forces overflow |
| Short/landscape viewport | Chat can scroll and composer/stop actions remain accessible |
| Light and dark themes | Text, surfaces, borders, focus, disabled controls, and images remain legible |
| Long content | Long conversation, long message, code block, reasoning, attachment, and edit mode each remain usable |
| State changes | Open/close panels, begin/stop generation, switch layouts, drag/reset panels, and change available theme settings |

Before calling a generated layout finished:

- Upload and select it; switch to a built-in layout and back to check scoping. Test light and dark themes and inspect expected setting locks.
- Check desktop above 1000px and mobile at/below 1000px, including a narrow phone and short viewport. Verify no horizontal page overflow or text/button overlap.
- Open/close left, right, and background drawers; scroll long panels and chat history; check popups and top-bar hit targets.
- Send and edit a message; check action buttons, swipes, reasoning disclosure, long text, code, media, and attachments. Verify the composer stays reachable with the keyboard open.
- Check keyboard focus, disabled/hidden states, theme display modes, and reduced motion. If Moving UI is used, resize panels and verify the existing reset restores layout geometry.
- Check Firefox, Chrome, and Safari; test native iOS Safari separately when targeting iOS. Report untested environments rather than claiming support from CSS inspection alone.

### Testing claims and maintainers

The five complete recipes in this manual were checked in Chromium using the application's styles and a minimal representative DOM at widths of 1440px, 1024px, and 390px. Those checks covered computed chat widths, top-bar/drawer alignment, viewport bounds, and compact font/composer order. All 17 CSS blocks were also parsed with the uploader's CSS parser, and their variable references were checked against the documented defaults or declarations in the example. These are focused example checks, not full application interaction or Firefox/Safari/iOS validation.

If you only generated the file from this manual, say “generated and checked against the guide,” not “tested in Aikobots.” Syntax validation alone does not cover CSS computation, uploaded asset availability, mobile keyboard behavior, or application actions. Record which browsers/devices were actually checked.

The following repository commands are for maintainers with a checkout; they are not requirements for a user uploading a layout. This manual contains the authoring contract and complete examples, so a standalone reader does not need to run them.

For repository changes, reuse the smart-theme section of `public/style.css` for core UI CSS and update this guide. Built-in geometry belongs in the existing preset files. After code changes run `npm run build:frontend`; production serves committed `public/dist` bundles and server/PM2 startup does not build them. CI/release verification uses `npm run check:frontend-build`. Uploading custom CSS and editing documentation do not require rebuilding the app.

Run `npm run test:frontend:smoke -- --layouts` for the focused layout browser matrix; the full frontend smoke includes it. Set `FRONTEND_SMOKE_BROWSER` to `chromium`, `firefox`, or `webkit` for an installed Playwright browser. The native resize-grip check probes a plain CSS box and skips when that browser port cannot automate native grips.
