import { system_avatar, system_message_types } from '../../../../../../script.js';
import { BlockType, defaultExtPrefix, ExtTopic } from '../core/constants.js';
import { extStates } from '../core/state.js';
import { ApiService } from '../services/ApiService.js';
import { BlockService } from '../services/BlockService.js';
import { MacroService } from '../services/MacroService.js';

const { chat, eventSource, event_types, addOneMessage, saveChat } = SillyTavern.getContext();

/**
 * Plugin for handling standard Generated blocks.
 */
export const GeneratedPlugin = {
    type: BlockType.GENERATED,

    /**
     * Groups blocks by their context.
     */
    groupBlocksByContext(blocks) {
        const contextToString = (block) => `${block.background ? 'bg_' : ''}${block.context.map(item => item.name).join('_')}`;
        const groupedBlocks = {};

        blocks.forEach(block => {
            const contextStr = contextToString(block);
            if (!groupedBlocks[contextStr]) {
                groupedBlocks[contextStr] = [];
            }
            groupedBlocks[contextStr].push(block);
        });

        return groupedBlocks;
    },

    /**
     * Generates content for a group of blocks.
     */
    async generateBlockContent(blocksInGroup, messageId, allBlocks, additionalMacro = {}) {
        const apiPresetName = blocksInGroup[0].api_preset;
        let combinedContext = BlockService.getBlocksFullPrompt(blocksInGroup, messageId, allBlocks, additionalMacro);

        combinedContext = await MacroService.checkAllMacros(combinedContext);

        const blocksData = await ApiService.generateBlocks(combinedContext, apiPresetName);
        const preset = apiPresetName ? extStates.ExtBlocks_settings.api_presets[apiPresetName] : extStates.api_preset;
        let blocks = ApiService.extractMessageFromData(blocksData, preset);

        function removeBackticks(codeString) {
            if (codeString.startsWith("```") && codeString.endsWith("```")) {
                return codeString.slice(codeString.indexOf('\n') > -1 ? codeString.indexOf('\n') + 1 : 3, -3);
            }
            return codeString;
        }
        return removeBackticks(blocks);
    },

    /**
     * Executes the generation for the provided blocks.
     * @param {Object[]} blocks - The generated blocks to process.
     * @param {Object} options - Execution options.
     * @param {number} options.messageId - The ID of the message being processed.
     * @param {Object[]} options.allBlocks - All enabled blocks.
     * @param {Object} [options.additionalMacro] - Additional macros for substitution.
     * @param {boolean} [options.is_separate] - Whether to create a separate message for the output.
     * @returns {Promise<string[]>} List of generated block contents.
     */
    async execute(blocks, options = {}) {
        const { messageId, allBlocks, additionalMacro = {}, is_separate = false } = options;
        const groupedBlocks = this.groupBlocksByContext(blocks);
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
                const generatedContent = await this.generateBlockContent(blocksInGroup, messageId, allBlocks, additionalMacro);
                eventSource.emit(ExtTopic.BLOCKS_GENERATED, { blocks: generatedContent, messageId });

                if (!is_separate) {
                    await BlockService.addBlocksToExtra(messageId, generatedContent);
                } else {
                    const message = {
                        name: 'System', is_user: false, is_system: true, mes: generatedContent, force_avatar: system_avatar,
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
                    await saveChat();
                }

                if (isBackground) {
                    toastr.success(`${defaultExtPrefix} Background generation for "${blocksInGroup.map(b => b.name).join(', ')}" is done!`);
                }
                return generatedContent;
            };

            if (isBackground) {
                generationTask().catch(err => {
                    console.error(`${defaultExtPrefix} Background generation failed:`, err);
                    toastr.error(`${defaultExtPrefix} Background generation failed for "${blocksInGroup.map(b => b.name).join(', ')}".`);
                });
            } else {
                const generatedContent = await generationTask();
                blocksList.push(generatedContent);
            }
        }

        if (hasForegroundBlocks) {
            toastr.success(`${defaultExtPrefix} Generating is done!`);
        }
        return blocksList;
    }
};