# Aikobots CSS layout style guide

Use this guide as the reference for an AI assistant generating a custom Aikobots layout. A layout is one uploaded CSS file that arranges the existing chat interface through variables and narrowly scoped overrides. The built-in layouts perform the same job and are the starting point for variations. Layouts do not replace HTML or add JavaScript.

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

Built-in files live in [public/css/layouts](../public/css/layouts). Compare the nearest preset before writing a variation.

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
├─ .mes_block
│  ├─ .ch_name
│  │  ├─ .name_text
│  │  ├─ .timestamp
│  │  └─ .mes_buttons
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

Also preserve `.swipe_left`, expanded `.extraMesButtons`, and edit-mode controls. Keep `.mes_text` and `.mes_reasoning` wrapping long text; preserve horizontal scrolling inside code blocks.

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

For smaller fonts/icons, copy the dependency declarations from [compact.css](../public/css/layouts/compact.css) into the custom body rule. Changing only `--fontScale` or `--topBarIconScale` is insufficient. The chain is `--fontScale` → `--mainFontSize` → `--bottomFormIconSize` / `--topBarIconSize` / `--topBarBlockPadding` → `--bottomFormBlockSize` / `--topBarBlockSize` → chat, drawer, and panel offsets/heights. `--bottomFormBlockPadding` also feeds composer size. Redeclare all affected expressions together; do not copy the built-in body selector into a custom upload.

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

The tables summarize detection; [power-user.js](../public/scripts/power-user.js) owns the exact patterns.

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

## Mobile and existing UI compatibility

At widths **up to and including 1000px**, shared structure forces the chat and major panels to viewport width and disables resizing. Keep the responsive reset so dependent variables also follow that geometry. Test short viewports and the on-screen keyboard as well as narrow widths. Existing iOS/PWA structural overrides can supersede custom geometry even on wide iPads; preserve them and safe-area behavior. Desktop WebKit testing does not establish native iOS Safari compatibility.

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

## Validation and repository maintenance

Before calling a generated layout finished:

- Upload and select it; switch to a built-in layout and back to check scoping. Test light and dark themes and inspect expected setting locks.
- Check desktop above 1000px and mobile at/below 1000px, including a narrow phone and short viewport. Verify no horizontal page overflow or text/button overlap.
- Open/close left, right, and background drawers; scroll long panels and chat history; check popups and top-bar hit targets.
- Send and edit a message; check action buttons, swipes, reasoning disclosure, long text, code, media, and attachments. Verify the composer stays reachable with the keyboard open.
- Check keyboard focus, disabled/hidden states, theme display modes, and reduced motion. If Moving UI is used, resize panels and verify the existing reset restores layout geometry.
- Check Firefox, Chrome, and Safari; test native iOS Safari separately when targeting iOS. Report untested environments rather than claiming support from CSS inspection alone.

For repository changes, reuse the smart-theme section of `public/style.css` for core UI CSS and update this guide. Built-in geometry belongs in the existing preset files. After code changes run `npm run build:frontend`; production serves committed `public/dist` bundles and server/PM2 startup does not build them. CI/release verification uses `npm run check:frontend-build`. Uploading custom CSS and editing documentation do not require rebuilding the app.

Run `npm run test:frontend:smoke -- --layouts` for the focused layout browser matrix; the full frontend smoke includes it. Set `FRONTEND_SMOKE_BROWSER` to `chromium`, `firefox`, or `webkit` for an installed Playwright browser. The native resize-grip check probes a plain CSS box and skips when that browser port cannot automate native grips.
