const { extensionSettings } = SillyTavern.getContext();

export const defaultApiPreset = {
    temperature: 0.2,
    top_p: 1,
    max_tokens: 4096,
    reasoning_effort: 'auto',
    confirmation_jb: false,
    connection_profile: extensionSettings.connectionManager.selectedProfile,
    connection_mode: 'profile',
    manual_endpoint: '',
    manual_api_key: '',
    manual_key_source: 'manual',
    manual_tavern_secret_id: '',
    manual_model: '',
    manual_models: [],
    stream: false,
};

export const defaultSet = {
    name: 'Default',
    global_blocks: [],
};

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
    sets: [ defaultSet ]
};

export const extName = 'ExtBlocks';
export const defaultExtPrefix = '[ExtBlocks]';
export const worldInfoMacrosNames = ['{{wiBefore}}', '{{wiAfter}}', '{{wiExamples}}', '{{wiDepth}}', '{{wiAll}}'];
export const mainPromptMacros = '{{mainPrompt}}';

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
};

export const ScriptType = {
    ST: 'stscript',
    JS: 'js'
};

export const MessageRole = {
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant'
};

export const ElementTemplate = {
    SETTINGS: 'settings',
    BLOCK: 'block',
    CONTEXT_ITEM: 'context_item',
    NEW_SET_POPUP: 'new_set_popup',
    STORAGE_EDITOR: 'storage_editor',
    GENERATED_EDITOR: 'editor',
    ACCUMULATION_EDITOR: 'accumulation_editor',
    SCRIPT_EDITOR: 'script_editor',
    SELECTION_POPUP: 'selection_popup'
};

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
};

export const MacroName = {
    MAIN: `${extName}`,
    GET_BLOCK_BY_NAME: `${extName}-GetBlockByName`,
    CALL_GENERATION: `${extName}-Call`,
    CALL_REWRITE: `${extName}-CallRewrite`,
    CALL_SCRIPT: `${extName}-CallScript`
}

export const ExtTopic = {
    GENERATE_BLOCKS: '/extblocks/generate',
    BLOCKS_GENERATED: '/extblocks/generated',
    FATPRESETS_IMPORT: '/fatpresets/import/extblocks',
    FATPRESETS_CHANGE: '/fatpresets/change/extblocks',
    FATPRESETS_DISABLE: '/fatpresets/disable/extblocks',
    PROMPT_TEMPLATE_ENGINE: '/prompttemplateengine/render'
}

export const editButton = `<div title="Edit extblocks" class="mes_button Extblocks-storage-edit fa-solid fa-pen-to-square interactable" tabindex="0"></div>`;
export const selectionRewriteButton = `<div title="[ExtBlocks] Partial rewrite" class="menu_button Extblocks-selection-rewrite fa-solid fa-pen-to-square interactable" tabindex="0" role="button"></div>`;
