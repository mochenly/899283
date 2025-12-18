import { extension_settings } from '../../../../extensions.js';

export const defaultApiPreset = {
    temperature: 0.2,
    top_p: 1,
    max_tokens: 4096,
    reasoning_effort: 'auto',
    assistant_prefill: '',
    confirmation_jb: false,
    connection_profile: extension_settings.connectionManager.selectedProfile,
    stream: false,
}

export const defaultSet = {
    name: 'Default',
    global_blocks: [],
}

export const defaultSettings = {
    extblocks_is_enabled: false,
    active_set: 'Default',
    active_set_idx: 0,
    active_api_preset: 'big',
    api_presets: {
        'big': { ...defaultApiPreset },
        'medium': { ...defaultApiPreset },
        'small': { ...defaultApiPreset },
    },
    autohide_display: '',
    autohide_prompt: '',
    sets: [ defaultSet ]
};

export const extName = 'ExtBlocks'
export const defaultExtPrefix = '[ExtBlocks]';
export const worldInfoMacrosNames = ['{{wiBefore}}', '{{wiAfter}}', '{{wiExamples}}', '{{wiDepth}}', '{{wiAll}}'];
export const mainPromptMacros = '{{mainPrompt}}';

export const extStates = {
    ExtBlocks_settings: undefined,
    current_set: undefined,
    api_preset: undefined,
    connection_profile: undefined,
    spoilerRegex: undefined,
    self_reload_flag: false,
    is_chat_modified: false,
    generationPaused: false,
    cachedPauseBlocks: null,
    triggeredPauseBlock: null,
    pauseCounter: 0,
    abortController: null,
}
export const path = 'third-party/extblocks';
export const templates_path = path + '/templates';

export const BlockType = {
    GENERATED: 'generated',
    ACCUMULATION: 'accumulation',
    REWRITE: 'rewrite',
    SCRIPT: 'script'
};

export const ContextType = {
    TEXT: 'text',
    LAST_MESSAGES: 'last_messages',
    LAST_MESSAGES_KEYWORD: 'last_messages_keyword',
    PREVIOUS_BLOCK: 'previous_block'
}

export const ScriptType = {
    ST: 'stscript',
    JS: 'js'
}

export const MessageRole = {
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant'
}

export const ElementTemplate = {
    SETTINGS: 'settings',
    BLOCK: 'block',
    CONTEXT_ITEM: 'context_item',
    NEW_SET_POPUP: 'new_set_popup',
    STORAGE_EDITOR: 'storage_editor',
    GENERATED_EDITOR: 'editor',
    ACCUMULATION_EDITOR: 'accumulation_editor',
    SCRIPT_EDITOR: 'script_editor'
}

export const ExtSlashCommand = {
    GENERATE: 'extblocks-generate',
    REGENERATE: 'extblocks-regenerate',
    REWRITE: 'extblocks-rewrite',
    EXECUTE_SCRIPT: 'extblocks-execute-script',
    STORAGE_APPEND: 'extblocks-storage-append',
    STORAGE_PURGE: 'extblocks-storage-purge',
    STORAGE_EXPORT: 'extblocks-storage-export',
    FLUSH_INJECTS: 'extblocks-flushinjects',
    ABORT: 'extblocks-abort-generation'
}

export const editButton = `<div title="Edit extblocks" class="mes_button Extblocks-storage-edit fa-solid fa-pen-to-square interactable" data-i18n="[title]Edit extblocks" tabindex="0"></div>`;