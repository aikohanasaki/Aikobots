const {
    defineConfig,
    globalIgnores,
} = require("eslint/config");

const jest = require("eslint-plugin-jest");
const globals = require("globals");
const js = require("@eslint/js");

const {
    FlatCompat,
} = require("@eslint/eslintrc");

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

module.exports = defineConfig([{
    plugins: {
        jest,
    },

    extends: compat.extends("eslint:recommended", "plugin:jest/recommended"),

    languageOptions: {
        globals: {
            ...globals.node,
            ...jest.environments.globals.globals,
            page: "readonly",
        },

        ecmaVersion: "latest",
        sourceType: "module",
        parserOptions: {},
    },

    rules: {
        "no-unused-vars": ["error", {
            args: "none",
        }],

        "no-control-regex": "off",

        "no-constant-condition": ["error", {
            checkLoops: false,
        }],

        "require-yield": "off",
        "quotes": ["error", "single"],
        "semi": ["error", "always"],

        "indent": ["error", 4, {
            SwitchCase: 1,

            FunctionDeclaration: {
                parameters: "first",
            },
        }],

        "comma-dangle": ["error", "always-multiline"],
        "eol-last": ["error", "always"],
        "no-trailing-spaces": "error",
        "object-curly-spacing": ["error", "always"],
        "space-infix-ops": "error",

        "no-unused-expressions": ["error", {
            allowShortCircuit: true,
            allowTernary: true,
        }],

        "no-cond-assign": "error",
    },

    settings: {
        jest: {
            version: "29.7.0",
        },
    },
}, globalIgnores([])]);
