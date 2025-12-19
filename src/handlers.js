import { substituteParamsExtended, this_chid, eventSource, event_types, chat,
    addOneMessage, system_message_types, system_avatar, saveChatConditional } from '../../../../../script.js';

import { defaultExtPrefix, extStates, BlockType, MessageRole } from './common.js';
import { getBlockCombinedContext, updateBlocksDisplay, groupBlocksByContext, addBlocksToExtra,
    getAllEnabledBlocks, purgeBlocksExtra, getPreviousBlockContextUnconditional, injectBlock, getAllGeneratedBlocks,
    getAllRewriteBlocks, getAllPreviousBlocks, getAllScriptBlocks
 } from './blocks.js';
import { checkAllMacros } from './macros.js';
import { generateBlocks } from './api.js';
import { extractMessageFromData } from './api.js';
import { getMultiBlockContentFromMessage, getBlockFromMessage, stringToRegex } from './utils.js';
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
    let combinedContext = [];
    let combinedTemplate = `Block(s) template:\n${blocksInGroup.map(block => substituteParamsExtended(block.template, additionalMacro)).join('\n')}`;
    let combinedPrompt = `Block(s) prompt:\n${blocksInGroup.map(block => substituteParamsExtended(block.prompt, additionalMacro)).join('\n')}`;

    if (blocksInGroup.length > 0) {
        combinedContext = getBlockCombinedContext(blocksInGroup[0], messageId, allBlocks, additionalMacro);
    }

    if (combinedContext.length > 0 && combinedContext[0].role === MessageRole.SYSTEM) {
        combinedContext[0].content = `${combinedPrompt}\n\n${combinedTemplate}\n\n${combinedContext[0].content}`
    } else if (combinedContext.length > 0) {
        combinedContext.unshift({ role: MessageRole.SYSTEM, content: `${combinedPrompt}\n\n${combinedTemplate}` });
    } else {
        combinedContext = [{ role: MessageRole.USER, content: `${combinedPrompt}\n\n${combinedTemplate}` }];
    }

    combinedContext = await checkAllMacros(combinedContext);

    const blocksData = await generateBlocks(combinedContext, apiPresetName);
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

    const hasForegroundBlocks = Object.values(groupedBlocks).some(group => !(group[0].background ?? false));
    if (hasForegroundBlocks) {
        toastr.info(`${defaultExtPrefix} Generating, please wait...`);
    }

    for (const context in groupedBlocks) {
        const blocksInGroup = groupedBlocks[context];
        const isBackground = blocksInGroup[0].background ?? false;

        if (isBackground) {
            toastr.info(`${defaultExtPrefix} Starting background generation for "${blocksInGroup.map(b => b.name).join(', ')}"...`);
        }

        const generationTask = async () => {
            const blocks = await generateBlockContent(blocksInGroup, messageId, allBlocks, additionalMacro);
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
                const pushedIndex = chat.length - 1;
                await eventSource.emit(event_types.MESSAGE_SENT, pushedIndex);
                addOneMessage(message);
                await eventSource.emit(event_types.USER_MESSAGE_RENDERED, pushedIndex);
                await saveChatConditional();
            }

            if (isBackground) {
                toastr.success(`${defaultExtPrefix} Background generation for "${blocksInGroup.map(b => b.name).join(', ')}" is done!`);
            }
            return blocks;
        };

        if (isBackground) {
            generationTask().catch(err => {
                console.error(`${defaultExtPrefix} Background generation failed:`, err);
                toastr.error(`${defaultExtPrefix} Background generation failed for "${blocksInGroup.map(b => b.name).join(', ')}".`);
            });
        } else {
            const blocks = await generationTask();
            blocksList.push(blocks);
        }
    }

    if (hasForegroundBlocks) {
        toastr.success(`${defaultExtPrefix} Generating is done!`);
    }
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
    let messageText = chat[messageId].mes;

    if (extStates.pauseCounter > 0 && !isUser) {
        const messagesToCombine = chat.slice(Math.max(0, messageId - extStates.pauseCounter), messageId + 1);
        messageText = messagesToCombine.map(m => m.mes).join('\n');
    }

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

        if (extStates.generationPaused) {
            if (!block.generation_pause) {
                return false;
            }
            if (block.keyword && block.keyword !== '') {
                let keyword_predicate;
                if (block.keyword_is_regex) {
                    try {
                        const regex = stringToRegex(block.keyword);
                        keyword_predicate = regex.test(chat[messageId].mes);
                    } catch (e) {
                        console.error(`ExtBlocks: Invalid regex for block "${block.name}": ${block.keyword}`, e);
                        keyword_predicate = false;
                    }
                } else {
                    keyword_predicate = chat[messageId].mes.includes(block.keyword);
                }
                return keyword_predicate;
            }
            return false;
        }

        const trigger_predicate = isUser ? block.user_message : block.char_message;
        if (block.keyword && block.keyword !== '') {
            let keyword_predicate;
            if (block.keyword_is_regex) {
                try {
                    const regex = stringToRegex(block.keyword);
                    keyword_predicate = regex.test(messageText);
                } catch (e) {
                    console.error(`ExtBlocks: Invalid regex for block "${block.name}": ${block.keyword}`, e);
                    keyword_predicate = false;
                }
            } else {
                keyword_predicate = messageText.includes(block.keyword);
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

    if ((!is_swipe) || (is_swipe && extStates.is_chat_modified && chat[messageId].is_user)) {
        extStates.pauseCounter = 0;
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
        if (additional_prompt) {
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
        if (additional_prompt) {
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
