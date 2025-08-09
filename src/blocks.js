import { saveSettingsDebounced, substituteParamsExtended, setExtensionPrompt, callPopup,
    this_chid, characters, chat, updateMessageBlock, saveChatConditional } from '../../../../../script.js';
import { extension_settings, writeExtensionField, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { getRegexedString } from '../../../../extensions/regex/engine.js'
import { download, getFileText, uuidv4 } from '../../../../utils.js';

import { defaultExtPrefix, extStates, templates_path, BlockType, ContextType, extName, ElementTemplate } from './common.js';
import { selfReloadCurrentChat, getRegexForBlock, getBlockEncloseRegex, updateOrInsert, refreshSettings,
    getBlockFromMessageWithRegex, getBlockFromMessage
 } from './utils.js';
import { insertBlockMacros, deleteBlockMacros, checkAllMacros } from './macros.js';
import { openEditor, openAccumulationEditor, openScriptEditor } from './editors.js';


export async function createRegexForBlocks(forceReload = false, updateDisplayTextOnly = false) {
    let spoiler_names = [];

    extStates.current_set.global_blocks.forEach((block) => {
        if (block.hide_display) {
            spoiler_names.push(block.name);
        }
    });
    characters[this_chid]?.data?.extensions?.ExtBlocks?.forEach((block) => {
        if (block.hide_display) {
            spoiler_names.push(block.name);
        }
    });

    if (forceReload && this_chid !== undefined) {
        await updateAllBlocksDisplayText();
        await selfReloadCurrentChat();
    } else if (updateDisplayTextOnly && this_chid !== undefined) {
        console.log("Updating display text")
        await updateAllBlocksDisplayText();
    }

}

export function updateBlocksDisplayText(messageId) {
    if (chat[messageId].extra === undefined) {
        return;
    }

    if (chat[messageId].extra.extblocks === undefined || chat[messageId].extra.extblocks === '') {
        if (chat[messageId].extra.display_text) {
            delete chat[messageId].extra.display_text;
        }
    } else {
        const messageBlocks = chat[messageId].extra.extblocks;
        const allBlocks = getAllBlocks();
        const blocksToDisplay = [];
        for (const block of allBlocks) {
            if (!block.hide_display) {
                const blockFromMessage = getBlockFromMessage(messageBlocks, block.name);
                if (blockFromMessage) {
                    blocksToDisplay.push(blockFromMessage);
                }
            }
        }
        chat[messageId].extra.display_text = chat[messageId].mes + `\n${blocksToDisplay.join("\n")}`;
    }
}

export async function updateAllBlocksDisplayText() {
    for (let messageId = 0; messageId < chat.length; messageId++) {
        updateBlocksDisplayText(messageId);
    }

    await saveChatConditional();
}

export function purgeBlocksDisplayText(messageId) {
    if (chat[messageId].extra === undefined) {
        return;
    }

    if (chat[messageId].extra.display_text) {
        delete chat[messageId].extra.display_text;
    }

}

export async function purgeAllBlocksDisplayText() {
    for (let messageId = 0; messageId < chat.length; messageId++) {
        purgeBlocksDisplayText(messageId);
    }

    await saveChatConditional();
}

export async function updateBlocksDisplay(messageId) {
    updateBlocksDisplayText(messageId);
    updateMessageBlock(messageId, chat[messageId]);
    await saveChatConditional();
}

export async function addBlocksToExtra(messageId, blocksStr) {
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

export function getBlocksFromExtra(messageId) {
    if (chat[messageId].extra !== undefined && chat[messageId].extra.extblocks !== undefined) {
        return chat[messageId].extra.extblocks;
    } else {
        return '';
    }
}

export async function purgeBlocksExtra(messageId, no_update = false) {
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

export function getAllPreviousBlocks() {
    const blocks = getAllEnabledBlocks();
    let blocksStrArray = [];
    blocks.forEach(block => {
        blocksStrArray.push(getPreviousBlockContextUnconditional(block, chat.length - 1, true).trim());
    });

    return blocksStrArray.join('\n\n');
}

export async function swipeBlockExtra(messageId, swipeId) {
    if (chat[messageId].swipe_info[swipeId] && chat[messageId].swipe_info[swipeId].extra && chat[messageId].swipe_info[swipeId].extra.extblocks) {
        chat[messageId].extra.extblocks = chat[messageId].swipe_info[swipeId].extra.extblocks;
    } else {
        chat[messageId].extra.extblocks = '';
    }

    await updateBlocksDisplay(messageId);
}

export function firstSwipeBlockExtra(messageId) {
    if (chat[messageId].extra.extblocks) {
        chat[messageId].swipe_info[0].extra.extblocks = chat[messageId].extra.extblocks;
    } else {
        chat[messageId].swipe_info[0].extra.extblocks = '';
    }
}


export async function checkBlocksInFirstMessage() {
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
        chat[0].mes = chat[0].mes.replaceAll(allBlocksPurgeRegex, '').trim();
        await addBlocksToExtra(0, blocksStr);
    }
}


export async function importBlock(file, isScoped) {
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
            await writeExtensionField(this_chid, extName, array);
        }

        saveSettingsDebounced();
        await loadBlocks();
        if (this_chid !== undefined && block.block_type !== BlockType.REWRITE && block.block_type !== BlockType.SCRIPT) {
            insertBlockMacros(block);
        }
        
        toastr.success(`ExtBlocks block "${block.name}" imported.`);
    } catch (error) {
        console.log(error);
        toastr.error('Invalid JSON file.');
        return;
    }
}


export async function saveBlock(block, index, isScoped) {
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
        await writeExtensionField(this_chid, extName, array);
    }

    if (block.inject_block && block.disabled) {
        injectEmptyBlock(block);
    }

    saveSettingsDebounced();
    await loadBlocks();
    if (this_chid !== undefined && block.block_type !== BlockType.REWRITE && block.block_type !== BlockType.SCRIPT) {
        insertBlockMacros(block);
    }
}

export async function deleteBlock({ id, isScoped }) {
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];

    const existingBlockIndex = array.findIndex((block) => block.id === id);
    if (!existingBlockIndex || existingBlockIndex !== -1) {
        const block = array[existingBlockIndex];
        const block_name = block.name;
        array.splice(existingBlockIndex, 1);

        if (isScoped) {
            await writeExtensionField(this_chid, extName, array);
        }

        saveSettingsDebounced();
        await loadBlocks();
        if (this_chid !== undefined && block.block_type !== BlockType.REWRITE && block.block_type !== BlockType.SCRIPT) {
            deleteBlockMacros(block_name);
        }
    }
}

export function getBlockCombinedContext(block, messageId, allBlocks, additionalMacro = {}) {
    let contextStringArray = [];
    block.context.forEach((context_item) => {
        if (context_item.type === ContextType.TEXT) {
            contextStringArray.push(substituteParamsExtended(context_item.text, additionalMacro));

        } else if (context_item.type === ContextType.LAST_MESSAGES || context_item.type === ContextType.LAST_MESSAGES_KEYWORD) {
            const lastMessages = getLastMessagesContext(context_item, messageId);
            if (lastMessages != '') {
                contextStringArray.push(lastMessages);
            }

        } else if (context_item.type === ContextType.PREVIOUS_BLOCK) {
            const previousBlock = getPreviousBlockContext(context_item, messageId, allBlocks);
            if (previousBlock !== '') {
                contextStringArray.push(previousBlock);
            }
        }
    });
    return contextStringArray.join('\n');
}

export function getSingleBlockFullPrompt(block) {
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


export async function loadBlocks() {
    $('#ExtBlocks-blocks-global-list').empty();
    $('#ExtBlocks-blocks-scoped-list').empty();

    await refreshSettings();

    const blockTemplate = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.BLOCK));

    function renderBlock(container, block, isScoped, index) {
        const blockHtml = blockTemplate.clone();

        if (!block.id) {
            block.id = uuidv4();
        }

        let block_type = block.block_type;
        let editor_func;
        if (block_type === undefined) {
            block_type = BlockType.GENERATED;
        }

        if (block_type === BlockType.GENERATED) {
            blockHtml.find('.ExtBlocks-block-atype-icon').hide();
            blockHtml.find('.ExtBlocks-block-stype-icon').hide();
            blockHtml.find('.ExtBlocks-block-rtype-icon').hide();
            editor_func = openEditor;
            blockHtml.find('.export_prompt_ExtBlocks').on('click', async function () {
                const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                const fileData = JSON.stringify({fullPrompt: await checkAllMacros(getSingleBlockFullPrompt(block))}, null, 4);
                download(fileData, fileName, 'application/json');
            });
        } else if (block_type === BlockType.ACCUMULATION) {
            blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
            blockHtml.find('.ExtBlocks-block-stype-icon').hide();
            blockHtml.find('.ExtBlocks-block-rtype-icon').hide();
            blockHtml.find('.export_prompt_ExtBlocks').hide();
            editor_func = openAccumulationEditor;
        } else if (block_type === BlockType.REWRITE) {
            blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
            blockHtml.find('.ExtBlocks-block-stype-icon').hide();
            blockHtml.find('.ExtBlocks-block-atype-icon').hide();
            editor_func = openEditor;
            blockHtml.find('.export_prompt_ExtBlocks').on('click', async function () {
                const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                const fileData = JSON.stringify({fullPrompt: await checkAllMacros(getSingleBlockFullPrompt(block))}, null, 4);
                download(fileData, fileName, 'application/json');
            });
        } else if (block_type === BlockType.SCRIPT) {
            blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
            blockHtml.find('.ExtBlocks-block-rtype-icon').hide();
            blockHtml.find('.ExtBlocks-block-atype-icon').hide();
            blockHtml.find('.export_prompt_ExtBlocks').hide();
            editor_func = openScriptEditor;
        }

        blockHtml.attr('id', block.id);
        blockHtml.find('.ExtBlocks_block_name').text(block.name);

        const presetButtonContainer = blockHtml.find('.ExtBlocks-block-preset');
        const presetButtonIcon = presetButtonContainer.find('i');
        const presets = ['big', 'medium', 'small'];
        const presetIcons = {
            'big': 'fa-temperature-full',
            'medium': 'fa-temperature-half',
            'small': 'fa-temperature-empty',
        };
        const presetTitles = {
            'big': 'API Preset: Big',
            'medium': 'API Preset: Medium',
            'small': 'API Preset: Small',
        };

        if (block.api_preset === undefined) {
            block.api_preset = 'big';
        }

        let currentPreset = block.api_preset;

        const updateIcon = () => {
            presetButtonIcon.removeClass('fa-temperature-full fa-temperature-half fa-temperature-empty');
            const iconClass = presetIcons[currentPreset];
            presetButtonIcon.addClass(iconClass);
            presetButtonContainer.attr('title', presetTitles[currentPreset]);
        };

        updateIcon();

        presetButtonContainer.on('click', async function () {
            const currentIndex = presets.indexOf(currentPreset);
            currentPreset = presets[(currentIndex + 1) % presets.length];
            block.api_preset = currentPreset;
            updateIcon();
            await saveBlock(block, index, isScoped);
        });

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

    extStates.current_set.global_blocks.forEach((block, index) => renderBlock('#ExtBlocks-blocks-global-list', block, false, index));
    characters[this_chid]?.data?.extensions?.ExtBlocks?.forEach((block, index) => renderBlock('#ExtBlocks-blocks-scoped-list', block, true, index));
    if (extStates.ExtBlocks_settings.extblocks_is_enabled) {
        await createRegexForBlocks(false, true);
    }
    saveSettingsDebounced();
}

export function groupBlocksByContext(blocks) {
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

export function priorityCombineBlocks(globalBlocks, scopedBlocks) {
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

export function getLastMessagesContext(item, messageId) {
    let lastMessages;
    let messages_count = item.messages_count;
    const sliced_chat = chat.slice(0, messageId + 1);
    const unhided_chat = sliced_chat.filter(message => message.is_system !== true);
    if (messages_count === undefined) {
        const keyword_stopper = item.keyword_stopper;
        if (keyword_stopper && keyword_stopper !== '') {
            let lastMessageId = unhided_chat.slice(0, -1).findLastIndex(message => message.mes.includes(keyword_stopper));
            if (lastMessageId == -1) {
                lastMessageId = 0;
            }
            messages_count = unhided_chat.length - lastMessageId;
        } else {
            return '';
        }
    }
    if (messages_count > 0) {
        lastMessages = unhided_chat.slice(-messages_count);
    } else if (messages_count < 0) {
        lastMessages = unhided_chat.slice(0, -messages_count);
    } else {
        return '';
    }
    let separator;
    if (item.messages_separator == 'newline') {
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


export function getPreviousBlockContext(item, messageId, allBlocks) {
    const previousBlockConfig = allBlocks.find(obj => obj.name === item.block_name);
    if (previousBlockConfig) {
        return getPreviousBlockContextUnconditional(previousBlockConfig, messageId, false, item.block_count);
    }

    return '';
}

export function getPreviousBlockContextUnconditional(block, messageId, may_current = false, count = 1) {
    const block_regex = getBlockEncloseRegex(block.name);
    const blocks = [];
    if (count === undefined || count < 1) {
        count = 1;
    }
    const startId = messageId - (may_current ? 0 : 1);

    for (let i = startId; i >= 0 && blocks.length < count; i--) {
        const message = chat[i];
        if (message.extra?.extblocks) {
            const blockContent = getBlockFromMessageWithRegex(message.extra.extblocks, block_regex);
            if (blockContent !== '') {
                blocks.push(blockContent);
            }
        }
    }

    return blocks.reverse().join('\n\n');
}


export function injectBlock(block, blockConfig) {
    const key = `${defaultExtPrefix} ${blockConfig.name}`;
    const position = blockConfig.injection_position;
    const role = blockConfig.injection_role;
    let depth = blockConfig.injection_depth;
    if (depth < 0) {
        depth = chat.length - depth;
    }
    setExtensionPrompt(key, block, position, depth, true, role);
}

export function injectEmptyBlock(blockConfig) {
    injectBlock('', blockConfig);
}

export function getAllBlocks() {
    const embeddedBlocks = characters[this_chid]?.data?.extensions?.ExtBlocks ?? [];
    return priorityCombineBlocks(extStates.current_set.global_blocks, embeddedBlocks);
}

export function getAllGeneratedBlocks() {
    const allBlocks = getAllBlocks();
    return allBlocks.filter(block => block.block_type !== BlockType.ACCUMULATION && block.block_type !== BlockType.REWRITE && block.block_type !== BlockType.SCRIPT);
}

export function getAllRewriteBlocks() {
    const allBlocks = getAllBlocks();
    return allBlocks.filter(block => block.block_type === BlockType.REWRITE);
}

export function getAllScriptBlocks() {
    const allBlocks = getAllBlocks();
    return allBlocks.filter(block => block.block_type === BlockType.SCRIPT);
}

export function getAllEnabledBlocks() {
    const allBlocks = getAllBlocks();
    return allBlocks.filter(item => !item.disabled);
}
