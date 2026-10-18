# STMB Clips in Aikobots

Open **Topical Clip** from the STMB menu to generate a focused Clip. **Edit Topical Format** controls how newly saved Topical Clips and later replacements are wrapped. A format must contain `{{CONTENT}}` exactly once; `{{TITLE}}` is optional. The editor previews the result and can reset to the built-in format. A preference change does not rewrite existing entries or drafts already generated.

When chat messages are a source, **Include hidden messages** controls whether hidden messages contribute to either a message range or an Extract selection. It is off by default and independent of the general memory-generation setting. A new range starts at the scene-start marker, otherwise the highest processed message, otherwise zero; it ends at the scene-end marker or the chat's last saved message. An explicit range takes precedence. Changing the checkbox clears an unsaved draft.

Use **Combine Clips** to consolidate at least two ordinary or Topical Clips from one Memory Book. **Edit Combine Clips Prompt** requires `{{SOURCE_CLIPS}}` exactly once and optionally accepts `{{TITLE}}`. **Edit Combined Format** uses the same format placeholders as Topical Clip, with a separate saved preference. Review the generated draft before saving. The output uses the union of selected primary keywords. **Disable original clips after saving** leaves the originals in place but stops their activation.

Disabled Clips are hidden from Clip, Topical Clip target, and Combine selectors until **Show disabled clips** is checked. Hiding them again deselects those sources while retaining checked, visible sources. Updating a disabled Topical Clip enables it when saved. Ordinary Clip appends preserve the target's enabled state. Memory Assistance excludes disabled Clips from new reviews and hides their pending suggestions without deleting the report.

Topical Clip and Combine Clips can override insertion position and order for a save. Selecting **Outlet** requires an **Outlet Name**. With the override off, the existing profile or Combine defaults apply. A queued Topical Clip job uses the format and placement captured when generation starts.
