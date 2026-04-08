import js from "@eslint/js";

export default [
    {
        ...js.configs.recommended,
        files: ["app.js"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "script",
            globals: {
                // Browser globals
                window: "readonly", document: "readonly", console: "readonly",
                localStorage: "readonly", fetch: "readonly", alert: "readonly",
                confirm: "readonly", location: "readonly", setTimeout: "readonly",
                setInterval: "readonly", clearInterval: "readonly", clearTimeout: "readonly",
                requestAnimationFrame: "readonly", cancelAnimationFrame: "readonly",
                FileReader: "readonly", Blob: "readonly", URL: "readonly",
                Date: "readonly", Math: "readonly", Promise: "readonly",
                Set: "readonly", Map: "readonly", Array: "readonly", Object: "readonly",
                String: "readonly", parseInt: "readonly", parseFloat: "readonly",
                isNaN: "readonly", AudioContext: "readonly", HTMLElement: "readonly",
                Event: "readonly", TextEncoder: "readonly", crypto: "readonly",
                btoa: "readonly", atob: "readonly", performance: "readonly",
                MutationObserver: "readonly",
                // Firebase (loaded via CDN script tag)
                firebase: "readonly",
                // KaTeX (loaded via CDN)
                renderMathInElement: "readonly", katex: "readonly",
                // Project-defined globals used via onclick/window
                editDiscQ: "writable", deleteDiscQ: "writable",
                editQuizQ: "writable", deleteQuizQ: "writable",
                updateQuizSelection: "writable",
                addImageMatchPair: "writable", handleImPairImage: "writable",
                handleDrop: "writable", handleImDrop: "writable", clearImDrop: "writable",
                sendReaction: "writable", closeFilePreview: "writable",
                lpMoveStep: "writable", lpRemoveStep: "writable",
                lpUpdateStepQuestion: "writable", lpUpdateStepTitle: "writable",
                lpUpdateStepTitleInput: "writable", lpUpdateStepTasks: "writable",
                lpUpdateStepHomework: "writable",
                lpUpdateQuizSelection: "writable",
                lpActivatePlan: "writable", lpEditPlan: "writable", lpDeletePlan: "writable",
                lpRunStep: "writable", lpStopStep: "writable",
                lpViewStepResult: "writable",
                rateStar: "writable", rateBulkStar: "writable",
                submitEval: "writable",
                showFilePreview: "writable", viewFile: "writable",
                removeAttachedFile: "writable",
                deleteHomeworkTask: "writable",
                editHomeworkTask: "writable",
                sendPeerComment: "writable",
            }
        },
        rules: {
            "no-undef": "error",
            "no-redeclare": "error",
            "no-dupe-keys": "error",
            "no-unreachable": "error",
            "use-isnan": "error",
            "valid-typeof": "error",
            "eqeqeq": ["error", "smart"],
            "no-self-assign": "error",
            "no-self-compare": "error",
            "no-unused-vars": ["warn", { "args": "none", "vars": "local", "varsIgnorePattern": "^_" }],
            "no-dupe-class-members": "error",
            "no-constant-condition": "warn",
            "no-empty": ["warn", { "allowEmptyCatch": true }],
            "no-fallthrough": "warn",
            "no-irregular-whitespace": "warn",
            "no-loss-of-precision": "warn",
        }
    }
];
