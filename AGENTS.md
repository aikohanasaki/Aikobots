# Project Directives

- All code edits must be as surgical as possible with the least effect on adjacent code or non-pipeline imports/exports.
- Do not write or update tests.
- Do not use npx, bunx, or similar package-runner wrappers.
- Only use tooling that is already installed and already part of the project’s normal workflow or is present in the repository.
- If a tool is unavailable, treat it as out of scope unless the user explicitly asks for it.
- Only address critical lint issues if they are directly visible in the touched code or surfaced by already-available project tooling.
- Ignore localization and translation issues.
- Ignore i18n wording, translation keys, locale parity, or localization QA.
