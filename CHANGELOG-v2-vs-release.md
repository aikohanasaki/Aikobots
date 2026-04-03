# Aikobots v2

`v2` is a shift toward a more controlled, server-managed system. Instead of relying on the browser to piece things together, more of the actual generation logic now lives in the core runtime. In practice, that means more consistent behavior, fewer edge cases, and a clearer idea of what the system is actually doing.

At the same time, a number of features that used to live in extensions or side systems have been pulled into core. STLO (lorebook ordering and budgeting), STMB (memory systems), and related tooling are now part of the main experience instead of optional add-ons, with more integrations planned.

Lorebooks and characters have also moved toward a more structured model. Lorebooks can now be secure or hidden, and characters can be reviewed, owned, and distributed through admin workflows instead of being purely local files.

Large chats are no longer treated as a problem to work around. They’re handled as a normal case, with better loading, navigation, and storage behavior.

The tradeoff is focus: support for older or less common generation paths has been reduced in favor of a more modern, chat-completions-first workflow.

---

# What’s Changed

### More consistent, backend-driven behavior

Generation is now handled centrally on the server instead of assembled entirely in the browser. The system decides more of what actually goes into a response, which makes behavior more predictable across devices and setups and eases resource demand on less capable devices.

---

### Core features instead of extensions

* **SillyTavern-MemoryBooks** is integrated directly, making memory handling part of the core prompt flow
* **SillyTavern-LorebookOrdering** is now built into lorebook handling, so ordering and token budgeting are part of the default behavior
* **SillyTavern-Bookmarks** is now integral and handles long chat loading quickly.

---

### Lorebooks are more capable and more controlled

* **Secure/Hidden lorebooks** with ownership and permission controls can participate in generation without being visible in the normal selector
* **Template-driven lorebook sets** allow admins to apply and manage lorebook sets at a higher level
* Built-in ordering, prioritizing, and budgeting 

---

### Character management is now structured and ownership-aware

* Characters can be **submitted for admin review**
* Admins can **approve and distribute characters** to specific users or globally
* **Ownership rules** now affect duplication, editing, and sharing
* Distribution can update or maintain managed versions of characters

---

### Long chats are treated as a first-class use case

* Chats can be opened without loading the entire history at once
* Older messages can be loaded as needed instead of all at once
* **Bookmarks** work alongside this model for navigation
* Storage is structured to support very large histories without breaking the UI

---

### Prompt handling is more visible and structured

Because generation is centralized, the system can now:

* Provide clearer insight into what’s being included in a prompt
* Handle ordering, memory, and lorebook injection more consistently
* Support debugging and comparison of prompt behavior

---

### A more focused, modern pipeline

* Older text-generation paths have been removed or deprioritized
* The overall flow is built around chat-completions-style APIs
