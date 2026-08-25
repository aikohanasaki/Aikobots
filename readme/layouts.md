# Aikobots Layout Template Guide

Aikobots layouts are CSS-only templates. A layout does **not** replace the chat HTML. Instead, it changes CSS variables and selected classes that the app already provides.

Memory Books keeps its primary popup focused on scene, lorebook, profile, and prompt-manager actions. General preferences and automatic-memory controls open as separate sub-popups. Per-member group lorebook bindings use a responsive grid that collapses to one column below 600px and inherits the active smart-theme control colors. Narrator Mode adds a movable Active Cast drawer using SmartTheme colors; its expanded width is viewport-limited, its cast manager collapses to one column below 600px, and its normalized position and collapse state are saved in STMB settings.

## 1. Where Layouts Live

Built-in layout CSS files are here:

```text
public/css/layouts/
```

Important files:

```text
layout-contract.css    # default layout variables
layout-structure.css   # shared structural rules used by every layout
classic.css            # default layout
wide.css
compact.css
left-dock.css
workspace-right.css
compact-ops.css
top-composer.css
```

Custom user layouts are uploaded from:

```text
User Settings -> Layout -> Upload layout CSS
```

The uploaded CSS becomes selectable in the same layout dropdown.

## 2. How A Layout Is Applied

The page always loads layout CSS in this order:

```html
<link rel="stylesheet" href="css/layouts/layout-contract.css">
<link rel="stylesheet" href="css/layouts/layout-structure.css">
<link id="aiko-layout-css" rel="stylesheet" href="selected-layout.css">
<link rel="stylesheet" href="css/user.css">
```

That means:

1. `layout-contract.css` defines default variables.
2. `layout-structure.css` applies those variables to the app.
3. The selected layout overrides the defaults.
4. `user.css` can override everything after that.

The active layout is also marked on `<body>`.

Example:

```html
<body data-aiko-layout="classic" class="layout-classic no-blur">
```

For custom uploaded layouts, the body class is:

```css
body.layout-custom
```

Use that for custom CSS.

## 3. Built-In Layout Names

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

## 4. Main Page Structure

These are the main layout targets.

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

## 5. Message Structure

Each chat message uses this general structure:

```html
<div class="mes">
    <div class="mesAvatarWrapper">
        <div class="avatar">
            <img>
        </div>
        <div class="mesIDDisplay"></div>
        <div class="mes_timer"></div>
        <div class="tokenCounterDisplay"></div>
    </div>

    <div class="mes_block">
        <div class="ch_name">
            <span class="name_text"></span>
            <small class="timestamp"></small>
            <div class="mes_buttons"></div>
        </div>

        <details class="mes_reasoning_details">
            <summary class="mes_reasoning_summary"></summary>
            <div class="mes_reasoning"></div>
        </details>

        <div class="mes_text"></div>
        <div class="mes_media_wrapper"></div>
        <div class="mes_file_wrapper"></div>
        <div class="mes_bias"></div>
    </div>

    <div class="swipeRightBlock">
        <div class="swipe_right"></div>
        <div class="swipes-counter"></div>
    </div>
</div>
```

Useful message selectors:

| Selector | Meaning |
|---|---|
| `.mes` | Entire message row |
| `.mesAvatarWrapper` | Avatar/timer/token column |
| `.avatar` | Avatar box |
| `.mes_block` | Message content column |
| `.ch_name` | Message header row |
| `.name_text` | Character/user name |
| `.timestamp` | Message timestamp |
| `.mes_buttons` | Message action buttons |
| `.mes_reasoning_details` | Collapsible reasoning block |
| `.mes_reasoning` | Reasoning text |
| `.mes_text` | Main rendered message text |
| `.mes_media_wrapper` | Embedded media area |
| `.mes_file_wrapper` | Attached files area |
| `.swipe_left` | Left swipe control |
| `.swipeRightBlock` | Right swipe control wrapper |
| `.swipe_right` | Right swipe button |
| `.swipes-counter` | Swipe count display |

## 6. Layout Variables

Prefer changing variables over hardcoding rules.

### Chat Area

```css
--aiko-layout-chat-width
--aiko-layout-chat-top
--aiko-layout-chat-height
--aiko-layout-chat-height-fallback
--aiko-layout-chat-max-height
--aiko-layout-chat-scroll-max-height
--aiko-layout-chat-scroll-max-height-fallback
--aiko-layout-chat-left
--aiko-layout-chat-right
--aiko-layout-chat-margin-inline
```

### Top Bar

```css
--aiko-layout-topbar-width
--aiko-layout-topbar-left
--aiko-layout-topbar-right
--aiko-layout-topbar-margin-inline
```

### Side Panels

```css
--aiko-layout-left-panel-width
--aiko-layout-left-panel-width-fallback
--aiko-layout-right-panel-width
--aiko-layout-right-panel-width-fallback
```

### Drawers

```css
--aiko-layout-drawer-width
--aiko-layout-drawer-min-width
--aiko-layout-drawer-top
--aiko-layout-drawer-left
--aiko-layout-drawer-right
--aiko-layout-drawer-margin-inline
--aiko-layout-drawer-max-height
--aiko-layout-drawer-max-height-fallback
```

### Floating Panels

```css
--aiko-layout-floating-panel-width
--aiko-layout-floating-panel-width-fallback
--aiko-layout-panel-max-height
--aiko-layout-panel-max-height-fallback
```

### Messages

```css
--aiko-layout-message-max-width
--aiko-layout-message-margin-inline
--aiko-layout-message-padding-block-start
--aiko-layout-message-padding-inline
```

### Composer Order

```css
--aiko-layout-composer-order
--aiko-layout-chat-order
```

These control whether the composer appears above or below the chat.

### UI Theme and SmartTheme Variables

Layouts can also use the SmartTheme CSS variables from the Theme UI. These are defined on `:root`, then updated when the user changes or loads a theme.

The UI Theme preset selector imports and exports saved theme values for colors, display controls, message presentation, and several look-and-feel toggles. If a layout declares a lockable theme variable on `:root` or the active `<body>` selector, or contains rules for one of the lockable UI surfaces listed below, the matching UI control is disabled while that layout is active. The UI Theme preset controls are also disabled so importing or selecting a preset cannot overwrite values the active layout CSS is intentionally controlling.

Theme color variables:

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

Related derived variables:

```css
--SmartThemeBlurStrength
--SmartThemeCheckboxBgColorR
--SmartThemeCheckboxBgColorG
--SmartThemeCheckboxBgColorB
--SmartThemeCheckboxBgColorA
--SmartThemeCheckboxTickColorValue
--SmartThemeCheckboxTickColor
```

`--SmartThemeBlurStrength` is derived from the Blur Strength UI slider. The checkbox variables are derived from `--SmartThemeBodyColor` and are used by checkbox styling.

Theme font variables:

| UI Control | CSS Variable | Typical Use |
|---|---|---|
| Main Font | `--mainFontFamily` | Main app text, menus, inputs, chat text |
| Mono Font | `--monoFontFamily` | Code, monospace fields, token-style text |

If a layout declares one of the theme color variables on `:root` or the active `<body>` selector, the matching Theme color picker is disabled while that layout is active. If a layout declares one of the theme font variables on `:root` or the active `<body>` selector, the matching Theme Fonts input is disabled while that layout is active. Hovering a disabled control shows that it is controlled by the active layout CSS.

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
| `chat_width` | Chat Width | `--sheldWidth` |

Desktop and mobile font scales are saved independently and selected by the parsed device type, not viewport width. Mobile and tablet devices use `mobile_font_scale`; desktop devices use `font_scale`. Legacy settings and themes without `mobile_font_scale` inherit their existing `font_scale`.

UI Theme imported settings with selector/property locks:

| UI Theme Key | UI Control | CSS Lock Signal |
|---|---|---|
| `avatar_style` | Avatars | `.avatar`, `.mesAvatarWrapper`, `#user_avatar_block`, `body.big-avatars`, `body.square-avatars`, `body.rounded-avatars`, avatar size/radius variables |
| `chat_display` | Chat Style | `.mes`, `.mes_block`, `.mes_text`, `.ch_name`, `body.bubblechat`, `body.documentstyle`, message layout variables |
| `media_display` | Media Style | `.mes_media_wrapper`, `.mes_file_wrapper` |
| `toastr_position` | Notifications | `.toast`, `#toast-container`, `.toast-top-*`, `.toast-bottom-*` |
| `fast_ui_mode` | No Blur Effect | `body.no-blur`, `backdrop-filter`, `-webkit-backdrop-filter`, blur variables |
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

UI Theme also imports and exports `custom_css`. Layout CSS does not lock the Custom CSS editor directly; instead, any lock signal above disables the UI Theme preset controls so a theme import cannot replace layout-owned values while the layout is active.

Use SmartTheme variables when a layout needs to match the active theme:

```css
body.layout-custom #sheld {
    background-color: color-mix(in srgb, var(--SmartThemeChatTintColor) 92%, transparent);
    border: 1px solid var(--SmartThemeBorderColor);
    box-shadow: 0 8px 24px color-mix(in srgb, var(--SmartThemeShadowColor) 45%, transparent);
}

body.layout-custom .mes {
    color: var(--SmartThemeBodyColor);
}
```

Avoid hardcoding colors in reusable layouts unless the color is intentionally independent of the user's active theme.

STMB popup surfaces in `public/style.css` also use SmartTheme variables for borders and text-adjacent UI. The Topical Clip source memory selector uses `.stmb-topical-source-selector` for the scrollable bordered list and `.stmb-topical-source-select-label` for checkbox rows. The processed-memory boundary uses `.stmb_memory_boundary_divider` and `.stmb_memory_boundary_button`; the divider is intentionally offset slightly above the target message with reduced opacity so it does not obscure message text. Draggable floating controls such as `.stmb_memory_boundary_button` and `.wi-floating-book-trigger` use `touch-action: none` so touch gestures move the control instead of initiating viewport panning.

## 7. Minimal Custom Layout Template

Create a file like:

```text
my-layout.css
```

Example:

```css
body.layout-custom {
    --aiko-layout-chat-width: min(860px, 92dvw);
    --aiko-layout-chat-left: 24px;
    --aiko-layout-chat-right: auto;
    --aiko-layout-chat-margin-inline: 0;

    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: 24px;
    --aiko-layout-topbar-right: auto;
    --aiko-layout-topbar-margin-inline: 0;

    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-left: 24px;
    --aiko-layout-drawer-right: auto;
    --aiko-layout-drawer-margin-inline: 0;

    --aiko-layout-message-padding-block-start: 6px;
    --aiko-layout-message-padding-inline: 8px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

body.layout-custom .mes_text {
    line-height: 1.45;
}
```

Upload it from:

```text
User Settings -> Layout -> Upload layout CSS
```

Then select it from the Layout dropdown.

## 8. Example: Centered Narrow Chat

```css
body.layout-custom {
    --aiko-layout-chat-width: min(760px, 94dvw);
    --aiko-layout-chat-left: 0;
    --aiko-layout-chat-right: 0;
    --aiko-layout-chat-margin-inline: auto;

    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: 0;
    --aiko-layout-topbar-right: 0;
    --aiko-layout-topbar-margin-inline: auto;

    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-left: 0;
    --aiko-layout-drawer-right: 0;
    --aiko-layout-drawer-margin-inline: auto;
}
```

## 9. Example: Left-Docked Chat

```css
body.layout-custom {
    --my-layout-gap: 24px;

    --aiko-layout-chat-width: min(720px, 48dvw);
    --aiko-layout-chat-left: var(--my-layout-gap);
    --aiko-layout-chat-right: auto;
    --aiko-layout-chat-margin-inline: 0;

    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: var(--my-layout-gap);
    --aiko-layout-topbar-right: auto;
    --aiko-layout-topbar-margin-inline: 0;

    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-left: var(--my-layout-gap);
    --aiko-layout-drawer-right: auto;
    --aiko-layout-drawer-margin-inline: 0;
}
```

## 10. Example: Top Composer

```css
body.layout-custom {
    --aiko-layout-composer-order: 1;
    --aiko-layout-chat-order: 2;
}

body.layout-custom #form_sheld {
    margin-top: 0;
    margin-bottom: 1px;
}

body.layout-custom #send_form {
    border-radius: 0;
}
```

## 11. Example: Compact Messages

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
}

body.layout-custom .mes_block {
    padding-left: 6px;
}

body.layout-custom #send_textarea {
    padding: 3px 5px;
}
```

## 12. Custom Images

Custom layout CSS cannot reference arbitrary remote images.

Allowed image workflow:

1. Go to `User Settings -> Layout`.
2. Click the image upload button.
3. Upload a static PNG, JPEG, or WebP.
4. The server converts it to WebP.
5. Use the generated `.webp` URL in your CSS.

Important: even if you upload a `.png`, `.jpg`, or `.jpeg`, Aikobots stores the processed layout image as `.webp`. Link the generated WebP URL, not the original filename or extension.

Allowed URL shape:

```css
body.layout-custom #sheld {
    background-image: url("/api/layouts/assets/file/example.webp");
}
```

Remote image URLs are blocked.

Not allowed:

```css
background-image: url("https://example.com/image.png");
background-image: url("data:image/png;base64,...");
background-image: url("file:///...");
```

## 13. Upload Limits

Custom layout CSS:

```text
Max size: 5 MB
Max custom layouts: 25
Allowed extension: .css
Filename length: 120 characters max
Allowed filename characters: letters, numbers, spaces, underscore, dot, hyphen
```

Layout images:

```text
Accepted uploads: static PNG, JPEG, WebP
Stored format: WebP
Max source image size: 10 MB
Max processed image size: 2 MB
Max image dimension: 4096 x 4096
Max image assets: 50
Total image asset storage: 20 MB
```

## 14. Important Safety Rules

Do not style `.closedDrawer`.

Use this:

```css
.drawer-content.openDrawer {
    /* visible drawer state */
}
```

Avoid this:

```css
.closedDrawer {
    display: none;
}
```

Reason: `.closedDrawer` is mainly a JavaScript state marker. The actual visible state is `.openDrawer`.

## 15. Mobile Behavior

At screen widths under `1000px`, layout CSS is heavily overridden.

On mobile:

```css
#top-bar
#top-settings-holder
#sheld
.drawer-content
#left-nav-panel
#right-nav-panel
#floatingPrompt
#cfgConfig
```

are generally forced to full viewport width.

So if you make a desktop layout, also include a mobile reset:

```css
@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: 100dvw;
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;

        --aiko-layout-topbar-width: 100dvw;
        --aiko-layout-topbar-left: 0;
        --aiko-layout-topbar-right: 0;
        --aiko-layout-topbar-margin-inline: auto;

        --aiko-layout-drawer-width: 100dvw;
        --aiko-layout-drawer-left: 0;
        --aiko-layout-drawer-right: 0;
        --aiko-layout-drawer-margin-inline: auto;
    }
}
```

## 16. Recommended Authoring Rules

Use this pattern:

```css
body.layout-custom {
    /* variables first */
}

body.layout-custom .specific-selector {
    /* small targeted overrides second */
}
```

Prefer:

```css
--aiko-layout-chat-width: min(900px, 94dvw);
```

over:

```css
#sheld {
    width: 900px !important;
}
```

Avoid broad overrides like:

```css
* {
    box-sizing: border-box;
}
```

or:

```css
div {
    position: relative;
}
```

These can break drawers, popups, menus, and chat controls.

## 17. Testing Checklist

After uploading a layout, check:

- Chat loads normally.
- Top bar icons are clickable.
- Left drawer opens.
- Right drawer opens.
- Background drawer opens.
- Message buttons are visible.
- Edit message mode still works.
- Reasoning blocks still expand/collapse.
- Swipe buttons still work.
- Composer can send messages.
- Long messages wrap correctly.
- Mobile width does not overflow.
- Drawers are usable on mobile.
- No text overlaps buttons.
- No panel is permanently stuck open or closed.

## 18. Good Starter File

```css
body.layout-custom {
    --aiko-layout-chat-width: min(840px, 92dvw);
    --aiko-layout-chat-left: 0;
    --aiko-layout-chat-right: 0;
    --aiko-layout-chat-margin-inline: auto;

    --aiko-layout-topbar-width: var(--aiko-layout-chat-width);
    --aiko-layout-topbar-left: 0;
    --aiko-layout-topbar-right: 0;
    --aiko-layout-topbar-margin-inline: auto;

    --aiko-layout-drawer-width: var(--aiko-layout-chat-width);
    --aiko-layout-drawer-left: 0;
    --aiko-layout-drawer-right: 0;
    --aiko-layout-drawer-margin-inline: auto;

    --aiko-layout-message-padding-block-start: 8px;
    --aiko-layout-message-padding-inline: 10px;
}

body.layout-custom .mes_block {
    padding-left: 8px;
}

body.layout-custom .mes_text {
    line-height: 1.45;
}

@media screen and (max-width: 1000px) {
    body.layout-custom {
        --aiko-layout-chat-width: 100dvw;
        --aiko-layout-chat-left: 0;
        --aiko-layout-chat-right: 0;
        --aiko-layout-chat-margin-inline: auto;

        --aiko-layout-topbar-width: 100dvw;
        --aiko-layout-topbar-left: 0;
        --aiko-layout-topbar-right: 0;
        --aiko-layout-topbar-margin-inline: auto;

        --aiko-layout-drawer-width: 100dvw;
        --aiko-layout-drawer-left: 0;
        --aiko-layout-drawer-right: 0;
        --aiko-layout-drawer-margin-inline: auto;
    }
}
```

## 19. Recommended Chat Setup controls

The character Advanced Definitions panel contains the searchable `#recommended_chat_setup_lorebook` and `#recommended_chat_setup_side_prompts` selects inside `#recommended_chat_setup_configuration`. The lorebook select contains only eligible ordinary `LTM` template drafts for the current character. Changes save immediately; the designated lorebook remains editable in the lorebook editor but its rename, delete, storage, activation, binding, and STMB controls are unavailable until another source or `None` is selected. The consumer-facing `#recommended_chat_setup_button` sits directly above the Creator's Notes drawer and uses the same available width.

Core styling for these controls belongs to the smart theme in `public/style.css`. Layouts may adjust spacing, but should preserve the full-width button, readable Select2 inputs, the disabled state, and the existing mobile character-editor flow. The setup confirmation and result views use the standard popup and smart-theme button classes rather than layout-specific colors.

## 20. Memory Books regeneration controls

The core lorebook-entry template contains a hidden `.stmb-regenerate-entry` next to the UID. The row renderer surfaces it only for eligible managed entries in ordinary-user lorebooks. Regeneration always opens `.stmb-regeneration-review`, whose `.stmb-regeneration-columns` present the original and editable replacement side by side on wider screens and as one column below 600px.

Core colors, borders, button states, warning treatment, and responsive behavior live in `public/style.css` and use smart-theme variables. Layouts may change spacing but should keep both review states readable, preserve the disabled button state, and allow `.stmb-regeneration-content` to scroll or resize without overflowing the popup.

## 21. Memory Books wand entry and connection controls

The core `public/scripts/templates/wandMenu.html` template owns `#stmb-menu-item` inside `#memory_books_wand_container`; Memory Books binds that existing DOM node and does not inject or poll for an extension-style menu entry. Layouts may adjust spacing through existing wand-menu rules but should preserve the entry's standard `.list-group-item` interaction and focus behavior.

Memory Books profile and Advanced-run dialogs use the shared popup controls and smart-theme colors. A profile selects a central SillyTavern connection profile while keeping optional model and temperature overrides. Advanced runs expose the same two overrides for that run. Layouts may adjust spacing only; the connection selector and both override inputs must remain readable and keyboard accessible.

## 22. Memory Books group and regeneration guidance

The group participant chooser keeps `.stmb-group-participants-list` within half the viewport height and scrolls long member lists. The regeneration visibility warning can open General Settings, scroll to the hidden-message checkbox, and temporarily highlight its enclosing label with `.stmb-setting-focus-highlight`. Layouts may adjust spacing but should preserve both the scroll region and visible keyboard focus.

## 23. Memory Books help drawer

The main Memory Books popup places `.stmb-help-drawer` below its title. Its `.stmb-help-drawer-content` row keeps the AI Reference Manual copy beside the native-language GitHub download on wider screens, includes a full-language-tree link, and stacks below 600px. The drawer inherits smart-theme surfaces, borders, and buttons from `public/style.css`; layouts may adjust spacing but should preserve the native disclosure control and readable keyboard-accessible links.

## 24. World Info preset and lock bar

The World Info drawer header owns the core `.world-info-locks-bar`, its preset selector, and its standard `.menu_button` actions. The bar uses smart-theme text, border, and UI-background colors from `public/style.css`, fades in on hover or keyboard focus, wraps its actions as space narrows, and stacks the selector above the actions below 600px. Layouts may adjust spacing but should preserve the selector's available width, visible keyboard focus, accessible button labels, and mobile stacking behavior.

## 25. Patron chat tabs

`#top_chat_bar_tabs_toggle` switches the existing Top Chat Bar into the patron workspace. The workspace keeps `#top_chat_bar_tabs` mounted in the same bar and scrolls `#top_chat_bar_tabs_list` horizontally. `#top_chat_bar_tabs_add` waits for the current generation's durable server admission, parks its delivery, and returns to the ordinary navigation controls so another character, group, or chat can be opened and automatically added. This readiness handoff is event-driven and has no fixed preparation timeout. The workspace does not mount another chat runtime: selecting a tab parks any detached stream delivery, discards its unsaved browser placeholder, and loads the selected authoritative chat directly through the owner-checked Manage Chats path without first loading that owner's previous chat.

Each compact `.top_chat_tab` contains the character or group avatar, an accessible `.top_chat_tab_status`, and a close button. Its native hover title and accessible tab name contain the full `Botname: Chatname` label without widening the tab. Queued and generating jobs use the spinner state, completed jobs use the smart-theme green state, and failures use the smart-theme red state. The horizontal overflow remains scrollable but has no visible scrollbar. Layouts may adjust dimensions and spacing, but must preserve horizontal overflow, keyboard-operable buttons, visible focus, status text for assistive technology, and the close confirmation for active generation.

Standard users see the same top-bar entry in its locked state. The explanation is local UI only and does not include a billing link. Tab identities and labels are content-free and session-scoped; generated content never belongs in layout state.

## Frontend production bundles

The v5 client serves committed production bundles from `public/dist`; server and PM2 startup never compile frontend assets. After changing frontend JavaScript, static CSS, built-in extension manifests/resources, or startup templates, run `npm run build:frontend` and commit the generated files. CI and release checks should run `npm run check:frontend-build` to rebuild in a temporary directory and verify that the committed output is current.

`css/layouts/layout-structure.css`, the selected layout stylesheet, and `css/user.css` remain separate because the client switches or inspects them at runtime. Third-party extension files and server recovery endpoints remain present, but the bundled v5 client does not discover or load them.
