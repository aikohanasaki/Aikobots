export const PUBLIC_DIRECTORIES = {
    images: 'public/img/',
    backups: 'backups/',
    sounds: 'public/sounds',
    extensions: 'public/scripts/extensions',
    globalExtensions: 'public/scripts/extensions/third-party',
};

export const SETTINGS_FILE = 'settings.json';

/**
 * @type {import('./users.js').UserDirectoryList}
 * @readonly
 * @enum {string}
 */
export const USER_DIRECTORY_TEMPLATE = Object.freeze({
    root: '',
    thumbnails: 'thumbnails',
    thumbnailsBg: 'thumbnails/bg',
    thumbnailsAvatar: 'thumbnails/avatar',
    thumbnailsPersona: 'thumbnails/persona',
    worlds: 'worlds',
    user: 'user',
    messages: 'messages',
    avatars: 'User Avatars',
    userImages: 'user/images',
    groups: 'groups',
    groupChats: 'group chats',
    chats: 'chats',
    characters: 'characters',
    backgrounds: 'backgrounds',
    openAI_Settings: 'OpenAI Settings',
    themes: 'themes',
    movingUI: 'movingUI',
    layouts: 'layouts',
    layoutAssets: 'layout-assets',
    extensions: 'extensions',
    quickreplies: 'QuickReplies',
    assets: 'assets',
    comfyWorkflows: 'user/workflows',
    files: 'user/files',
    vectors: 'vectors',
    backups: 'backups',
    reasoning: 'reasoning',
});

/**
 * @type {import('./users.js').User}
 * @readonly
 */
export const DEFAULT_USER = Object.freeze({
    handle: 'default-user',
    name: 'User',
    created: Date.now(),
    password: '',
    admin: true,
    enabled: true,
    salt: '',
});

export const UNSAFE_EXTENSIONS = Object.freeze([
    '.ade',
    '.adp',
    '.application',
    '.bat',
    '.chm',
    '.cmd',
    '.com',
    '.cpl',
    '.dll',
    '.dmg',
    '.doc',
    '.docm',
    '.docx',
    '.dot',
    '.dotm',
    '.dotx',
    '.exe',
    '.gadget',
    '.htm',
    '.html',
    '.hta',
    '.img',
    '.inf',
    '.iso',
    '.jar',
    '.js',
    '.jse',
    '.jsp',
    '.lnk',
    '.msc',
    '.msh',
    '.msh1',
    '.msh1xml',
    '.msh2',
    '.msh2xml',
    '.mshxml',
    '.msi',
    '.pdf',
    '.php',
    '.pif',
    '.pot',
    '.potm',
    '.potx',
    '.pl',
    '.ppam',
    '.pps',
    '.ppsm',
    '.ppsx',
    '.ppt',
    '.pptm',
    '.pptx',
    '.ps1',
    '.ps1xml',
    '.ps2',
    '.ps2xml',
    '.psc1',
    '.psc2',
    '.py',
    '.reg',
    '.rb',
    '.sct',
    '.scf',
    '.scr',
    '.sh',
    '.sldm',
    '.sldx',
    '.sql',
    '.vb',
    '.vbe',
    '.vbs',
    '.ws',
    '.wsf',
    '.xlam',
    '.xls',
    '.xlsm',
    '.xlsx',
    '.xlt',
    '.xltm',
    '.xltx',
]);

export const GEMINI_SAFETY = [
    {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
        threshold: 'OFF',
    },
];

export const VERTEX_SAFETY = [
    {
        category: 'HARM_CATEGORY_IMAGE_HATE',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_IMAGE_DANGEROUS_CONTENT',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_IMAGE_HARASSMENT',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_IMAGE_SEXUALLY_EXPLICIT',
        threshold: 'OFF',
    },
    {
        category: 'HARM_CATEGORY_JAILBREAK',
        threshold: 'OFF',
    },
];

export const CHAT_COMPLETION_SOURCES = {
    OPENAI: 'openai',
    CLAUDE: 'claude',
    OPENROUTER: 'openrouter',
    AI21: 'ai21',
    MAKERSUITE: 'makersuite',
    VERTEXAI: 'vertexai',
    MISTRALAI: 'mistralai',
    CUSTOM: 'custom',
    COHERE: 'cohere',
    PERPLEXITY: 'perplexity',
    GROQ: 'groq',
    ELECTRONHUB: 'electronhub',
    NAVY: 'navy',
    NANOGPT: 'nanogpt',
    DEEPSEEK: 'deepseek',
    AIMLAPI: 'aimlapi',
    XAI: 'xai',
    POLLINATIONS: 'pollinations',
    MOONSHOT: 'moonshot',
    FIREWORKS: 'fireworks',
    COMETAPI: 'cometapi',
    AZURE_OPENAI: 'azure_openai',
    ZANITY: 'zanity',
    ZAI: 'zai',
    SILICONFLOW: 'siliconflow',
};

/**
 * Path to multer file uploads under the data root.
 */
export const UPLOADS_DIRECTORY = '_uploads';

// API identifiers used by captioning and embedding authentication.
export const HEADER_API_TYPES = {
    OOBA: 'ooba',
    VLLM: 'vllm',
    KOBOLDCPP: 'koboldcpp',
    TOGETHERAI: 'togetherai',
    LLAMACPP: 'llamacpp',
    OLLAMA: 'ollama',
    OPENROUTER: 'openrouter',
    FEATHERLESS: 'featherless',
    HUGGINGFACE: 'huggingface',
};

// https://docs.together.ai/reference/completions
// https://github.com/ollama/ollama/blob/main/docs/api.md#request-8
// https://platform.openai.com/docs/api-reference/completions
export const AVATAR_WIDTH = 512;
export const AVATAR_HEIGHT = 768;
export const DEFAULT_AVATAR_PATH = './public/img/ai4.png';

export const OPENROUTER_HEADERS = {
    'HTTP-Referer': 'https://sillytavern.app',
    'X-Title': 'SillyTavern',
};

export const AIMLAPI_HEADERS = {
    'HTTP-Referer': 'https://sillytavern.app',
    'X-Title': 'SillyTavern',
};

export const FEATHERLESS_HEADERS = {
    'HTTP-Referer': 'https://sillytavern.app',
    'X-Title': 'SillyTavern',
};

// https://github.com/vllm-project/vllm/blob/0f8a91401c89ac0a8018def3756829611b57727f/vllm/entrypoints/openai/protocol.py#L220
export const AZURE_OPENAI_KEYS = [
    'messages',
    'temperature',
    'frequency_penalty',
    'presence_penalty',
    'top_p',
    'max_tokens',
    'max_completion_tokens',
    'stream',
    'logit_bias',
    'stop',
    'n',
    'logprobs',
    'seed',
    'tools',
    'tool_choice',
    'reasoning_effort',
];

export const OPENAI_VERBOSITY_MODELS = /^gpt-5/;

export const OPENAI_REASONING_EFFORT_MODELS = [
    'o1',
    'o3-mini',
    'o3-mini-2025-01-31',
    'o4-mini',
    'o4-mini-2025-04-16',
    'o3',
    'o3-2025-04-16',
    'gpt-5',
    'gpt-5-2025-08-07',
    'gpt-5-mini',
    'gpt-5-mini-2025-08-07',
    'gpt-5-nano',
    'gpt-5-nano-2025-08-07',
    'gpt-5.1',
    'gpt-5.1-2025-11-13',
    'gpt-5.1-chat-latest',
    'gpt-5.2',
    'gpt-5.2-2025-12-11',
    'gpt-5.2-chat-latest',
    'gpt-5.3-chat-latest',
    'gpt-5.4',
];

export const OPENAI_REASONING_EFFORT_MAP = {
    min: 'minimal',
};

/**
 * Models that only accept a single fixed reasoning effort value.
 * @type {Record<string, string>}
 */
export const OPENAI_FIXED_REASONING_EFFORT = {
    'gpt-5.3-chat-latest': 'medium',
};

export const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

/**
 * An array of supported media file extensions.
 * This is used to validate file uploads and ensure that only supported media types are processed.
 */
export const MEDIA_EXTENSIONS = [
    'bmp',
    'png',
    'jpg',
    'webp',
    'jpeg',
    'jfif',
    'gif',
    'mp4',
    'avi',
    'mov',
    'wmv',
    'flv',
    'webm',
    '3gp',
    'mkv',
    'mpg',
    'mp3',
    'wav',
    'ogg',
    'flac',
    'aac',
    'm4a',
    'aiff',
];

export const ZAI_ENDPOINT = {
    COMMON: 'common',
    CODING: 'coding',
};

export const ZANITY_ENDPOINT = {
    STANDARD: 'standard',
    ALTERNATE: 'alternate',
};
