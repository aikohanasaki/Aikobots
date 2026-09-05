# Custom Layouts in Aikobots

See [layout sizing compatibility](layout.md) for the built-in sizing release note,
width-control precedence, and guidance on custom CSS variable dependencies.

Aikobots layouts let you change how the chat screen is arranged without replacing the app itself.

A layout is a CSS file. It can adjust things like:

- how wide the chat is
- whether the chat is centered, left-docked, or wider
- where the composer appears
- how compact messages feel
- how panels and drawers line up
- what uploaded images are used as layout backgrounds or accents

Layouts should not rewrite the whole interface. They should make small, focused changes to the layout system Aikobots already provides.

## Quick Start

1. Create a `.css` file.
2. Put your layout rules under `body.layout-custom`.
3. Upload the file from:

```text
User Settings -> Layout -> Upload layout CSS
```

4. Select the uploaded layout from the Layout dropdown.
5. Test the layout on desktop and mobile.

## Start With This Template

Copy this into a new file, such as:

```text
my-layout.css
```

Then upload it as a custom layout.

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

This creates a centered chat layout, keeps the top bar and drawers aligned with the chat, and resets the layout for mobile screens.

## The Main Rule

Prefer layout variables over hardcoded CSS.

Prefer this:

```css
body.layout-custom {
    --aiko-layout-chat-width: min(900px, 94dvw);
}
```

Avoid this:

```css
body.layout-custom #sheld {
    width: 900px !important;
}
```

Variables are safer because Aikobots already knows how to apply them across the chat, top bar, drawers, and panels.

## What You Can Safely Change

Good layout changes include:

- chat width
- chat position
- drawer width
- message spacing
- message density
- composer position
- panel alignment
- background images uploaded through Aikobots
- small targeted styling inside the custom layout

Riskier changes include:

- global `div`, `button`, or `*` rules
- forcing elements to `position: fixed` without testing
- hiding drawer states manually
- changing all app buttons at once
- using `!important` everywhere
- styling internal state classes that JavaScript depends on

## Important Safety Rules

Always scope custom layout rules under:

```css
body.layout-custom
```

Use this pattern:

```css
body.layout-custom {
    /* layout variables first */
}

body.layout-custom .specific-selector {
    /* small targeted overrides second */
}
```

Do not style `.closedDrawer`.

Use this when you need visible drawer styling:

```css
body.layout-custom .drawer-content.openDrawer {
    /* visible drawer state */
}
```

Avoid this:

```css
body.layout-custom .closedDrawer {
    display: none;
}
```

`.closedDrawer` is mainly a JavaScript state marker. Styling it directly can break drawer behavior.

## Using Images

Custom layout CSS cannot use arbitrary remote images.

Do not use:

```css
background-image: url("https://example.com/image.png");
background-image: url("data:image/png;base64,...");
background-image: url("file://...");
```

Use the Aikobots layout image uploader instead:

1. Go to `User Settings -> Layout`.
2. Upload a static PNG, JPEG, or WebP image.
3. Aikobots converts the processed image to WebP.
4. Use the generated Aikobots `.webp` asset URL in your CSS.

Important: uploaded `.png`, `.jpg`, `.jpeg`, and `.webp` images are all stored as WebP layout assets. When writing layout CSS, link the returned `.webp` URL.

Example:

```css
body.layout-custom #sheld {
    background-image: url("/api/layouts/assets/file/example.webp");
}
```

## Upload Limits

Custom layout CSS:

```text
Max CSS size: 5 MB
Allowed extension: .css
```

Layout images:

```text
Accepted uploads: static PNG, JPEG, or WebP
Stored format: WebP
Total image asset storage: 20 MB
```

For exact current limits, see the full layout reference.

## Mobile Support

Desktop layouts often need a mobile reset.

At widths under `1000px`, Aikobots forces most major layout areas to fit the viewport. If your desktop layout moves the chat left or right, make sure your mobile CSS brings it back to full width.

Use this pattern:

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

## Testing Checklist

After uploading a layout, check that:

- chat loads normally
- top bar icons are clickable
- left drawer opens
- right drawer opens
- background drawer opens
- message buttons are visible
- edit message mode still works
- reasoning blocks expand and collapse
- swipe buttons still work
- the composer can send messages
- long messages wrap correctly
- mobile width does not overflow
- drawers are usable on mobile
- text does not overlap buttons
- no panel is permanently stuck open or closed

## Using AI to Create a Layout

You can use AI to help write a layout, but give it strict rules. Otherwise, it may write broad CSS that breaks drawers, popups, buttons, or mobile behavior.

Paste this prompt into your AI tool:

```text
Create a custom Aikobots layout CSS file.

Rules:
- Return only CSS.
- Scope all rules under body.layout-custom.
- Prefer Aikobots layout variables over hardcoded size and position rules.
- Do not use global selectors like *, div, button, input, or body unless absolutely necessary.
- Do not style .closedDrawer.
- Do not use remote image URLs.
- Do not use data URLs or base64 embedded images.
- Do not use file:// URLs.
- Include a mobile reset for screens under 1000px.
- Keep the CSS focused on layout, spacing, panels, messages, and composer placement.
- Avoid !important unless there is no other safe option.

Desired layout:
[Describe the layout you want here.]
```

Example desired layout descriptions:

```text
A centered narrow chat layout with compact messages and a calm reading-focused feel.
```

```text
A left-docked chat layout with room on the right side for character art or a background image.
```

```text
A compact layout for small screens with smaller avatars, tighter messages, and less vertical padding.
```

## Common Layout Ideas

### Centered Reading Layout

Best for users who want a clean, focused chat view.

Changes usually include:

- narrower chat width
- centered chat
- moderate message spacing
- default composer at the bottom

### Left-Docked Layout

Best for users who want the chat on one side and visual space on the other.

Changes usually include:

- fixed chat width
- chat aligned to the left
- drawers aligned with the chat
- optional background image on the open side

### Compact Layout

Best for users who want more messages visible at once.

Changes usually include:

- smaller avatars
- smaller font scale
- tighter message padding
- reduced composer padding

### Top Composer Layout

Best for users who prefer the input box above the chat.

Changes usually include:

- composer order above chat
- adjusted margins
- careful mobile testing

## When to Use the Full Reference

Use the full layout reference when you need:

- the complete list of layout variables
- built-in layout IDs
- exact selector names
- message structure details
- advanced examples
- exact upload limits
- deeper troubleshooting information

Most users should start with this intro first, then open the full reference only when they need more detail.
