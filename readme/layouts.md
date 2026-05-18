# Aikobots Layout Template Guide

Aikobots layouts are CSS-only templates. A layout does **not** replace the chat HTML. Instead, it changes CSS variables and selected classes that the app already provides.

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
4. The server converts it to PNG.
5. Use the generated URL in your CSS.

Allowed URL shape:

```css
body.layout-custom #sheld {
    background-image: url("/api/layouts/assets/file/example.png");
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
Stored format: PNG
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
