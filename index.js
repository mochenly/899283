import { saveSettingsDebounced, substituteParamsExtended, setExtensionPrompt, callPopup,
    reloadCurrentChat, this_chid, characters, eventSource, event_types, chat, getRequestHeaders } from '../../../../script.js';
import { selected_group } from '../../../group-chats.js';
import { extension_settings, writeExtensionField, renderExtensionTemplateAsync } from '../../../extensions.js';
import { getRegexedString, runRegexScript } from '../../../extensions/regex/engine.js'
import { download, getFileText, getSortableDelay, uuidv4 } from '../../../utils.js';
import { proxies, selected_proxy } from '../../../openai.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument} from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

const { extensionPrompts, saveChat } = SillyTavern.getContext();

const defaultSet = {
    name: 'Default',
    global_blocks: [],
    chat_completion_source: 'openai',
    model: 'gpt-4o',
    temperature: 0.2,
    system_prompt: '',
    assistant_prefill: ''
}

const defaultSettings = {
    extblocks_is_enabled: false,
    active_set: 'Default',
    active_set_idx: 0,
    proxy_preset: selected_proxy.name,
    sets: [
        defaultSet
    ]
};

const defaultExtPrefix = '[ExtBlocks]'

let ExtBlocks_settings;
let current_set;
let blocksPurgeScript;
let spoilerScript;

const path = 'third-party/extblocks';
const templates_path = path + '/templates';

let self_reload_flag = false;
async function selfReloadCurrentChat() {
    if (this_chid !== undefined && extension_settings.ExtBlocks.extblocks_is_enabled) {
        self_reload_flag = true;
        await reloadCurrentChat();
    }
}

async function refreshSettings() {
    ExtBlocks_settings = extension_settings.ExtBlocks;
    current_set = ExtBlocks_settings.sets[ExtBlocks_settings.active_set_idx];
}

async function interactiveSortData(sortableDatas) {
    for (const { selector, setter, getter } of sortableDatas) {
        $(selector).sortable({
            delay: getSortableDelay(),
            stop: async function () {
                const oldData = getter();
                const newData = [];
                $(selector).children().each(function () {
                    const id = $(this).attr('id');
                    const existingData = oldData.find((e) => e.id === id);
                    if (existingData) {
                        newData.push(existingData);
                    }
                });
                await setter(newData);
                saveSettingsDebounced();
                await loadBlocks();
            },
        });
    }
}

function updateOrInsert(jsonArray, newJson) {
    let index = -1;

    for (let i = 0; i < jsonArray.length; i++) {
        if (jsonArray[i].name === newJson.name) {
            jsonArray[i] = newJson;
            index = i;
            return index;
        }
    }

    if (index === -1) {
        jsonArray.push(newJson);
        index = jsonArray.length - 1;
    }

    return index;
}

function getDefaultSet() {
    return JSON.parse(JSON.stringify(defaultSet));
}


function refreshSetList() {
    let sets_name = ExtBlocks_settings.sets.map(obj => obj.name);
    $('#ExtBlocks-preset-list').empty();
    sets_name.forEach(function(option) {
        $('#ExtBlocks-preset-list').append($('<option>', {
            value: option,
            text: option
        }));
    });
    $(`#ExtBlocks-preset-list option[value="${ExtBlocks_settings.active_set}"]`).attr('selected', true);
}

async function changeSet(idx) {
    const set_name = extension_settings.ExtBlocks.sets[idx].name;
    extension_settings.ExtBlocks.active_set = set_name;
    extension_settings.ExtBlocks.active_set_idx = idx;
    refreshSettings();
    refreshSetList();
    saveSettingsDebounced();
    await loadAPI();
    await loadBlocks();
    await selfReloadCurrentChat();
}


async function importSet(file) {
    if (!file) {
        toastr.error('No file provided.');
        return;
    }

    try {
        const fileText = await getFileText(file);
        const extSet = JSON.parse(fileText);
        if (!extSet.name) {
            throw new Error('No name provided.');
        }

        const set_idx = updateOrInsert(extension_settings.ExtBlocks.sets, extSet);
        await changeSet(set_idx);
        

        
        toastr.success(`ExtBlocks set "${extSet.name}" imported.`);
    } catch (error) {
        console.log(error);
        toastr.error('Invalid JSON file.');
        return;
    }
}


async function purgeRegexForBlocks() {
    extension_settings.regex = extension_settings.regex.filter(item => !item.scriptName.includes(defaultExtPrefix));
    saveSettingsDebounced();
    await selfReloadCurrentChat();
}

async function createRegexForBlocks() {
    let names = [];
    let spoiler_names = [];

    current_set.global_blocks.forEach((block, index, array) => {
        names.push(block.name);
        if (block.hide_display) {
            spoiler_names.push(block.name);
        }
    });
    characters[this_chid]?.data?.extensions?.ExtBlocks?.forEach((block, index, array) => {
        names.push(block.name);
        if (block.hide_display) {
            spoiler_names.push(block.name);
        }
    });

    if (names.length == 0) {
        return
    };
    extension_settings.regex = extension_settings.regex.filter(item => !item.scriptName.includes(defaultExtPrefix));

    blocksPurgeScript = {
        id: uuidv4(),
        scriptName: `${defaultExtPrefix} Blocks purge`,
        findRegex: `/${names.map(name => `(\\n*<${name}>[\\s\\S]*?<\\/${name}>\\n*)`).join('|')}/g`,
        replaceString: '',
        trimStrings: [],
        placement: [1, 2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: true,
        substituteRegex: false,
        minDepth: null,
        maxDepth: null,
    };
    
    extension_settings.regex.push(blocksPurgeScript);

    if (spoiler_names.length != 0) {
        spoilerScript = {
            id: uuidv4(),
            scriptName: `${defaultExtPrefix} Spoiler`,
            findRegex: `/${spoiler_names.map(name => `(\\n*<${name}>[\\s\\S]*?<\\/${name}>\\n*)`).join('|')}/g`,
            replaceString: '',
            trimStrings: [],
            placement: [1, 2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: false,
            minDepth: null,
            maxDepth: null,
        };
        extension_settings.regex.push(spoilerScript);
    }

    saveSettingsDebounced();
    await selfReloadCurrentChat();

}

async function importBlock(file, isScoped) {
    if (!file) {
        toastr.error('No file provided.');
        return;
    }

    try {
        const fileText = await getFileText(file);
        const block = JSON.parse(fileText);
        if (!block.name) {
            throw new Error('No name provided.');
        }

        if (!block.id) {
            block.id = uuidv4();
        }

        const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];
        const existingData = array.find((e) => e.id === block.id);
        const idx = updateOrInsert(array, block);
        
        if (existingData && idx == array.length - 1) {
            toastr.error('Could not import block: The block id must be unique.');
            array.splice(idx, 1);
            return;
        }

        if (isScoped) {
            if (this_chid === undefined) {
                toastr.error('No character selected.');
                return;
            }
            await writeExtensionField(this_chid, 'ExtBlocks', array);
        }

        saveSettingsDebounced();
        await loadBlocks();
        await selfReloadCurrentChat();
        
        toastr.success(`ExtBlocks block "${block.name}" imported.`);
    } catch (error) {
        console.log(error);
        toastr.error('Invalid JSON file.');
        return;
    }
}


async function saveBlock(block, index, isScoped) {
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];

    if (!block.id) {
        block.id = uuidv4();
    }

    if (!block.name) {
        toastr.error('Could not save block: The block name was undefined or empty!');
        return;
    }

    const existingData = array.find((e) => e.name === block.name);
    if (existingData && index == -1) {
        toastr.error('Could not save block: The block name must be unique.');
        return;
    }

    if (index !== -1) {
        array[index] = block;
    } else {
        array.push(block);
    }

    if (isScoped) {
        if (this_chid === undefined) {
            toastr.error('No character selected.');
            return;
        }
        await writeExtensionField(this_chid, 'ExtBlocks', array);
    }

    saveSettingsDebounced();
    await loadBlocks();
    await selfReloadCurrentChat();
}

async function deleteBlock({ id, isScoped }) {
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];

    const existingBlockIndex = array.findIndex((block) => block.id === id);
    if (!existingBlockIndex || existingBlockIndex !== -1) {
        array.splice(existingBlockIndex, 1);

        if (isScoped) {
            await writeExtensionField(this_chid, 'ExtBlocks', array);
        }

        saveSettingsDebounced();
        await loadBlocks();
        await selfReloadCurrentChat();
    }
}


async function loadBlocks() {
    $('#ExtBlocks-blocks-global-list').empty();
    $('#ExtBlocks-blocks-scoped-list').empty();

    await refreshSettings();

    const blockTemplate = $(await renderExtensionTemplateAsync(templates_path, 'block'));

    function renderBlock(container, block, isScoped, index) {
        const blockHtml = blockTemplate.clone();

        if (!block.id) {
            block.id = uuidv4();
        }

        blockHtml.attr('id', block.id);
        blockHtml.find('.ExtBlocks_block_name').text(block.name);
        blockHtml.find('.disable_ExtBlocks').prop('checked', block.disabled ?? false)
            .on('input', async function () {
                block.disabled = !!$(this).prop('checked');
                await saveBlock(block, index, isScoped);
            });
        blockHtml.find('.ExtBlocks-toggle-on').on('click', function () {
            blockHtml.find('.disable_ExtBlocks').prop('checked', true).trigger('input');
        });
        blockHtml.find('.ExtBlocks-toggle-off').on('click', function () {
            blockHtml.find('.disable_ExtBlocks').prop('checked', false).trigger('input');
        });
        blockHtml.find('.edit_existing_ExtBlocks').on('click', async function () {
            await openEditor(blockHtml.attr('id'), isScoped);
        });
        blockHtml.find('.export_ExtBlocks').on('click', async function () {
            const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
            const fileData = JSON.stringify(block, null, 4);
            download(fileData, fileName, 'application/json');
        });
        blockHtml.find('.delete_ExtBlocks').on('click', async function () {
            const confirm = await callPopup('Are you sure you want to delete this block?', 'confirm');

            if (!confirm) {
                return;
            }

            await deleteBlock({ id: block.id, isScoped });
            await loadBlocks();
        });

        $(container).append(blockHtml);
    }

    current_set.global_blocks.forEach((block, index, array) => renderBlock('#ExtBlocks-blocks-global-list', block, false, index));
    characters[this_chid]?.data?.extensions?.ExtBlocks?.forEach((block, index, array) => renderBlock('#ExtBlocks-blocks-scoped-list', block, true, index));
    if (ExtBlocks_settings.extblocks_is_enabled) {
        await createRegexForBlocks();
    }
}

async function loadAPI() {
    await refreshSettings();

    $(`#ExtBlocks-proxy-ccsource option[value="${current_set.chat_completion_source}"]`).attr('selected', true);
    $(`#ExtBlocks-proxy-preset option[value="${ExtBlocks_settings.proxy_preset}"]`).attr('selected', true);
    $(`#ExtBlocks-proxy-ccmodel option[value="${current_set.model}"]`).attr('selected', true);
    $('#ExtBlocks-proxy-temperature').val(current_set.temperature);
    $('#ExtBlocks-proxy-system').val(current_set.system_prompt);
    $('#ExtBlocks-proxy-prefill').val(current_set.assistant_prefill);
}

async function loadSettings() {
    if (!extension_settings.ExtBlocks) {
        extension_settings.ExtBlocks = defaultSettings;
    };
    await refreshSettings();

    $('#extblocks_is_enabled').prop('checked', ExtBlocks_settings.extblocks_is_enabled);

    refreshSetList();

    let proxies_name = proxies.map(obj => obj.name);
    proxies_name.forEach(function(option) {
        $('#ExtBlocks-proxy-preset').append($('<option>', {
            value: option,
            text: option
        }));
    });

    if(!proxies_name.find(p => p === ExtBlocks_settings.proxy_preset)) {
        extension_settings.ExtBlocks.proxy_preset = proxies_name[0];
    }
    
    await loadAPI();
    await loadBlocks();
}

async function openEditor(existingId, isScoped) {
    const editorHtml = $(await renderExtensionTemplateAsync(templates_path, 'editor'));
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];
    let contextItems = [];

    async function loadContextItems(editorHtml) {
        editorHtml.find('#ExtBlocks-editor-context-list').empty();
    
        const contextItemTemplate = $(await renderExtensionTemplateAsync(templates_path, 'context_item'));
    
        function renderContextItem(container, context_item, index) {
            const contextItemHtml = contextItemTemplate.clone();
    
            if (!context_item.id) {
                context_item.id = uuidv4();
            }
    
            contextItemHtml.attr('id', context_item.id);
            contextItemHtml.find('.ExtBlocks_editor_context_item_name').text(context_item.name);
            contextItemHtml.find('.delete_context_item').on('click', async function () {
                const existingContextItemIndex = contextItems.findIndex((item) => item.id === context_item.id);
                if (!existingContextItemIndex || existingContextItemIndex !== -1) {
                    contextItems.splice(existingContextItemIndex, 1);
                    await loadContextItems(editorHtml);
                }
            });
    
            editorHtml.find(container).append(contextItemHtml);
        }
    
        contextItems.forEach((context_item, index, array) => renderContextItem('#ExtBlocks-editor-context-list', context_item, index));
    }

    editorHtml.find('#ExtBlocks-editor-context-importFile').on('change', async function () {
        const inputElement = this instanceof HTMLInputElement && this;
        for (const file of inputElement.files) {
            if (!file) {
                toastr.error('No file provided.');
                return;
            }
        
            try {
                const fileText = await getFileText(file);
                contextItems = JSON.parse(fileText).items;
                await loadContextItems(editorHtml)
            } catch (error) {
                console.log(error);
                toastr.error('Invalid JSON file.');
                return;
            }
        }
        inputElement.value = '';
    });
    editorHtml.find('#ExtBlocks-editor-context-import').on('click', function () {
        editorHtml.find('#ExtBlocks-editor-context-importFile').trigger('click');
    });
    editorHtml.find('#ExtBlocks-editor-context-export').on('click', async function () {
        const fileName = `context.json`;
        const fileData = JSON.stringify({items: contextItems}, null, 4);
        download(fileData, fileName, 'application/json');
    });
    
    let existingBlockIndex = -1;
    if (existingId) {
        existingBlockIndex = array.findIndex((block) => block.id === existingId);
        if (existingBlockIndex !== -1) {
            const existingBlock = array[existingBlockIndex];
            contextItems = existingBlock.context.slice();
            if (existingBlock.name) {
                editorHtml.find('.ExtBlocks-editor-block-name').val(existingBlock.name);
            } else {
                toastr.error('This block doesn\'t have a name! Please delete it.');
                return;
            }
            editorHtml.find('.ExtBlocks-editor-block-template').val(existingBlock.template ?? '');
            editorHtml.find('.ExtBlocks-editor-block-prompt').val(existingBlock.prompt ?? '');

            editorHtml.find('input[name="user_message"]').prop('checked', existingBlock.user_message ?? false);
            editorHtml.find('input[name="char_message"]').prop('checked', existingBlock.char_message ?? true);
            editorHtml.find('input[name="period"]').val(existingBlock.period ?? 2);

            editorHtml.find('input[name="hide_display"]').prop('checked', existingBlock.hide_display ?? false);
            editorHtml.find('input[name="inject_block"]').prop('checked', existingBlock.inject_block ?? false);
            editorHtml.find('input[name="disabled"]').prop('checked', existingBlock.disabled ?? false);

            editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val(existingBlock.injection_role ?? 0);
            editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val(existingBlock.injection_position ?? 0);
            editorHtml.find('input[name="injection_depth"]').val(existingBlock.injection_depth ?? 2);
            await loadContextItems(editorHtml, existingBlock);
        }
    } else {
        editorHtml.find('input[name="disabled"]').prop('checked', false);
        editorHtml.find('input[name="char_message"]').prop('checked', true);
    }

    let sortableContextItems = [
        {
            selector: editorHtml.find('#ExtBlocks-editor-context-list'),
            setter: x => contextItems = x,
            getter: () => contextItems ?? [],
        },
    ];
    await interactiveSortData(sortableContextItems);

    editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).off('click').on('change', (event) => {
        const value = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
        if (value === 'text') {
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').show()
        } else if (value === 'last_messages') {
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').show()
        } else if (value === 'previous_block') {
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').show()
        }
    });

    editorHtml.find('.ExtBlocks-preset-context-item-add').off('click').on('click', () => {
        let context_item;
        const id = uuidv4();
        const name = String(editorHtml.find('.ExtBlocks-editor-context-builder-name').val());
        const context_type = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
        if (context_type === 'text') {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                text: String(editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val())
            };
        } else if (context_type === 'last_messages') {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                messages_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val())),
                messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val()),
                user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n'),
                user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n'),
                char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n'),
                char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n')
            };
        } else if (context_type === 'previous_block') {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                block_name: String(editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val())
            };
        }

        if (!context_item.name) {
            toastr.error('Could not save context item: The context item name was undefined or empty!');
            return;
        }

        contextItems.push(context_item);
        loadContextItems(editorHtml);
    });


    const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save', wide: true});
    if (popupResult) {
        const newBlock = {
            id: existingId ? String(existingId) : uuidv4(),
            name: String(editorHtml.find('.ExtBlocks-editor-block-name').val()),
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            template: String(editorHtml.find('.ExtBlocks-editor-block-template').val()),
            prompt: String(editorHtml.find('.ExtBlocks-editor-block-prompt').val()),
            user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
            char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
            period: parseInt(String(editorHtml.find('input[name="period"]').val())) ?? 2,
            hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
            inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
            injection_role: parseInt(String(editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val())),
            injection_position: parseInt(String(editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val())),
            injection_depth: parseInt(String(editorHtml.find('input[name="injection_depth"]').val())) ?? 4,
            context: contextItems
        };

        saveBlock(newBlock, existingBlockIndex, isScoped);
    }
}

function groupBlocksByContext(blocks) {
    const contextToString = (context) => context.map(item => item.name).join('_');

    const groupedBlocks = {};

    blocks.forEach(block => {
        const contextStr = contextToString(block.context);
        if (!groupedBlocks[contextStr]) {
            groupedBlocks[contextStr] = [];
        }
        groupedBlocks[contextStr].push(block);
    });

    return groupedBlocks;
}

function priorityCombineBlocks(globalBlocks, scopedBlocks) {
    const combined = {};
    scopedBlocks.forEach(obj => {
        combined[obj.name] = obj;
    });

    globalBlocks.forEach(obj => {
    if (!combined[obj.name]) {
        combined[obj.name] = obj;
    }
    });
    return Object.values(combined);
}

function getLastMessagesContext(item) {
    let lastMessages = chat.slice(-item.messages_count);
    let separator;
    if (item.separator == 'newline') {
        separator = '\n'
    } else if (item.separator == 'space') {
        separator = ' '
    } else {
        separator = '\n\n'
    }
    const combinedLastMessages = lastMessages.map((message, index) => {
        const is_user_message = message.is_user;
        let prefix = is_user_message ? item.user_prefix : item.char_prefix;
        prefix = substituteParamsExtended(prefix);
        let suffix = is_user_message ? item.user_suffix : item.char_suffix;
        suffix = substituteParamsExtended(suffix);
        const placement = is_user_message ? 1 : 2;
        const depth = item.messages_count - index - 1;
        return `${prefix}${getRegexedString(message.mes, placement, {depth: depth, isPrompt: true})}${suffix}`;
    }).join(separator);

    return combinedLastMessages;
}

function getBlockRegex(block_name) {
    const block_regex = new RegExp(`(?:[\\s\\S]*?(?=<${block_name}>)|$)|(?<=<\\/${block_name}>|^)[\\s\\S]*`, "g");
    return block_regex;
}

function getBlockFromMessage(message, block_name) {
    let block_regex = getBlockRegex(block_name);
    const block = message.replace(block_regex, '');
    return block;
}

function getPreviousBlockMessageId(messageId, blockConfig, may_current = false) {
    const block_period = blockConfig.period;
    const offset = may_current ? 0 : 1;
    let previous_block_message_id;
    if (blockConfig.user_message && blockConfig.char_message) {
        previous_block_message_id = messageId - offset - ((messageId - offset) % block_period);
    } else if (blockConfig.user_message) {
        previous_block_message_id = messageId - offset - ((messageId - 1 - offset) % block_period);
        if (previous_block_message_id % 2 != 1) {
            previous_block_message_id -= block_period;
        }
    } else if (blockConfig.char_message) {
        previous_block_message_id = messageId - offset - ((messageId - offset) % block_period);
        if (previous_block_message_id % 2 != 0) {
            previous_block_message_id -= block_period;
        }
    } else {
        return -1;
    }

    return previous_block_message_id;
}

function getPreviousBlockContext(item, messageId, allBlocks) {
    const previousBlockConfig = allBlocks.find(obj => obj.name === item.block_name);
    if (previousBlockConfig) {
        const previous_block_message_id = getPreviousBlockMessageId(messageId, previousBlockConfig);
        if (previous_block_message_id >= 0) {
            const previous_block_message = chat[previous_block_message_id].mes;
            const previous_block = getBlockFromMessage(previous_block_message, previousBlockConfig.name);
            return previous_block;
        }
    }

    return '';
}

function injectBlock(block, blockConfig) {
    const key = `${defaultExtPrefix} ${blockConfig.name}`;
    const position = blockConfig.injection_position;
    const role = blockConfig.injection_role;
    const depth = blockConfig.injection_depth;
    setExtensionPrompt(key, block, position, depth, true, role);
}

function flushInjects() {
    for (const key of Object.keys(extensionPrompts)) {
        if (key.startsWith(defaultExtPrefix)) {
            delete extensionPrompts[key];
        }
    }
}

function getAllBlocks() {
    const embeddedBlocks = characters[this_chid]?.data?.extensions?.ExtBlocks ?? [];
    return priorityCombineBlocks(current_set.global_blocks, embeddedBlocks);
}

function getAllEnabledBlocks() {
    return getAllBlocks().filter(item => !item.disabled);
}

async function generateBlocks(prompt) {
    let messages = [{ role: 'user', content: prompt.trim() }];
    if (current_set.system_prompt !== '') {
        messages.unshift({ role: 'system', content: substituteParamsExtended(current_set.system_prompt.trim()) });
    }
    let generate_data = {
        'messages': messages,
        'model': current_set.model,
        'temperature': current_set.temperature,
        'stream': false,
        'top_p': 1,
        'chat_completion_source': current_set.chat_completion_source,
        'max_tokens': 2048
    };
    const preset = proxies.find(p => p.name === ExtBlocks_settings.proxy_preset);
    generate_data['reverse_proxy'] = preset.url;
    generate_data['proxy_password'] = preset.password;

    if (current_set.chat_completion_source === 'claude') {
        generate_data['claude_use_sysprompt'] = true;
        generate_data['assistant_prefill'] = substituteParamsExtended(current_set.assistant_prefill);
    }

    const generate_url = '/api/backends/chat-completions/generate';
    const response = await fetch(generate_url, {
        method: 'POST',
        body: JSON.stringify(generate_data),
        headers: getRequestHeaders(),
        signal: new AbortController().signal,
    });

    if (response.ok) {
        const data = await response.json();

        if (data.error) {
            toastr.error(data.error.message || response.statusText, 'API returned an error');
            throw new Error(data);
        }

        return data;
    } else {
        throw new Error(`Got response status ${response.status}`);
    }
}

function extractMessageFromData(data) {
    if (current_set.chat_completion_source === 'openai') {
        return data.choices[0].message.content.trim();
    } else if (current_set.chat_completion_source === 'claude') {
        return data.content[0].text.trim();
    }
}

async function handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks, additionalMacro = {}) {
    const groupedBlocks = groupBlocksByContext(triggeredBlocks);

    const prompts = [];

    Object.entries(groupedBlocks).forEach(([context, blocks]) => {
        let combinedContext = '';
        let combinedTemplate = `Block(s) template:\n${blocks.map(block => substituteParamsExtended(block.template, additionalMacro)).join('\n')}`;
        let combinedPrompt = `Block(s) prompt:\n${blocks.map(block => substituteParamsExtended(block.prompt, additionalMacro)).join('\n')}`;

        if (blocks.length != 0) {
            const block = blocks[0];
            let contextStringArray = [];
            block.context.forEach((context_item) => {
                if (context_item.type === 'text') {
                    contextStringArray.push(substituteParamsExtended(context_item.text, additionalMacro));

                } else if (context_item.type === 'last_messages') {
                    contextStringArray.push(getLastMessagesContext(context_item));

                } else if (context_item.type === 'previous_block') {
                    const previousBlock = getPreviousBlockContext(context_item, messageId, allBlocks);
                    if (previousBlock !== '') {
                        contextStringArray.push(previousBlock);
                    }
                }
            });
            combinedContext = contextStringArray.join('\n');
        };
        
        const fullPrompt = `${combinedContext}\n\n\n${combinedTemplate}\n\n${combinedPrompt}`;
        prompts.push(fullPrompt);
    });
    if (prompts.length > 0) {
        toastr.info(`${defaultExtPrefix} Generating, please wait...`);
        for (let idx = 0; idx < prompts.length; idx++) {
            const blocksData = await generateBlocks(prompts[idx]);
            const blocks = extractMessageFromData(blocksData);
            chat[messageId].mes = `${chat[messageId].mes}\n${blocks}`;
            await saveChat();
        }
        toastr.success(`${defaultExtPrefix} Done!`);
        if (!isUser) {
            await selfReloadCurrentChat();
        }
    }
}

async function handleMessageTrigger(messageId, isUser) {
    const allBlocks = getAllEnabledBlocks();
    const triggeredBlocks = allBlocks.filter((block) => {
        const trigger_predicate = isUser ? block.user_message : block.char_message;
        const period_predicate = isUser ? ((messageId - 1) % block.period === 0) : (messageId % block.period === 0);
        return trigger_predicate && period_predicate;
    });
    await handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
}


async function handleUserTrigger(messageId, is_swipe = false) {
    if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
        return;
    }

    if (is_swipe) {
        chat[messageId].mes = runRegexScript(blocksPurgeScript, chat[messageId].mes);
        await saveChat();
    }

    await handleMessageTrigger(messageId, true);
    flushInjects();
    const allBlocks = getAllEnabledBlocks();
    allBlocks.forEach(blockConfig => {
        if (blockConfig.inject_block) {
            const mes_id = getPreviousBlockMessageId(messageId, blockConfig, true);
            if (mes_id >= 0) {
                const previous_block_message = chat[mes_id].mes;
                const previous_block = getBlockFromMessage(previous_block_message, blockConfig.name);
                injectBlock(previous_block, blockConfig);
            }
        }
    });
}

async function handleCharTrigger(messageId) {
    if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
        return;
    }

    if (['...', ''].includes(chat[messageId]?.mes)) {
        return;
    }

    if (messageId == 0) {
        return;
    }

    await handleMessageTrigger(messageId, false);
}

async function runBlockGenerationCallback(args, additional_prompt) {
    if (!args.name) {
        toastr.warning(`No block name provided`);
        return '';
    }
    const block_name = args.name;

    const allBlocks = getAllBlocks();
    const block = allBlocks.find((e) => e.name === block_name);
    if (block) {
        const messageId = chat.length - 1;
        const isUser = block.user_message && !block.char_message;
        let additionalMacro = {};
        if (additional_prompt !== '') {
            additionalMacro = { additionalPrompt: additional_prompt }
        }
        await handleBlocksGeneration(messageId, isUser, allBlocks, [block], additionalMacro);
    } else {
        toastr.warning(`Block "${block_name}" not found.`);
    }
    return '';
}

async function setupListeners() {
    $('#extblocks_is_enabled').off('click').on('click', async () => {
        const value = $('#extblocks_is_enabled').prop('checked');
        extension_settings.ExtBlocks.extblocks_is_enabled = value;
        if (value) {
            await createRegexForBlocks();
        } else {
            await purgeRegexForBlocks();
        }
        saveSettingsDebounced();
    });
    $('#ExtBlocks-preset-list').off('click').on('change', async function () {
        const idx = $('#ExtBlocks-preset-list').prop('selectedIndex');
        await changeSet(idx);
    });

    $('#ExtBlocks-preset-new').on('click', async function () {
        let newSetHtml = $(await renderExtensionTemplateAsync(templates_path, 'new_set_popup'));
        const popupResult = await callPopup(newSetHtml, 'confirm', undefined, { okButton: 'Save' });
        if (popupResult) {
            let newSet = await getDefaultSet();
            newSet.name = String(newSetHtml.find('.ExtBlocks-newset-name').val());
            const set_idx = updateOrInsert(extension_settings.ExtBlocks.sets, newSet);
            changeSet(set_idx);
        }
    });
    $('#ExtBlocks-preset-importFile').on('change', async function () {
        const inputElement = this instanceof HTMLInputElement && this;
        for (const file of inputElement.files) {
            await importSet(file);
        }
        inputElement.value = '';
    });
    $('#ExtBlocks-preset-import').on('click', function () {
        $('#ExtBlocks-preset-importFile').trigger('click');
    });
    $('#ExtBlocks-preset-export').on('click', async function () {
        const fileName = `${current_set.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
        const fileData = JSON.stringify(current_set, null, 4);
        download(fileData, fileName, 'application/json');
    });
    $('#ExtBlocks-preset-delete').on('click', async function () {
        const confirm = await callPopup('Are you sure you want to delete this set?', 'confirm');

        if (!confirm) {
            return;
        }

        extension_settings.ExtBlocks.sets.splice(extension_settings.ExtBlocks.active_set_idx, 1);
        if (extension_settings.ExtBlocks.sets.length != 0) {
            changeSet(0);
        } else {
            const set_idx = updateOrInsert(extension_settings.ExtBlocks.sets, await getDefaultSet());
            changeSet(set_idx);
        }

    });


    $('#ExtBlocks-proxy-toggle').off('click').on('click', function () {
        $('#ExtBlocks-proxy').slideToggle(200, 'swing');
    });
    $('#ExtBlocks-proxy-ccsource').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-ccsource').val();
        extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].chat_completion_source = value;
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-preset').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-preset').val();
        extension_settings.ExtBlocks.proxy_preset = value;
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-ccmodel').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-ccmodel').val();
        extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].model = value;
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-temperature').off('click').on('input', function () {
        const value = $('#ExtBlocks-proxy-temperature').val();
        extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].temperature = parseFloat(String(value));
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-system').off('click').on('input', function () {
        const value = $('#ExtBlocks-proxy-system').val();
        extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].system_prompt = String(value);
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-prefill').off('click').on('input', function () {
        const value = $('#ExtBlocks-proxy-prefill').val();
        extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].assistant_prefill = String(value);
        saveSettingsDebounced();
    });


    $('#ExtBlocks-blocks-global-openeditor').off('click').on('click', () => {
        openEditor(false, false);
    });
    $('#ExtBlocks-blocks-scoped-openeditor').off('click').on('click', () => {
        if (this_chid === undefined) {
            toastr.error('No character selected.');
            return;
        }

        if (selected_group) {
            toastr.error('Cannot edit embedded blocks in group chats.');
            return;
        }
        openEditor(false, true);
    });

    $('#ExtBlocks-blocks-global-import-file').on('change', async function () {
        const inputElement = this instanceof HTMLInputElement && this;
        for (const file of inputElement.files) {
            await importBlock(file, false);
        }
        inputElement.value = '';
    });
    $('#ExtBlocks-blocks-global-import').on('click', function () {
        $('#ExtBlocks-blocks-global-import-file').trigger('click');
    });

    $('#ExtBlocks-blocks-scoped-import-file').on('change', async function () {
        const inputElement = this instanceof HTMLInputElement && this;
        for (const file of inputElement.files) {
            await importBlock(file, true);
        }
        inputElement.value = '';
    });
    $('#ExtBlocks-blocks-scoped-import').on('click', function () {
        $('#ExtBlocks-blocks-scoped-import-file').trigger('click');
    });


    let sortableBlocks = [
        {
            selector: '#ExtBlocks-blocks-global-list',
            setter: x => extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks = x,
            getter: () => extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks ?? [],
        },
        {
            selector: '#ExtBlocks-blocks-scoped-list',
            setter: x => writeExtensionField(this_chid, 'ExtBlocks', x),
            getter: () => characters[this_chid]?.data?.extensions?.ExtBlocks ?? [],
        },
    ];
    await interactiveSortData(sortableBlocks);
}

jQuery(async () => {
    $('#extensions_settings').append(await renderExtensionTemplateAsync(path, 'settings'));
    await loadSettings();
    await setupListeners();
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (self_reload_flag) {
            self_reload_flag = false;
        } else {
            loadBlocks();
        }
    });
    eventSource.on(event_types.USER_MESSAGE_RENDERED, handleUserTrigger);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleCharTrigger);
    eventSource.on(event_types.MESSAGE_SWIPED, async (messageId) => await handleUserTrigger(messageId -1, true));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'extblocks-generate',
        callback: runBlockGenerationCallback,
        returns: 'void',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'block name',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            }),
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'additional prompt', [ARGUMENT_TYPE.STRING], false, false, ''
            ),
        ],
        helpString: 'Starts generating a block by its name.',
    }));
    console.log(`${defaultExtPrefix} extension loaded`);
});
