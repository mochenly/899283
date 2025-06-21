import { saveSettingsDebounced, reloadCurrentChat, this_chid } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { getSortableDelay } from '../../../../utils.js';

import { defaultSet, extStates } from './common.js';


export async function selfReloadCurrentChat(forceReload = false) {
    if (this_chid !== undefined && (extension_settings.ExtBlocks.extblocks_is_enabled || forceReload)) {
        extStates.self_reload_flag = true;
        await reloadCurrentChat();
    }
}

export async function refreshSettings() {
    extStates.ExtBlocks_settings = extension_settings.ExtBlocks;
    extStates.current_set = extStates.ExtBlocks_settings.sets[extStates.ExtBlocks_settings.active_set_idx];
    extStates.api_preset = extStates.ExtBlocks_settings.api_presets[extStates.ExtBlocks_settings.active_api_preset];
}

export function checkAttributesInBlockName(block_name) {
    if (block_name.includes('=')) {
        const indexOfFirstEqual = block_name.indexOf('=');
        const bottom_block_name = block_name.substring(0, indexOfFirstEqual).trim().split(/\s+/).slice(0, -1).join(' ');
        return {
            upper_block_name: block_name,
            bottom_block_name: bottom_block_name
        }
    } else {
        return {
            upper_block_name: block_name,
            bottom_block_name: block_name
        }
    }
}

export function getRegexForBlock(block_name) {
    const block_names = checkAttributesInBlockName(block_name);
    return `(\\n*<${block_names.upper_block_name}(\\s+[^>]+)?>[\\s\\S]*?<\\/${block_names.bottom_block_name}>)`;
}

export function getBlockEncloseRegex(block_name) {
    const block_names = checkAttributesInBlockName(block_name);
    const block_regex = new RegExp(`(?:[\\s\\S]*?(?=<${block_names.upper_block_name}(\\s+[^>]+)?>)|$)|(?<=<\\/${block_names.bottom_block_name}>|^)[\\s\\S]*`, "g");
    return block_regex;
}

export function getBlockFromMessageWithRegex(message, block_regex) {
    let block = message.replace(block_regex, '');
    block = block.replace(/^<+/, '<');
    return block;
}

export function getBlockFromMessage(message, block_name) {
    const block_regex = getBlockEncloseRegex(block_name);
    return getBlockFromMessageWithRegex(message, block_regex);
}

export function getMultiBlockContentFromMessage(message, block_name) {
    const block_names = checkAttributesInBlockName(block_name);
    const block_regex = new RegExp(`<${block_names.upper_block_name}(\\s+[^>]+)?>\\n*|<\\/${block_names.bottom_block_name}>|(?:(?<=^)|(?<=<\\/${block_names.bottom_block_name}>))([\\s\\S]*?)(?=<${block_names.upper_block_name}(\\s+[^>]+)?>|$)`, "g");
    return getBlockFromMessageWithRegex(message, block_regex).trim();
}

export function updateOrInsert(jsonArray, newJson) {
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

export function getDefaultSet() {
    return JSON.parse(JSON.stringify(defaultSet));
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

export async function interactiveSortData(sortableDatas) {
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