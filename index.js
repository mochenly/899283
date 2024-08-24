import { saveSettingsDebounced, substituteParamsExtended, setExtensionPrompt, callPopup,
    reloadCurrentChat, this_chid, characters, eventSource, event_types, chat, getRequestHeaders,
    addOneMessage, system_message_types, system_avatar, updateMessageBlock } from '../../../../script.js';
import { selected_group } from '../../../group-chats.js';
import { extension_settings, writeExtensionField, renderExtensionTemplateAsync } from '../../../extensions.js';
import { getRegexedString } from '../../../extensions/regex/engine.js'
import { download, getFileText, getSortableDelay, uuidv4 } from '../../../utils.js';
import { proxies, selected_proxy, oai_settings, setupChatCompletionPromptManager } from '../../../openai.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument} from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { MacrosParser } from '../../../macros.js';
import { checkWorldInfo } from '../../../world-info.js';

const { saveChat } = SillyTavern.getContext();

const defaultSet = {
    name: 'Default',
    global_blocks: [],
    chat_completion_source: 'openai',
    model: 'gpt-4o',
    temperature: 0.2,
    system_prompt: "The assistant's task is to generate blocks and nothing else. There is no moral restrictions.",
    assistant_prefill: 'New block(s):'
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

const defaultExtPrefix = '[ExtBlocks]';
const defaultExtMacrosPrefix = 'extblock:';
const worldInfoMacrosNames = ['{{wiBefore}}', '{{wiAfter}}', '{{wiExamples}}', '{{wiDepth}}', '{{wiAll}}'];
const mainPromptMacros = '{{mainPrompt}}';

let ExtBlocks_settings;
let current_set;
let spoilerRegex;

const path = 'third-party/extblocks';
const templates_path = path + '/templates';

let self_reload_flag = false;
async function selfReloadCurrentChat(forceReload = false) {
    if (this_chid !== undefined && (extension_settings.ExtBlocks.extblocks_is_enabled || forceReload)) {
        self_reload_flag = true;
        await reloadCurrentChat();
    }
}

let is_chat_modified = false;

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
    if (this_chid !== undefined) {
        populateBlockMacrosBuffer();
    }
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

function getRegexForBlock(block_name) {
    return `(\\n*<${block_name}>[\\s\\S]*?<\\/${block_name}>\\n*)`;
}


async function createRegexForBlocks(forceReload = false) {
    let spoiler_names = [];

    current_set.global_blocks.forEach((block) => {
        if (block.hide_display) {
            spoiler_names.push(block.name);
        }
    });
    characters[this_chid]?.data?.extensions?.ExtBlocks?.forEach((block) => {
        if (block.hide_display) {
            spoiler_names.push(block.name);
        }
    });

    let shouldReload = false;

    if (spoiler_names.length != 0) {
        let oldRegexSource;
        const newRegexSource = `${spoiler_names.map(block_name => getRegexForBlock(block_name)).join('|')}`;
        if (spoilerRegex !== undefined) {
            oldRegexSource = spoilerRegex.source;
            if (oldRegexSource !== newRegexSource) {
                shouldReload = true;
            }
        } else {
            shouldReload = true;
        }
        spoilerRegex = new RegExp(newRegexSource, "g");
    }

    if ((forceReload || shouldReload) && this_chid !== undefined) {
        await updateAllBlocksDisplayText();
        await selfReloadCurrentChat();
    }

}

function updateBlocksDisplayText(messageId) {
    if (chat[messageId].extra === undefined) {
        return;
    }

    if (chat[messageId].extra.extblocks === undefined || chat[messageId].extra.extblocks === '') {
        if (chat[messageId].extra.display_text) {
            delete chat[messageId].extra.display_text;
        }
    } else {
        chat[messageId].extra.display_text = chat[messageId].mes + `\n${chat[messageId].extra.extblocks.replaceAll(spoilerRegex, '')}`;
    }
}

async function updateAllBlocksDisplayText() {
    for (let messageId = 0; messageId < chat.length; messageId++) {
        updateBlocksDisplayText(messageId);
    }

    await saveChat();
}

function purgeBlocksDisplayText(messageId) {
    if (chat[messageId].extra === undefined) {
        return;
    }

    if (chat[messageId].extra.display_text) {
        delete chat[messageId].extra.display_text;
    }

}

async function purgeAllBlocksDisplayText() {
    for (let messageId = 0; messageId < chat.length; messageId++) {
        purgeBlocksDisplayText(messageId);
    }

    await saveChat();
}

async function updateBlocksDisplay(messageId) {
    updateBlocksDisplayText(messageId);
    updateMessageBlock(messageId, chat[messageId]);
    await saveChat();
}

async function addBlocksToExtra(messageId, blocksStr) {
    if (chat[messageId].extra === undefined) {
        chat[messageId].extra = {};
    }

    if (chat[messageId].extra.extblocks === undefined || chat[messageId].extra.extblocks === '') {
        chat[messageId].extra.extblocks = blocksStr;

    } else {
        chat[messageId].extra.extblocks += `\n${blocksStr}`;
    }

    if (chat[messageId].swipe_id) {
        const current_swipe_id = chat[messageId].swipe_id;

        if (chat[messageId].swipe_info[current_swipe_id] === undefined) {
            chat[messageId].swipe_info[current_swipe_id] = {};
        }

        if (chat[messageId].swipe_info[current_swipe_id].extra === undefined) {
            chat[messageId].swipe_info[current_swipe_id].extra = {};
        }
    
        if (chat[messageId].swipe_info[current_swipe_id].extra.extblocks === undefined || chat[messageId].swipe_info[current_swipe_id].extra.extblocks === '') {
            chat[messageId].swipe_info[current_swipe_id].extra.extblocks = blocksStr;
    
        } else {
            chat[messageId].swipe_info[current_swipe_id].extra.extblocks += `\n${blocksStr}`;
        }
    }

    await updateBlocksDisplay(messageId);
}

async function appendStringToExtraCallback(_, blocksStr) {
    await addBlocksToExtra(chat.length - 1, blocksStr);
    return '';
}

async function purgeBlocksExtra(messageId, no_update = false) {
    if (chat[messageId].extra === undefined) {
        return;
    }

    if (chat[messageId].extra.extblocks) {
        chat[messageId].extra.extblocks = '';
    }

    if (chat[messageId].swipe_id) {
        const current_swipe_id = chat[messageId].swipe_id;
        if (chat[messageId].swipe_info[current_swipe_id] && chat[messageId].swipe_info[current_swipe_id].extra) {
            if (chat[messageId].swipe_info[current_swipe_id].extra.extblocks) {
                chat[messageId].swipe_info[current_swipe_id].extra.extblocks = '';
            }
        }
    }

    if (!no_update) {
        await updateBlocksDisplay(messageId);
    }
}

async function purgeExtraCallback() {
    await purgeBlocksExtra(chat.length - 1);
    return '';
}

async function swipeBlockExtra(messageId, swipeId) {
    if (chat[messageId].swipe_info[swipeId] && chat[messageId].swipe_info[swipeId].extra && chat[messageId].swipe_info[swipeId].extra.extblocks) {
        chat[messageId].extra.extblocks = chat[messageId].swipe_info[swipeId].extra.extblocks;
    } else {
        chat[messageId].extra.extblocks = '';
    }

    await updateBlocksDisplay(messageId);
}

function firstSwipeBlockExtra(messageId) {
    if (chat[messageId].extra.extblocks) {
        chat[messageId].swipe_info[0].extra.extblocks = chat[messageId].extra.extblocks;
    } else {
        chat[messageId].swipe_info[0].extra.extblocks = '';
    }
}


async function checkBlocksInFirstMessage() {
    const allBlocks = getAllBlocks();
    const allBlocksEncloseRegex = allBlocks.map(block => getBlockEncloseRegex(block.name));
    const allBlocksPurgeRegex = new RegExp(`${allBlocks.map(block => getRegexForBlock(block.name)).join('|')}`, 'g');

    let blocksStr = '';
    for (let idx = 0; idx < allBlocks.length; idx++) {
        const encloseRegex = allBlocksEncloseRegex[idx];
        const enclosedBlock = chat[0].mes.replace(encloseRegex, '');
        if (enclosedBlock !== '') {
            blocksStr += blocksStr === '' ? enclosedBlock : `\n${enclosedBlock}`
        }
    }

    if (blocksStr !== '') {
        blocksStr = blocksStr.replaceAll(/\r/g, '');
        chat[0].mes = chat[0].mes.replaceAll(allBlocksPurgeRegex, '');
        await addBlocksToExtra(0, blocksStr);
    }
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
        if (this_chid !== undefined) {
            insertBlockMacros(block);
        }
        
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

    if (block.inject_block && block.disabled) {
        injectEmptyBlock(block);
    }

    saveSettingsDebounced();
    await loadBlocks();
    if (this_chid !== undefined) {
        insertBlockMacros(block);
    }
}

async function deleteBlock({ id, isScoped }) {
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];

    const existingBlockIndex = array.findIndex((block) => block.id === id);
    if (!existingBlockIndex || existingBlockIndex !== -1) {
        const block_name = array[existingBlockIndex].name;
        array.splice(existingBlockIndex, 1);

        if (isScoped) {
            await writeExtensionField(this_chid, 'ExtBlocks', array);
        }

        saveSettingsDebounced();
        await loadBlocks();
        if (this_chid !== undefined) {
            deleteBlockMacros(block_name);
        }
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

        let block_type = block.block_type;
        let editor_func;
        if (block_type === undefined) {
            block_type = 'generated';
        }

        if (block_type === 'generated') {
            blockHtml.find('.ExtBlocks-block-atype-icon').hide();
            editor_func = openEditor;
            blockHtml.find('.export_prompt_ExtBlocks').on('click', async function () {
                const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                const fileData = JSON.stringify({fullPrompt: await checkAllMacros(getSingleBlockFullPrompt(block))}, null, 4);
                download(fileData, fileName, 'application/json');
            });
        } else if (block_type === 'accumulation') {
            blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
            blockHtml.find('.export_prompt_ExtBlocks').hide();
            editor_func = openAccumulationEditor;
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
            await editor_func(blockHtml.attr('id'), isScoped);
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

    current_set.global_blocks.forEach((block, index) => renderBlock('#ExtBlocks-blocks-global-list', block, false, index));
    characters[this_chid]?.data?.extensions?.ExtBlocks?.forEach((block, index) => renderBlock('#ExtBlocks-blocks-scoped-list', block, true, index));
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
    let editingContextItemIndex = -1;
    let isResettingType = false;

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
            contextItemHtml.find('.edit_context_item').on('click', async function () {
                editingContextItemIndex = index;
                loadContextItemForEditing(context_item);
            });
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

    function loadContextItemForEditing(context_item) {
        editorHtml.find('.ExtBlocks-editor-context-builder-name').val(context_item.name);

        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).off('change', handleContextItemTypeChange);
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val(context_item.type).trigger('change');
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).on('change', handleContextItemTypeChange);

        if (context_item.type === 'text') {
            editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val(context_item.text);
        } else if (context_item.type === 'last_messages') {
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val(context_item.messages_count);
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val(context_item.messages_separator);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val(context_item.user_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val(context_item.user_suffix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val(context_item.char_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val(context_item.char_suffix);
        } else if (context_item.type === 'last_messages_keyword') {
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val(context_item.keyword_stopper);
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val(context_item.messages_separator);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val(context_item.user_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val(context_item.user_suffix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val(context_item.char_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val(context_item.char_suffix);
        } else if (context_item.type === 'previous_block') {
            editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val(context_item.block_name);
        }

        editorHtml.find('#ExtBlocks-editor-context-item-new').hide();
        editorHtml.find('#ExtBlocks-editor-context-item-save').show();
        editorHtml.find('#ExtBlocks-editor-context-item-exit').show();
    }

    function exitEditMode(context_type='text') {
        editingContextItemIndex = -1;
        editorHtml.find('.ExtBlocks-editor-context-builder-name').val('');

        editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val('');
        editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val('');
        editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val('double_newline');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val('');

        isResettingType = true;
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val(context_type).trigger('change');
        isResettingType = false;

        editorHtml.find('#ExtBlocks-editor-context-item-new').show();
        editorHtml.find('#ExtBlocks-editor-context-item-save').hide();
        editorHtml.find('#ExtBlocks-editor-context-item-exit').hide();
    }

    function handleContextItemTypeChange() {
        if (isResettingType) return;

        const value = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
        if (value === 'text') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').show()
        } else if (value === 'last_messages') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').show()
        } else if (value === 'previous_block') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').show()
        } else if (value === 'last_messages_keyword') {
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').show()
        }
        exitEditMode(value);
    }

    editorHtml.find('#ExtBlocks-editor-context-item-save').off('click').on('click', () => {
        if (editingContextItemIndex !== -1) {
            let context_item;
            const id = contextItems[editingContextItemIndex].id;
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
                    messages_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val())) || 10,
                    messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val()),
                    user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n'),
                    user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n'),
                    char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n'),
                    char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n')
                };
            } else if (context_type === 'last_messages_keyword') {
                context_item = {
                    id: id,
                    name: name,
                    type: context_type,
                    keyword_stopper: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val()) || '',
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

            contextItems[editingContextItemIndex] = context_item;
            loadContextItems(editorHtml);
            exitEditMode();
        }
    });

    editorHtml.find('#ExtBlocks-editor-context-item-exit').off('click').on('click', () => {
        exitEditMode();
    });

    editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).off('change').on('change', handleContextItemTypeChange);

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

    function changeTriggerPeriodicity(trigger_periodicity) {
        if (trigger_periodicity === "keyword") {
            editorHtml.find('.Extblocks-editor-period-wrapper').hide();
            editorHtml.find('.Extblocks-editor-keyword-wrapper').show();
        } else {
            editorHtml.find('.Extblocks-editor-period-wrapper').show();
            editorHtml.find('.Extblocks-editor-keyword-wrapper').hide();
        }
    }
    
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

            const block_keyword = existingBlock.keyword;
            const trigger_periodicity = (block_keyword && block_keyword !== '') ? "keyword" : "periodic";
            editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val(trigger_periodicity);
            editorHtml.find('input[name="period"]').val(existingBlock.period ?? 2);
            editorHtml.find('input[name="keyword"]').val(block_keyword ?? '');
            changeTriggerPeriodicity(trigger_periodicity);
            
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
        editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val('periodic');
        changeTriggerPeriodicity('periodic');
    }

    editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).off('click').on('change', (event) => {
        const value = editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val();
        changeTriggerPeriodicity(value);
    });

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
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').show()
        } else if (value === 'last_messages') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').show()
        } else if (value === 'previous_block') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').show()
        } else if (value === 'last_messages_keyword') {
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').show()
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
                messages_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val())) || 10,
                messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val()),
                user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n'),
                user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n'),
                char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n'),
                char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n')
            };
        } else if (context_type === 'last_messages_keyword') {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                keyword_stopper: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val()) || '',
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
        const trigger_periodicity = editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val();
        const block_keyword = trigger_periodicity === 'keyword' ? String(editorHtml.find('input[name="keyword"]').val() || '') : '';
        const newBlock = {
            id: existingId ? String(existingId) : uuidv4(),
            block_type: 'generated',
            name: String(editorHtml.find('.ExtBlocks-editor-block-name').val()),
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            template: String(editorHtml.find('.ExtBlocks-editor-block-template').val()),
            prompt: String(editorHtml.find('.ExtBlocks-editor-block-prompt').val()),
            user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
            char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
            period: parseInt(String(editorHtml.find('input[name="period"]').val() || 2)),
            keyword: block_keyword,
            hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
            inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
            injection_role: parseInt(String(editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val())),
            injection_position: parseInt(String(editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val())),
            injection_depth: parseInt(String(editorHtml.find('input[name="injection_depth"]').val() || 4)),
            context: contextItems
        };

        saveBlock(newBlock, existingBlockIndex, isScoped);
    }
}

async function openAccumulationEditor(existingId, isScoped) {
    const editorHtml = $(await renderExtensionTemplateAsync(templates_path, 'accumulation_editor'));
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];

    let existingBlockIndex = -1;
    if (existingId) {
        existingBlockIndex = array.findIndex((block) => block.id === existingId);
        if (existingBlockIndex !== -1) {
            const existingBlock = array[existingBlockIndex];
            if (existingBlock.name) {
                editorHtml.find('.ExtBlocks-accumulationeditor-block-name').val(existingBlock.name);
            } else {
                toastr.error('This block doesn\'t have a name! Please delete it.');
                return;
            }

            editorHtml.find('.ExtBlocks-accumulationeditor-blockupdater-name').val(existingBlock.updater_name);

            editorHtml.find('input[name="user_message"]').prop('checked', existingBlock.user_message ?? false);
            editorHtml.find('input[name="char_message"]').prop('checked', existingBlock.char_message ?? true);
            
            editorHtml.find('input[name="hide_display"]').prop('checked', existingBlock.hide_display ?? false);
            editorHtml.find('input[name="inject_block"]').prop('checked', existingBlock.inject_block ?? false);
            editorHtml.find('input[name="disabled"]').prop('checked', existingBlock.disabled ?? false);

            editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-role"]`).val(existingBlock.injection_role ?? 0);
            editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-position"]`).val(existingBlock.injection_position ?? 0);
            editorHtml.find('input[name="injection_depth"]').val(existingBlock.injection_depth ?? 2);
        }
    } else {
        editorHtml.find('input[name="disabled"]').prop('checked', false);
        editorHtml.find('input[name="char_message"]').prop('checked', true);
    }

    const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save'});
    if (popupResult) {
        const newBlock = {
            id: existingId ? String(existingId) : uuidv4(),
            block_type: 'accumulation',
            name: String(editorHtml.find('.ExtBlocks-accumulationeditor-block-name').val()),
            updater_name: String(editorHtml.find('.ExtBlocks-accumulationeditor-blockupdater-name').val()),
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
            char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
            hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
            inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
            injection_role: parseInt(String(editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-role"]`).val())),
            injection_position: parseInt(String(editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-position"]`).val())),
            injection_depth: parseInt(String(editorHtml.find('input[name="injection_depth"]').val() || 4)),
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
    let lastMessages;
    let messages_count = item.messages_count;
    if (messages_count === undefined) {
        const keyword_stopper = item.keyword_stopper;
        if (keyword_stopper && keyword_stopper !== '') {
            let lastMessageId = chat.slice(0, -1).findLastIndex(message => message.mes.includes(keyword_stopper));
            if (lastMessageId == -1) {
                lastMessageId = 0;
            }
            messages_count = chat.length - lastMessageId;
        } else {
            return '';
        }
    }
    if (messages_count > 0) {
        lastMessages = chat.slice(-messages_count);
    } else if (messages_count < 0) {
        lastMessages = chat.slice(0, -messages_count);
    } else {
        return '';
    }
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
        const depth = messages_count - index - 1;
        return `${prefix}${getRegexedString(message.mes, placement, {depth: depth, isPrompt: true})}${suffix}`;
    }).join(separator);

    return combinedLastMessages;
}

function getBlockEncloseRegex(block_name) {
    const block_regex = new RegExp(`(?:[\\s\\S]*?(?=<${block_name}>)|$)|(?<=<\\/${block_name}>|^)[\\s\\S]*`, "g");
    return block_regex;
}

function getBlockFromMessageWithRegex(message, block_regex) {
    let block = message.replace(block_regex, '');
    block = block.replace(/^<+/, '<');
    return block;
}

function getBlockFromMessage(message, block_name) {
    const block_regex = getBlockEncloseRegex(block_name);
    return getBlockFromMessageWithRegex(message, block_regex);
}

function getMultiBlockContentFromMessage(message, block_name) {
    const block_regex = new RegExp(`(?:(?<=^)|(?<=<\\/${block_name}>))([\\s\\S]*?)(?=<${block_name}>|$)|<${block_name}>\\n*|<\\/${block_name}>`, "g");
    return getBlockFromMessageWithRegex(message, block_regex).trim();
}

function getPreviousBlockMessageId(messageId, blockConfig, may_current = false) {
    const block_keyword = blockConfig.keyword;
    let previous_block_message_id;
    if (block_keyword && block_keyword !== '') {
        const block_regex = getBlockEncloseRegex(blockConfig.name);
        const lastMessageId = chat.slice(0, messageId + 1).findLastIndex((message) => getBlockFromMessageWithRegex(message.extra?.extblocks ?? '', block_regex) !== '');
        return lastMessageId;
    } else if (blockConfig.block_type === 'accumulation') {
        const block_regex = getBlockEncloseRegex(blockConfig.name);
        const lastMessageId = chat.slice(0, messageId + 1).findLastIndex((message) => getBlockFromMessageWithRegex(message.extra?.extblocks ?? '', block_regex) !== '');
        return lastMessageId;
    } else {
        const block_period = blockConfig.period;
        const offset = may_current ? 0 : 1;
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
    }

    return previous_block_message_id;
}

function getPreviousBlockContext(item, messageId, allBlocks) {
    const previousBlockConfig = allBlocks.find(obj => obj.name === item.block_name);
    if (previousBlockConfig) {
        return getPreviousBlockContextUnconditional(previousBlockConfig, messageId);
    }

    return '';
}

function getPreviousBlockContextUnconditional(block, messageId, may_current = false) {
    const previous_block_message_id = getPreviousBlockMessageId(messageId, block, may_current);
    if (previous_block_message_id >= 0) {
        if (chat[previous_block_message_id].extra && chat[previous_block_message_id].extra.extblocks) {
            const previous_block_message = chat[previous_block_message_id].extra.extblocks;
            const previous_block = getBlockFromMessage(previous_block_message, block.name);
            if (previous_block === '' && may_current) {
                return getPreviousBlockContextUnconditional(block, messageId);
            } else {
                return previous_block;
            }
        }
    }
    return '';
}


function injectBlock(block, blockConfig) {
    const key = `${defaultExtPrefix} ${blockConfig.name}`;
    const position = blockConfig.injection_position;
    const role = blockConfig.injection_role;
    let depth = blockConfig.injection_depth;
    if (depth < 0) {
        depth = chat.length - depth;
    }
    setExtensionPrompt(key, block, position, depth, true, role);
}

function injectEmptyBlock(blockConfig) {
    const key = `${defaultExtPrefix} ${blockConfig.name}`;
    const position = blockConfig.injection_position;
    const role = blockConfig.injection_role;
    let depth = blockConfig.injection_depth;
    if (depth < 0) {
        depth = chat.length - depth;
    }
    setExtensionPrompt(key, '', position, depth, true, role);
}

function getAllBlocks() {
    const embeddedBlocks = characters[this_chid]?.data?.extensions?.ExtBlocks ?? [];
    return priorityCombineBlocks(current_set.global_blocks, embeddedBlocks);
}

function getAllGeneratedBlocks() {
    const allBlocks = getAllBlocks();
    return allBlocks.filter(block => block.block_type !== 'accumulation');
}

function getAllEnabledBlocks() {
    const allBlocks = getAllBlocks();
    return allBlocks.filter(item => !item.disabled);
}

function insertBlockMacros(block) {
    const getBlockContext = () => getPreviousBlockContextUnconditional(block, chat.length - 1, true);
    const blockKey = `${defaultExtMacrosPrefix}${block.name}`;
    MacrosParser.registerMacro(blockKey, getBlockContext);
}

function deleteBlockMacros(block_name) {
    const blockKey = `${defaultExtMacrosPrefix}${block_name}`;
    MacrosParser.unregisterMacro(blockKey);
}

function purgeAllBlocksMacros() {
    const dummyEnv = {};
    MacrosParser.populateEnv(dummyEnv);
    const macrosKeys = Object.keys(dummyEnv);
    const extBlocksKeys = macrosKeys.filter(key => key.includes(defaultExtMacrosPrefix));
    extBlocksKeys.forEach(key => {
        deleteBlockMacros(key.split(':')[1]);
    });
}

function populateBlockMacrosBuffer() {
    purgeAllBlocksMacros();
    const allBlocks = getAllEnabledBlocks();
    allBlocks.forEach((block) => {
        insertBlockMacros(block);
    });
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
    if (current_set.chat_completion_source === 'openai' || current_set.chat_completion_source === 'mistralai') {
        return data.choices[0].message.content.trim();
    } else if (current_set.chat_completion_source === 'claude') {
        return data.content[0].text.trim();
    }
}


function getBlockCombinedContext(block, messageId, allBlocks, additionalMacro = {}) {
    let contextStringArray = [];
    block.context.forEach((context_item) => {
        if (context_item.type === 'text') {
            contextStringArray.push(substituteParamsExtended(context_item.text, additionalMacro));

        } else if (context_item.type === 'last_messages' || context_item.type === 'last_messages_keyword') {
            const lastMessages = getLastMessagesContext(context_item);
            if (lastMessages != '') {
                contextStringArray.push(lastMessages);
            }

        } else if (context_item.type === 'previous_block') {
            const previousBlock = getPreviousBlockContext(context_item, messageId, allBlocks);
            if (previousBlock !== '') {
                contextStringArray.push(previousBlock);
            }
        }
    });
    return contextStringArray.join('\n');
}

function getSingleBlockFullPrompt(block) {
    if (this_chid === undefined) {
        return ''
    }
    const messageId = chat.length - 1;
    const allBlocks = getAllEnabledBlocks();
    const blockTemplate = `Block(s) template:\n${substituteParamsExtended(block.template)}`;
    const blockPrompt = `Block(s) prompt:\n${substituteParamsExtended(block.prompt)}`;
    const blockContext = getBlockCombinedContext(block, messageId, allBlocks);

    return `${blockContext}\n\n\n${blockTemplate}\n\n${blockPrompt}`;
}


async function checkWorldInfoMacros(prompt) {
    const containsWorldInfoMacros = worldInfoMacrosNames.some(wiMacros => prompt.includes(wiMacros));
    if (containsWorldInfoMacros && this_chid !== undefined) {
        const promptChat = [ prompt ];
        const maxContext = 2e5;
        const activatedWorldInfo = await checkWorldInfo(promptChat, maxContext, true);
        let worldInfoAll = [];
        let worldInfoBefore = activatedWorldInfo.worldInfoBefore;
        if (worldInfoBefore !== '') {
            worldInfoAll.push(worldInfoBefore);
        }
        let worldInfoAfter = activatedWorldInfo.worldInfoAfter;
        if (worldInfoAfter !== '') {
            worldInfoAll.push(worldInfoAfter);
        }
        let worldInfoExamples = activatedWorldInfo.EMEntries ?? [];
        if (worldInfoExamples.length !== 0) {
            worldInfoExamples = worldInfoExamples.map(item => item.content).join('\n\n');
            worldInfoAll.push(worldInfoExamples);
        } else {
            worldInfoExamples = '';
        }
        let worldInfoDepth = activatedWorldInfo.WIDepthEntries ?? [];
        if (worldInfoDepth.length !== 0) {
            worldInfoDepth = worldInfoDepth.map(item => item.entries.join('\n')).join('\n\n');
            worldInfoAll.push(worldInfoDepth);
        } else {
            worldInfoDepth = '';
        }
        worldInfoAll = worldInfoAll.join('\n\n');

        prompt = prompt.replace(/{{wiBefore}}/gi, worldInfoBefore);
        prompt = prompt.replace(/{{wiAfter}}/gi, worldInfoAfter);
        prompt = prompt.replace(/{{wiExamples}}/gi, worldInfoExamples);
        prompt = prompt.replace(/{{wiDepth}}/gi, worldInfoDepth);
        prompt = prompt.replace(/{{wiAll}}/gi, worldInfoAll);
    }

    return prompt;
}

function checkMainPromptMacros(prompt) {
    if (prompt.includes(mainPromptMacros)) {
        const promptCollection = setupChatCompletionPromptManager(oai_settings).getPromptCollection();
        let mainPrompt = promptCollection.collection.find(prompt => prompt.identifier === 'main');
        if (mainPrompt) {
            mainPrompt = mainPrompt.content;
        } else {
            mainPrompt = '';
        }

        prompt = prompt.replace(/{{mainPrompt}}/gi, mainPrompt);
    }

    return prompt;
}

async function checkAllMacros(prompt) {
    prompt = await checkWorldInfoMacros(prompt);
    prompt = checkMainPromptMacros(prompt);
    return prompt;
}

async function handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks, additionalMacro = {}, is_separate = false) {
    const groupedBlocks = groupBlocksByContext(triggeredBlocks);

    const prompts = [];

    for (let context in groupedBlocks) {
        const blocks = groupedBlocks[context];
        let combinedContext = '';
        let combinedTemplate = `Block(s) template:\n${blocks.map(block => substituteParamsExtended(block.template, additionalMacro)).join('\n')}`;
        let combinedPrompt = `Block(s) prompt:\n${blocks.map(block => substituteParamsExtended(block.prompt, additionalMacro)).join('\n')}`;

        if (blocks.length != 0) {
            const block = blocks[0];
            combinedContext = getBlockCombinedContext(block, messageId, allBlocks, additionalMacro);
        };
        
        let fullPrompt = `${combinedContext}\n\n\n${combinedTemplate}\n\n${combinedPrompt}`;
        fullPrompt = await checkAllMacros(fullPrompt);
        prompts.push(fullPrompt);
    }
    
    if (prompts.length > 0) {
        toastr.info(`${defaultExtPrefix} Generating, please wait...`);
        for (let idx = 0; idx < prompts.length; idx++) {
            const blocksData = await generateBlocks(prompts[idx]);
            const blocks = extractMessageFromData(blocksData);
            if (!is_separate) {
                await addBlocksToExtra(messageId, blocks);
            } else {
                const message = {
                    name: 'System',
                    is_user: false,
                    is_system: true,
                    mes: blocks,
                    force_avatar: system_avatar,
                    extra: {
                        type: system_message_types.NARRATOR,
                        bias: null,
                        gen_id: Date.now(),
                        api: 'manual',
                        model: 'slash command',
                    },
                };
                chat.push(message);
                await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
                addOneMessage(message);
                await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
                await saveChat();
            };
        }
        toastr.success(`${defaultExtPrefix} Done!`);
    }
}

function applyOperationsToAccumulationBlock(mainBlock, operationsStr) {
    const operations = operationsStr.trim().split('\n');

    operations.forEach(operation => {
        operation = operation.trim();

        if (operation.includes(':')) {
            const [key, value] = operation.split(':').map(s => s.trim());

            if (value.startsWith('- ') || value.startsWith('+ ')) {
                const itemValue = value.slice(2).trim();
                if (mainBlock[key] !== undefined) {
                    if (mainBlock[key][itemValue] !== undefined) {
                        if (value.startsWith('-')) {
                            mainBlock[key][itemValue]--;
                            if (mainBlock[key][itemValue] <= 0) {
                                delete mainBlock[key][itemValue];
                            }
                        } else if (value.startsWith('+')) {
                            mainBlock[key][itemValue]++;
                        }
                    } else if (value.startsWith('+')) {
                        mainBlock[key][itemValue] = 1;
                    }
                } else if (value.startsWith('+')) {
                    mainBlock[key] = { [itemValue]: 1 };
                }
            } else if (value.startsWith('-') || value.startsWith('+')) {
                const numValue = parseInt(value, 10);
                if (!isNaN(numValue)) {
                    if (mainBlock[key] !== undefined) {
                        mainBlock[key] += numValue;
                    } else {
                        mainBlock[key] = numValue;
                    }
                }
            } else {
                if (!isNaN(value)) {
                    mainBlock[key] = parseInt(value, 10);
                } else {
                    mainBlock[key] = value;
                }
            }
        }
    });

    return mainBlock;
}

function parseAccumulationBlock(blockStr) {
    const lines = blockStr.trim().split('\n');
    const result = {};
    let currentObject = result;
    const stack = [];

    lines.forEach(line => {
        line = line.trim();
		
		if (!line.includes(':')) {
            return;
        }

        if (line.endsWith('[')) {
            const key = line.replace(': [', '').trim();
            const newObject = {};
            currentObject[key] = newObject;
            stack.push(currentObject);
            currentObject = newObject;
        } else if (line === ']') {
            currentObject = stack.pop();
        } else {
            const [key, value] = line.split(':').map(s => s.trim());
            if (!isNaN(value)) {
                currentObject[key] = parseInt(value, 10);
            } else {
                currentObject[key] = value;
            }
        }
    });

    return result;
}

function getAccumulationBlockWrapper(blockStr) {
    const lines = blockStr.trim().split('\n');
    const upperWrapper = [];
    const bottomWrapper = [];

    let crossLine = false;
    lines.forEach(line => {
        line = line.trim();

        if (line === '') {
            return;
        }

		if (line.includes(':') || line.includes(']')) {
            crossLine = true;
            return;
        } else {
            if (crossLine) {
                bottomWrapper.push(line);
            } else {
                upperWrapper.push(line);
            }
        }
    });

    return {
        upperWrapper: upperWrapper.join('\n'),
        bottomWrapper: bottomWrapper.join('\n')
    }
}

function accumulationBlockToString(jsonObj, indentLevel = 0) {
    const indent = '  '.repeat(indentLevel);
    let result = '';

    for (const key in jsonObj) {
        if (typeof jsonObj[key] === 'object' && !Array.isArray(jsonObj[key])) {
            result += `${indent}${key}: [\n`;
            result += accumulationBlockToString(jsonObj[key], indentLevel + 1);
            result += `${indent}]\n`;
        } else if (Array.isArray(jsonObj[key])) {
            result += `${indent}${key}: [${jsonObj[key].join(', ')}]\n`;
        } else {
            result += `${indent}${key}: ${jsonObj[key]}\n`;
        }
    }

    return result;
}

function stringifyAccumulationBlock(blockJson, oldBlockStr) {
    const blockWrapper = getAccumulationBlockWrapper(oldBlockStr);
    const newBlockStr = accumulationBlockToString(blockJson);
    return `${blockWrapper.upperWrapper}\n${newBlockStr}\n${blockWrapper.bottomWrapper}`;
}

async function handleBlocksAccumulation(messageId, triggeredAccumulationBlocks) {
    const blocks = []
    for (let idx = 0; idx < triggeredAccumulationBlocks.length; idx++) {
        const block = triggeredAccumulationBlocks[idx];
        const blockStr = getPreviousBlockContextUnconditional(block, chat.length - 1);
        const blockJson = parseAccumulationBlock(blockStr);
        const blockUpdater = getMultiBlockContentFromMessage(chat[messageId].mes, block.updater_name);
        const updatedBlock = applyOperationsToAccumulationBlock(blockJson, blockUpdater);
        const updatedBlockStr = stringifyAccumulationBlock(updatedBlock, blockStr);
        blocks.push(updatedBlockStr);
    };

    await addBlocksToExtra(messageId, blocks.join('\n'));
}

async function handleMessageTrigger(messageId, isUser) {
    const allBlocks = getAllEnabledBlocks();

    const triggeredAccumulationBlocks = allBlocks.filter((block) => {
        if (block.block_type !== 'accumulation') {
            return false;
        }
        const trigger_predicate = isUser ? block.user_message : block.char_message;
        return trigger_predicate && chat[messageId].mes.includes(`<${block.updater_name}>`);
    });
    await handleBlocksAccumulation(messageId, triggeredAccumulationBlocks);

    const triggeredBlocks = allBlocks.filter((block) => {
        if (block.block_type === 'accumulation') {
            return false;
        }
        const trigger_predicate = isUser ? block.user_message : block.char_message;
        if (block.keyword && block.keyword !== '') {
            const keyword_predicate = chat[messageId].mes.includes(block.keyword);
            return trigger_predicate && keyword_predicate;
        } else {
            const period_predicate = isUser ? ((messageId - 1) % block.period === 0) : (messageId % block.period === 0);
            return trigger_predicate && period_predicate;
        }
        
    });
    await handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
}


async function handleUserTrigger(messageId, is_swipe = false) {
    if (chat[messageId].is_system) {
        return;
    }

    if ((!is_swipe) || (is_swipe && is_chat_modified)) {
        await purgeBlocksExtra(messageId, true);
        is_chat_modified = false;
        await handleMessageTrigger(messageId, true);
    }
    const allBlocks = getAllEnabledBlocks();
    allBlocks.forEach(blockConfig => {
        if (blockConfig.inject_block) {
            const mes_id = getPreviousBlockMessageId(messageId, blockConfig, true);
            if (mes_id >= 0) {
                if (chat[mes_id].extra && chat[mes_id].extra.extblocks) {
                    const previous_block_message = chat[mes_id].extra.extblocks;
                    const previous_block = getBlockFromMessage(previous_block_message, blockConfig.name);
                    injectBlock(previous_block, blockConfig);
                }
            }
        }
    });
}

async function handleCharTrigger(messageId) {
    if (['...', ''].includes(chat[messageId]?.mes)) {
        return;
    }

    await purgeBlocksExtra(messageId, true);

    is_chat_modified = false;
    await handleMessageTrigger(messageId, false);
}

async function runBlockGenerationCallback(args, additional_prompt) {
    if (!args.name) {
        toastr.warning(`No block name provided`);
        return '';
    }
    const block_names = args.name.split(',').map((name) => name.trim());

    const allBlocks = getAllGeneratedBlocks();
    const blocks = allBlocks.filter((e) => block_names.includes(e.name));
    if (blocks.length > 0) {
        const messageId = chat.length - 1;
        let additionalMacro = {};
        if (additional_prompt !== '') {
            additionalMacro = { additionalPrompt: substituteParamsExtended(additional_prompt) }
        }
        let is_separate = false;
        if (args.is_separate) {
            is_separate = args.is_separate;
        }
        await handleBlocksGeneration(messageId, false, allBlocks, blocks, additionalMacro, is_separate);
    } else {
        toastr.warning(`Blocks not found.`);
    }
    return '';
}

async function runBlockRegenerationCallback() {
    const messageId = chat.length - 1;
    if (messageId == 0) {
        return;
    }
    const isUser = chat[messageId].is_user;

    await purgeBlocksExtra(messageId);

    await handleMessageTrigger(messageId, isUser);
    return '';
}

async function setupListeners() {
    $('#extblocks_is_enabled').off('click').on('click', async () => {
        const value = $('#extblocks_is_enabled').prop('checked');
        extension_settings.ExtBlocks.extblocks_is_enabled = value;
        if (value) {
            await createRegexForBlocks(true);
            if (this_chid !== undefined) {
                populateBlockMacrosBuffer();
            }
        } else {
            if (this_chid !== undefined) {
                purgeAllBlocksMacros();
                await purgeAllBlocksDisplayText();
                await selfReloadCurrentChat(true);
            }
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
            await changeSet(set_idx);
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
            await changeSet(0);
        } else {
            const set_idx = updateOrInsert(extension_settings.ExtBlocks.sets, await getDefaultSet());
            await changeSet(set_idx);
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

    $('#ExtBlocks-blocks-global-openaccumulationeditor').off('click').on('click', () => {
        openAccumulationEditor(false, false);
    });
    $('#ExtBlocks-blocks-scoped-openaccumulationeditor').off('click').on('click', () => {
        if (this_chid === undefined) {
            toastr.error('No character selected.');
            return;
        }

        if (selected_group) {
            toastr.error('Cannot edit embedded blocks in group chats.');
            return;
        }
        openAccumulationEditor(false, true);
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
    eventSource.makeFirst(event_types.CHAT_CHANGED, async () => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            return;
        }

        if (this_chid === undefined) {
            return;
        }

        if (self_reload_flag) {
            self_reload_flag = false;
        } else {
            is_chat_modified = false;
            await loadBlocks();
            populateBlockMacrosBuffer();
        }
    });
    eventSource.makeFirst(event_types.MESSAGE_EDITED, () => {
        is_chat_modified = true;
    });
    eventSource.makeFirst(event_types.MESSAGE_UPDATED, (messageId) => {
        if (extension_settings.ExtBlocks.extblocks_is_enabled) {
            updateBlocksDisplay(messageId);
        }
    });
    eventSource.on(event_types.MESSAGE_DELETED, () => is_chat_modified = true);
    eventSource.makeFirst(event_types.USER_MESSAGE_RENDERED, async (messageId) => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            return;
        }
        
        await handleUserTrigger(messageId);
    });
    eventSource.makeFirst(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            return;
        }

        if (messageId !== 0) {
            await handleCharTrigger(messageId);
            await updateBlocksDisplay(messageId - 2)
        } else {
            await checkBlocksInFirstMessage();
        }
    });
    eventSource.makeFirst(event_types.MESSAGE_SWIPED, async (messageId) => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            return;
        }

        const current_swipe_id = chat[messageId].swipe_id;
        if (messageId !== 0) {
            if (current_swipe_id === chat[messageId].swipes.length) {
                if (current_swipe_id == 1) {
                    firstSwipeBlockExtra(messageId);
                }
                await handleUserTrigger(messageId - 1, true);
            } else {
                await swipeBlockExtra(messageId, current_swipe_id);
            }
        } else {
            await checkBlocksInFirstMessage();
            await swipeBlockExtra(messageId, current_swipe_id);
        }
    });
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
            SlashCommandNamedArgument.fromProps({
                name: 'is_separate',
                description: 'whether the block should create a new message',
                typeList: [ARGUMENT_TYPE.BOOLEAN],
                isRequired: false,
            })
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'additional prompt', [ARGUMENT_TYPE.STRING], false, false, ''
            ),
        ],
        helpString: 'Starts generating a block by its name.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'extblocks-storage-append',
        callback: appendStringToExtraCallback,
        returns: 'void',
        unnamedArgumentList: [
            new SlashCommandArgument(
                'block string', [ARGUMENT_TYPE.STRING], false, false, ''
            ),
        ],
        helpString: 'Appends block/blocks to the last message block storage.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'extblocks-storage-purge',
        callback: purgeExtraCallback,
        returns: 'void',
        helpString: 'Purge the last message block storage.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'extblocks-regenerate',
        callback: runBlockRegenerationCallback,
        returns: 'void',
        helpString: 'Regenerates last blocks.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'extblocks-flushinjects',
        callback: async () => await selfReloadCurrentChat(),
        returns: 'void',
        helpString: 'Flushes ExtBlocks injects.',
    }));

    console.log(`${defaultExtPrefix} extension loaded`);
});
