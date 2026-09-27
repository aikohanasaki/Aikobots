## What is Aikobots?

Aikobots is a multi-user fork of SillyTavern built around chat completion APIs. It does not include support for legacy text generation APIs. Aikobots originated as a parallel fork of SillyTavern beginning around version 1.11.0. While earlier development still tracked portions of the upstream project, Aikobots v2 fully diverged after SillyTavern 1.14.0 and no longer develops in parallel with SillyTavern.

## Chat-completion extension compatibility

Generation uses chat messages and server prompt assembly. `main_api` remains `openai`; `generateRaw` still accepts plain text and converts it to chat messages. Explicit text-completion API selections are unsupported, and legacy text-completion requests to the chat endpoint return HTTP 410.

Text-only modules `nai-settings.js` and `cfg-scale.js`, events `GENERATE_BEFORE_COMBINE_PROMPTS` / `GENERATE_AFTER_COMBINE_PROMPTS`, and exports `CHAT_COMPLETIONS_ONLY`, `TEXTGEN_TOKENIZERS`, `getExtensionPromptMaxDepth`, `shiftDownByOne`, and `convertTextCompletionPrompt` are removed. `force_name2` is no longer a generation option; `getBiasStrings` no longer returns the unused `isUserPromptBias` flag. The unused tokenizer enum members `API_TEXTGENERATIONWEBUI` / `API_KOBOLD` are removed without renumbering other IDs. Server header authentication uses `HEADER_API_TYPES` instead of `TEXTGEN_TYPES`; unused text-provider parameter allowlists are removed. Extensions should use the existing chat-completion and generation lifecycle hooks.

NovelAI images/TTS, captioning, embeddings, chat imports, and saved legacy data remain supported. Image and TTS settings open the existing API-key manager directly. `POST /api/novelai/status` returns only `{ balance, unlimitedImageGeneration }`; credential or upstream failures return non-success status codes. Text-generation CFG settings are ignored without deleting saved metadata; image-generation CFG is unaffected.

## Our Vision

1. Support roleplay communities by making it easier for bot creators to share their work and collaborate in a multi-user environment.
2. Provide stronger protection against scraping and client-side exposure through a server-side architecture.
3. Improve speed and stability of the RP experience, especially with long chats (1000+ messages). 
4. Better support for mobile clients and access-anywhere architecture with high error resilience. 
5. Preserve compatibility with SillyTavern workflows while integrating the Aikoverse suite directly into core functionality.
6. Develop Aikobots as an open-source passion project supported by patronage.

## License and credits

**This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the [GNU Affero General Public License](https://www.gnu.org/licenses/agpl-3.0.en.html) for more details.**

SillyTavern's Credits
* [TavernAI](https://github.com/TavernAI/TavernAI) 1.2.8 by Humi: MIT License
* Visual Novel Mode inspired by the work of PepperTaco (<https://github.com/peppertaco/Tavern/>)
* Noto Sans font by Google (OFL license)
* Icon theme by Font Awesome <https://fontawesome.com> (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
* Default content by @OtisAlejandro (Seraphina character and lorebook) and @kallmeflocc (10K Discord Users Celebratory Background)
* Docker guide by [@mrguymiah](https://github.com/mrguymiah) and [@Bronya-Rand](https://github.com/Bronya-Rand)
* kokoro-js library by [@hexgrad](https://github.com/hexgrad) (Apache-2.0 License)

Additional Aikobots Credits
* [SillyTavern](https://github.com/SillyTavern/SillyTavern) 1.14.0: AGPL-3.0 License including inherited upstream credits
* WorldInfo-Info and WorldInfo-Presets from the incomparable [@LenAnderson](https://github.com/LenAnderson/)
* [@Cohee1207](https://github.com/Cohee1207) for Top Info Bar aka Chat Top Bar (AGPL-3.0 License)
* [Favorites Carousel](https://github.com/subzero5544/favorites-carousel) by [@subzero5544](https://github.com/subzero5544) (AGPL-3.0 License)
* [Silence Player](https://github.com/SillyTavern/Extension-Silence) by [@Cohee1207](https://github.com/Cohee1207) (AGPL-3.0 License)
* [Toast History](https://github.com/LenAnderson/SillyTavern-ToastHistory) by [@LenAnderson](https://github.com/LenAnderson/)

## Documentation Links

See the [CSS layout style guide](/readme/layout.md) for layout structure, theme variables, and instructions for generating custom Aikobots CSS.

Other documentation available: [Testing](readme/testing.md), and [SQLite](readme/sqlite.md).
