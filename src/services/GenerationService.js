import { BlockType } from '../core/constants.js';
import { extStates } from '../core/state.js';
import { PluginRegistry } from '../core/PluginRegistry.js';
import { BlockService } from './BlockService.js';
import { ContextService } from './ContextService.js';
import { getBlockFromMessage } from '../utils/blockUtils.js';
import { stringToRegex } from '../utils/stringUtils.js';

const { chat } = SillyTavern.getContext();

export const GenerationService = {
    /**
     * Categorizes blocks into generated, rewrite, and script blocks.
     */
    categorizeBlocks(triggeredBlocks) {
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
    },

    /**
     * Orchestrates the generation of blocks, including scripts and rewrites.
     */
    async handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks, additionalMacro = {}, is_separate = false) {
        const { generatedBlocks, rewriteBlocks, scriptBlocks } = this.categorizeBlocks(triggeredBlocks);
        
        const scriptPlugin = PluginRegistry.get(BlockType.SCRIPT);
        const rewritePlugin = PluginRegistry.get(BlockType.REWRITE);
        const generatedPlugin = PluginRegistry.get(BlockType.GENERATED);

        if (scriptPlugin) await scriptPlugin.execute(scriptBlocks, { execution_order: 'before' });
        if (rewritePlugin) await rewritePlugin.execute(rewriteBlocks, { messageId, allBlocks, generation_order: 'before', additionalMacro });

        let blocksList = [];
        if (generatedPlugin) {
            blocksList = await generatedPlugin.execute(generatedBlocks, { messageId, allBlocks, additionalMacro, is_separate });
        }

        if (rewritePlugin) await rewritePlugin.execute(rewriteBlocks, { messageId, allBlocks, generation_order: 'after', additionalMacro });
        if (scriptPlugin) await scriptPlugin.execute(scriptBlocks, { execution_order: 'after' });

        return blocksList;
    },

    /**
     * Gets accumulation blocks triggered by the given text.
     */
    getTriggeredAccumulationBlocks(allBlocks, text, isUser) {
        return allBlocks.filter((block) => {
            if (block.block_type !== BlockType.ACCUMULATION) {
                return false;
            }
            const trigger_predicate = isUser ? block.user_message : block.char_message;
            return trigger_predicate && text.includes(`<${block.updater_name}>`);
        });
    },

    /**
     * Orchestrates the accumulation of blocks.
     */
    async handleBlocksAccumulation(messageId, isUser, allBlocks, externalContent = null) {
        const text = externalContent || chat[messageId].mes;
        const triggeredAccumulationBlocks = this.getTriggeredAccumulationBlocks(allBlocks, text, isUser);
        const accumulationPlugin = PluginRegistry.get(BlockType.ACCUMULATION);
        if (accumulationPlugin && triggeredAccumulationBlocks.length > 0) {
            await accumulationPlugin.execute(triggeredAccumulationBlocks, { messageId, externalContent });
        }
    },

    /**
     * Handles message triggers for both user and character messages.
     */
    async handleMessageTrigger(messageId, isUser) {
        const allBlocks = BlockService.getAllEnabledBlocks();
        let messageText = chat[messageId].mes;

        if (extStates.pauseCounter > 0 && !isUser) {
            const messagesToCombine = chat.slice(Math.max(0, messageId - extStates.pauseCounter), messageId + 1);
            messageText = messagesToCombine.map(m => m.mes).join('\n');
        }

        await this.handleBlocksAccumulation(messageId, isUser, allBlocks);

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
        
        const generatedBlocksList = await this.handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
        if (generatedBlocksList && generatedBlocksList.length > 0) {
            const combinedGeneratedContent = generatedBlocksList.join('\n');
            await this.handleBlocksAccumulation(messageId, isUser, allBlocks, combinedGeneratedContent);
        }
    },

    /**
     * Handles user message triggers.
     */
    async handleUserTrigger(messageId, is_swipe = false) {
        if (chat[messageId].is_system) {
            return;
        }

        if ((!is_swipe) || (is_swipe && extStates.is_chat_modified && chat[messageId].is_user)) {
            extStates.pauseCounter = 0;
            await BlockService.purgeBlocksExtra(messageId, true);
            extStates.is_chat_modified = false;
            await this.handleMessageTrigger(messageId, true);
        }
        const allBlocks = BlockService.getAllEnabledBlocks();
        allBlocks.forEach(blockConfig => {
            if (blockConfig.inject_block && blockConfig.block_type !== BlockType.REWRITE && blockConfig.block_type !== BlockType.SCRIPT) {
                const previous_block_full = ContextService.getPreviousBlockContextUnconditional(blockConfig, messageId, true, 1);
                if (previous_block_full) {
                    const previous_block_content = getBlockFromMessage(previous_block_full, blockConfig.name);
                    BlockService.injectBlock(previous_block_content, blockConfig);
                }
            }
        });
    },

    /**
     * Handles character message triggers.
     */
    async handleCharTrigger(messageId) {
        if (['...', ''].includes(chat[messageId]?.mes)) {
            return;
        }

        if (chat[messageId]?.mes.includes('Proxy error')) {
            return;
        }

        await BlockService.purgeBlocksExtra(messageId, true);

        extStates.is_chat_modified = false;
        await this.handleMessageTrigger(messageId, false);
    }
};