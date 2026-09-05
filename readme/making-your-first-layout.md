# Making Your First Aikobots Layout

See [layout sizing compatibility](layout.md) when changing widths: body overrides
do not automatically recalculate dependencies inherited from the root contract.
That guide also explains how to keep the Chat Width slider active.

So you want to customize how Aikobots looks. Good news: you don't need to touch any HTML or JavaScript. A custom layout is just a single CSS file that you upload through Settings.

This guide walks you through everything you need to go from zero to a working layout.

---

## The basic idea

Aikobots loads a few CSS files on every page, in this order:

1. **layout-contract.css** — sets up all the default variables
2. **layout-structure.css** — applies those variables to the actual page elements
3. **Your layout** — overrides the defaults with your values
4. **user.css** — a personal override layer on top of everything

Your job is step 3. You write a CSS file that changes the variables (and occasionally specific selectors), upload it, and the app picks it up.

The key thing to understand: **you change variables, not elements directly.** Instead of writing `#sheld { width: 900px }`, you write `--aiko-layout-chat-width: 900px`. The structure file handles wiring that variable to the right places. This is the approach that keeps things clean and avoids breaking things unexpectedly.

---

## Step 1: Start with the starter file

Every rule in your layout needs to live under `body.layout-custom` — that's the class the app puts on the page when a custom uploaded layout is active.

Here's the starter file straight from the technical docs. Copy this, save it as `my-layout.css`, and it already works:

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

This gives you a centered chat column, 840px wide on desktop, full-width on mobile.

---

## Step 2: Upload it

Go to **User Settings → Layout → Upload layout CSS** and upload your file. It'll appear in the layout dropdown immediately. Select it, and you're live.

---

## Step 3: Tweak the things you actually care about

### Change the chat width

This is the most common thing to adjust. The `min(840px, 92dvw)` pattern means "840px, but never more than 92% of the viewport width." Shrink or grow the first number to taste:

```css
--aiko-layout-chat-width: min(760px, 94dvw);  /* narrower, more focused */
--aiko-layout-chat-width: min(1100px, 96dvw); /* wider, more spacious */
```

### Move the chat column

By default the starter file centers the chat. To dock it to the left instead, replace the `0 / auto / auto` pattern:

```css
--aiko-layout-chat-left: 24px;
--aiko-layout-chat-right: auto;
--aiko-layout-chat-margin-inline: 0;

/* Do the same for topbar and drawer */
--aiko-layout-topbar-left: 24px;
--aiko-layout-topbar-right: auto;
--aiko-layout-topbar-margin-inline: 0;

--aiko-layout-drawer-left: 24px;
--aiko-layout-drawer-right: auto;
--aiko-layout-drawer-margin-inline: 0;
```

### Make things more compact

```css
--fontScale: 0.9;
--topBarIconScale: 0.8;
--avatar-base-width: 36px;
--avatar-base-height: 36px;
--aiko-layout-message-padding-block-start: 4px;
--aiko-layout-message-padding-inline: 6px;
```

### Move the composer to the top

```css
--aiko-layout-composer-order: 1;
--aiko-layout-chat-order: 2;
```

### Use the active theme's colors

If you want your layout to respect whatever theme the user has loaded — rather than hardcoding colors — use the SmartTheme variables:

```css
body.layout-custom #sheld {
    background-color: color-mix(in srgb, var(--SmartThemeChatTintColor) 92%, transparent);
    border: 1px solid var(--SmartThemeBorderColor);
}

body.layout-custom .mes {
    color: var(--SmartThemeBodyColor);
}
```

The most useful color variables are `--SmartThemeBodyColor`, `--SmartThemeChatTintColor`, `--SmartThemeBlurTintColor`, `--SmartThemeBorderColor`, and `--SmartThemeShadowColor`. See the technical reference for the full list.

### Add a background image

You can't use remote URLs for images — they're blocked for security. Instead, upload your image through **User Settings → Layout** (there's a separate image upload button). Once uploaded, you get a URL you can use:

```css
body.layout-custom #sheld {
    background-image: url("/api/layouts/assets/file/your-image.webp");
}
```

Important: every uploaded layout image is converted to WebP. If you upload `your-image.png` or `your-image.jpg`, use the generated `.webp` URL in your layout CSS.

Accepted formats: PNG, JPEG, WebP. Max size 10 MB source, stored as WebP. Max 50 images total.

---

## Things to avoid

**Don't use broad selectors.** Writing `* { box-sizing: border-box }` or `div { position: relative }` can silently break drawers, menus, and popups in hard-to-debug ways. Target specific selectors.

**Don't style `.closedDrawer`.** That class is a JavaScript state marker, not a visual state. Use `.drawer-content.openDrawer` instead if you need to style open drawers.

**Don't hardcode colors** if you want your layout to work with multiple themes. Use the SmartTheme variables mentioned above.

**Don't forget the mobile block.** The starter file includes a `@media (max-width: 1000px)` block that resets everything to full width. Keep it. Without it, a desktop layout can overflow badly on mobile.

---

## Quick checklist before sharing your layout

After uploading, go through this before calling it done:

- [ ] Chat loads normally
- [ ] Top bar icons are clickable
- [ ] Left and right drawers open
- [ ] Message buttons are visible
- [ ] Composer can send messages
- [ ] Reasoning blocks expand and collapse
- [ ] Swipe buttons still work
- [ ] Long messages wrap correctly
- [ ] Mobile width doesn't overflow
- [ ] No text overlaps any buttons

---

## File limits

- Max file size: **5 MB**
- Max layouts: **25**
- File must end in `.css`
- Filename: letters, numbers, spaces, underscores, dots, hyphens — max 120 characters

---

That's it. For the full variable reference, lock behavior, all built-in layout names, and the complete message HTML structure, see the [technical reference](layouts.md).
