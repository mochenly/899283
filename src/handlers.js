import { substituteParamsExtended, this_chid, eventSource, event_types, chat,
    addOneMessage, system_message_types, system_avatar, saveChatConditional } from '../../../../../script.js';

import { defaultExtPrefix, extStates, BlockType } from './common.js';
import { getBlockCombinedContext, updateBlocksDisplay, groupBlocksByContext, addBlocksToExtra,
    getAllEnabledBlocks, purgeBlocksExtra, getPreviousBlockMessageId, injectBlock, getAllGeneratedBlocks,
    getAllRewriteBlocks, getAllPreviousBlocks
 } from './blocks.js';
import { checkAllMacros } from './macros.js';
import { generateBlocks } from './api.js';
import { extractMessageFromData } from './api.js';
import { getMultiBlockContentFromMessage, getBlockFromMessage } from './utils.js';
import { handleBlocksAccumulation } from './accumulationBlocks.js';


export async function handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks, additionalMacro = {}, is_separate = false) {
    const { generatedBlocks, rewriteBlocks } = triggeredBlocks.reduce((acc, block) => {
        if (block.block_type === BlockType.REWRITE) {
            acc.rewriteBlocks.push(block);
        } else {
            acc.generatedBlocks.push(block);
        }
        return acc;
    }, { generatedBlocks: [], rewriteBlocks: [] });

    async function generateRewriteBlocks(generation_order) {
        if (rewriteBlocks.length > 0 && rewriteBlocks.some(block => block.generation_order === generation_order)) {
            toastr.info(`${defaultExtPrefix} Rewriting, please wait...`);
            for (let idx = 0; idx < rewriteBlocks.length; idx++) {
                const rewriteBlock = rewriteBlocks[idx];
                if (rewriteBlock.generation_order === generation_order) {
                    const context = getBlockCombinedContext(rewriteBlock, messageId, allBlocks, additionalMacro);
                    const template = `Block(s) template:\n${substituteParamsExtended(rewriteBlock.template, additionalMacro)}`;
                    const prompt = `Block(s) prompt:\n${substituteParamsExtended(rewriteBlock.prompt, additionalMacro)}`;
                    let fullPrompt = `${context}\n\n\n${template}\n\n${prompt}`;
                    fullPrompt = await checkAllMacros(fullPrompt);
                    const blocksData = await generateBlocks(fullPrompt);
                    const blocks = extractMessageFromData(blocksData);
                    const rewrittenText = getMultiBlockContentFromMessage(blocks, 'rewritten text');
                    chat[messageId].mes = rewrittenText;
                }
            }
            if(chat[messageId].swipe_id) {
                chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
            }
            await updateBlocksDisplay(messageId);
            toastr.success(`${defaultExtPrefix} Rewriting is done!`);
        }
    }

    await generateRewriteBlocks('before');

    const groupedBlocks = groupBlocksByContext(generatedBlocks);

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
                await saveChatConditional();
            };
        }
        toastr.success(`${defaultExtPrefix} Generating is done!`);
    }

    await generateRewriteBlocks('after');
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
            const keyword_predicate = chat[messageId].mes.includes(block.keyword);
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
        if (blockConfig.inject_block && blockConfig.block_type !== BlockType.REWRITE) {
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


export async function handleCharTrigger(messageId) {
    if (['...', ''].includes(chat[messageId]?.mes)) {
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
