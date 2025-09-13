import { substituteParamsExtended, this_chid, eventSource, event_types, chat,
    addOneMessage, system_message_types, system_avatar, saveChatConditional } from '../../../../../script.js';

import { defaultExtPrefix, extStates, BlockType } from './common.js';
import { getBlockCombinedContext, updateBlocksDisplay, groupBlocksByContext, addBlocksToExtra,
    getAllEnabledBlocks, purgeBlocksExtra, getPreviousBlockContextUnconditional, injectBlock, getAllGeneratedBlocks,
    getAllRewriteBlocks, getAllPreviousBlocks, getAllScriptBlocks
 } from './blocks.js';
import { checkAllMacros } from './macros.js';
import { generateBlocks } from './api.js';
import { extractMessageFromData } from './api.js';
import { getMultiBlockContentFromMessage, getBlockFromMessage } from './utils.js';
import { handleBlocksAccumulation } from './accumulationBlocks.js';
import { handleScriptExecution } from './scriptsBlocks.js';


export function categorizeBlocks(triggeredBlocks) {
    return triggeredBlocks.reduce((acc, block) => {
        if (block.block_type === BlockType.REWRITE) {
            acc.rewriteBlocks.push(block);
        } else if (block.block_type === BlockType.SCRIPT) {
            acc.scriptBlocks.push(block);
        } else {
            acc.generatedBlocks.push(block);
        }
        return acc;
    }, { generatedBlocks: [], rewriteBlocks: [], scriptBlocks: [] });
}

export async function generateRewrite(rewriteBlock, messageId, allBlocks, additionalMacro = {}) {
    const context = getBlockCombinedContext(rewriteBlock, messageId, allBlocks, additionalMacro);
    const template = `Block(s) template:\n${substituteParamsExtended(rewriteBlock.template, additionalMacro)}`;
    const prompt = `Block(s) prompt:\n${substituteParamsExtended(rewriteBlock.prompt, additionalMacro)}`;
    let fullPrompt = `${context}\n\n\n${template}\n\n${prompt}`;
    fullPrompt = await checkAllMacros(fullPrompt);

    const blocksData = await generateBlocks(fullPrompt, rewriteBlock.api_preset);
    const preset = rewriteBlock.api_preset ? extStates.ExtBlocks_settings.api_presets[rewriteBlock.api_preset] : extStates.api_preset;
    const blocks = extractMessageFromData(blocksData, preset);
    return getMultiBlockContentFromMessage(blocks, 'rewritten text');
}

export async function handleRewriteBlocks(rewriteBlocks, generation_order, messageId, allBlocks, additionalMacro = {}) {
    const blocksToProcess = rewriteBlocks.filter(block => block.generation_order === generation_order);
    if (blocksToProcess.length === 0) return;

    toastr.info(`${defaultExtPrefix} Rewriting, please wait...`);
    let isSuccess = true;
    let isPartialSuccess = false;

    for (const rewriteBlock of blocksToProcess) {
        const rewrittenText = await generateRewrite(rewriteBlock, messageId, allBlocks, additionalMacro);

        if (rewrittenText && !rewrittenText.includes('Proxy error')) {
            chat[messageId].mes = rewrittenText;
            isPartialSuccess = true;
        } else {
            isSuccess = false;
        }
    }

    if (chat[messageId].swipe_id && isPartialSuccess) {
        chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
    }

    if (isPartialSuccess) {
        await updateBlocksDisplay(messageId);
    }

    if (isSuccess) {
        toastr.success(`${defaultExtPrefix} Rewriting is done!`);
    } else if (isPartialSuccess) {
        toastr.warning(`${defaultExtPrefix} Rewriting probably failed.`);
    } else {
        toastr.error(`${defaultExtPrefix} Rewriting failed.`);
    }
}

export async function handleScriptBlocks(scriptBlocks, execution_order) {
    const scriptsToExecute = scriptBlocks.filter(block => block.execution_order === execution_order);
    if (scriptsToExecute.length > 0) {
        await handleScriptExecution(scriptsToExecute);
    }
}

export async function generateBlockContent(blocksInGroup, messageId, allBlocks, additionalMacro = {}) {
    const apiPresetName = blocksInGroup[0].api_preset;
    let combinedContext = '';
    let combinedTemplate = `Block(s) template:\n${blocksInGroup.map(block => substituteParamsExtended(block.template, additionalMacro)).join('\n')}`;
    let combinedPrompt = `Block(s) prompt:\n${blocksInGroup.map(block => substituteParamsExtended(block.prompt, additionalMacro)).join('\n')}`;

    if (blocksInGroup.length > 0) {
        combinedContext = getBlockCombinedContext(blocksInGroup[0], messageId, allBlocks, additionalMacro);
    }

    let fullPrompt = `${combinedContext}\n\n\n${combinedTemplate}\n\n${combinedPrompt}`;
    fullPrompt = await checkAllMacros(fullPrompt);

    const blocksData = await generateBlocks(fullPrompt, apiPresetName);
    const preset = apiPresetName ? extStates.ExtBlocks_settings.api_presets[apiPresetName] : extStates.api_preset;
    let blocks = extractMessageFromData(blocksData, preset);

    function removeBackticks(codeString) {
        if (codeString.startsWith("```") && codeString.endsWith("```")) {
            return codeString.slice(codeString.indexOf('\n') > -1 ? codeString.indexOf('\n') + 1 : 3, -3);
        }
        return codeString;
    }
    return removeBackticks(blocks);
}

export async function handleGeneration(generatedBlocks, messageId, allBlocks, additionalMacro = {}, is_separate = false) {
    const groupedBlocks = groupBlocksByContext(generatedBlocks);
    const blocksList = [];

    if (Object.keys(groupedBlocks).length === 0) return blocksList;

    toastr.info(`${defaultExtPrefix} Generating, please wait...`);
    for (const context in groupedBlocks) {
        const blocksInGroup = groupedBlocks[context];
        const blocks = await generateBlockContent(blocksInGroup, messageId, allBlocks, additionalMacro);

        blocksList.push(blocks);
        eventSource.emit('/extblocks/generated', blocks);

        if (!is_separate) {
            await addBlocksToExtra(messageId, blocks);
        } else {
            const message = {
                name: 'System', is_user: false, is_system: true, mes: blocks, force_avatar: system_avatar,
                extra: {
                    type: system_message_types.NARRATOR, bias: null, gen_id: Date.now(),
                    api: 'manual', model: 'slash command',
                },
            };
            chat.push(message);
            await eventSource.emit(event_types.MESSAGE_SENT, (chat.length - 1));
            addOneMessage(message);
            await eventSource.emit(event_types.USER_MESSAGE_RENDERED, (chat.length - 1));
            await saveChatConditional();
        }
    }
    toastr.success(`${defaultExtPrefix} Generating is done!`);
    return blocksList;
}

export async function handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks, additionalMacro = {}, is_separate = false) {
    const { generatedBlocks, rewriteBlocks, scriptBlocks } = categorizeBlocks(triggeredBlocks);
    await handleScriptBlocks(scriptBlocks, 'before');
    await handleRewriteBlocks(rewriteBlocks, 'before', messageId, allBlocks, additionalMacro);

    const blocksList = await handleGeneration(generatedBlocks, messageId, allBlocks, additionalMacro, is_separate);

    await handleRewriteBlocks(rewriteBlocks, 'after', messageId, allBlocks, additionalMacro);
    await handleScriptBlocks(scriptBlocks, 'after');

    return blocksList;
}


export async function handleMessageTrigger(messageId, isUser) {
    const allBlocks = getAllEnabledBlocks();

    const triggeredAccumulationBlocks = allBlocks.filter((block) => {
        if (block.block_type !== BlockType.ACCUMULATION) {
            return false;
        }
        const trigger_predicate = isUser ? block.user_message : block.char_message;
        return trigger_predicate && chat[messageId].mes.includes(`<${block.updater_name}>`);
    });
    await handleBlocksAccumulation(messageId, triggeredAccumulationBlocks);

    const triggeredBlocks = allBlocks.filter((block) => {
        if (block.block_type === BlockType.ACCUMULATION) {
            return false;
        }
        const trigger_predicate = isUser ? block.user_message : block.char_message;
        if (block.keyword && block.keyword !== '') {
            let keyword_predicate;
            if (block.keyword_is_regex) {
                try {
                    let regex;
                    const keyword = block.keyword;
                    if (keyword.startsWith('/') && keyword.lastIndexOf('/') > 0) {
                        const lastSlash = keyword.lastIndexOf('/');
                        const content = keyword.substring(1, lastSlash);
                        const flags = keyword.substring(lastSlash + 1);
                        regex = new RegExp(content, flags);
                    } else {
                        regex = new RegExp(keyword);
                    }
                    keyword_predicate = regex.test(chat[messageId].mes);
                } catch (e) {
                    console.error(`ExtBlocks: Invalid regex for block "${block.name}": ${block.keyword}`, e);
                    keyword_predicate = false;
                }
            } else {
                keyword_predicate = chat[messageId].mes.includes(block.keyword);
            }
            return trigger_predicate && keyword_predicate;
        } else {
            const period_predicate = isUser ? ((messageId - 1) % block.period === 0) : (messageId % block.period === 0);
            return trigger_predicate && period_predicate;
        }
        
    });
    await handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
}


export async function handleUserTrigger(messageId, is_swipe = false) {
    if (chat[messageId].is_system) {
        return;
    }

    if ((!is_swipe) || (is_swipe && extStates.is_chat_modified)) {
        await purgeBlocksExtra(messageId, true);
        extStates.is_chat_modified = false;
        await handleMessageTrigger(messageId, true);
    }
    const allBlocks = getAllEnabledBlocks();
    allBlocks.forEach(blockConfig => {
        if (blockConfig.inject_block && blockConfig.block_type !== BlockType.REWRITE && blockConfig.block_type !== BlockType.SCRIPT) {
            const previous_block_full = getPreviousBlockContextUnconditional(blockConfig, messageId, true, 1);
            if (previous_block_full) {
                const previous_block_content = getBlockFromMessage(previous_block_full, blockConfig.name);
                injectBlock(previous_block_content, blockConfig);
            }
        }
    });
}


export async function handleCharTrigger(messageId) {
    if (['...', ''].includes(chat[messageId]?.mes)) {
        return;
    }

    if (chat[messageId]?.mes.includes('Proxy error')) {
        return;
    }

    await purgeBlocksExtra(messageId, true);

    extStates.is_chat_modified = false;
    await handleMessageTrigger(messageId, false);
}


export async function runBlockGenerationCallback(args, additional_prompt) {
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

export async function runRewriteBlocksCallback(args, additional_prompt) {
    if (!args.name) {
        toastr.warning(`No block name provided`);
        return '';
    }
    const block_names = args.name.split(',').map((name) => name.trim());

    const allBlocks = getAllRewriteBlocks();
    const blocks = allBlocks.filter((e) => block_names.includes(e.name));
    if (blocks.length > 0) {
        const messageId = chat.length - 1;
        let additionalMacro = {};
        if (additional_prompt !== '') {
            additionalMacro = { additionalPrompt: substituteParamsExtended(additional_prompt) }
        }
        let is_separate = false;
        await handleBlocksGeneration(messageId, false, allBlocks, blocks, additionalMacro, is_separate);
    } else {
        toastr.warning(`Blocks not found.`);
    }
    return '';
}

export async function runScriptsExecutionCallback(args, _) {
    if (!args.name) {
        toastr.warning(`No block name provided`);
        return '';
    }
    const block_names = args.name.split(',').map((name) => name.trim());

    const allBlocks = getAllScriptBlocks();
    const blocks = allBlocks.filter((e) => block_names.includes(e.name));
    if (blocks.length > 0) {
        const messageId = chat.length - 1;
        await handleBlocksGeneration(messageId, false, allBlocks, blocks, {}, false);
    } else {
        toastr.warning(`Blocks not found.`);
    }
    return '';
}

export async function runBlockRegenerationCallback() {
    const messageId = chat.length - 1;
    if (messageId == 0) {
        return;
    }
    const isUser = chat[messageId].is_user;

    await purgeBlocksExtra(messageId);

    await handleMessageTrigger(messageId, isUser);
    return '';
}

export async function appendStringToExtraCallback(_, blocksStr) {
    await addBlocksToExtra(chat.length - 1, blocksStr);
    return '';
}

export async function purgeExtraCallback() {
    await purgeBlocksExtra(chat.length - 1);
    return '';
}

export async function exportBlocksCallback() {
    if (this_chid !== undefined) {
        const blocksStr = getAllPreviousBlocks();
        const message = {
            name: 'System',
            is_user: false,
            is_system: true,
            mes: blocksStr,
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
        await saveChatConditional();
    }
    return '';
}
