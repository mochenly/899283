import { getFileText } from '../../../../../utils.js';
import { extStates } from '../core/state.js';
import { extName, BlockType, defaultExtPrefix, MessageRole } from '../core/constants.js';
import { ContextService } from './ContextService.js';
import { getBlockEncloseRegex, getRegexForBlock, getBlockFromMessageWithRegex } from '../utils/blockUtils.js';
import { updateOrInsert } from '../utils/dataUtils.js';

const {
    saveSettingsDebounced,
    writeExtensionField,
    characters,
    chat,
    updateMessageBlock,
    saveChat,
    uuidv4,
    reloadCurrentChat,
    extensionSettings,
    setExtensionPrompt,
    extensionPrompts,
    substituteParams
} = SillyTavern.getContext();

export const BlockService = {
    /**
     * Gets all blocks (global + scoped) combined with priority.
     */
    getAllBlocks() {
        const embeddedBlocks = characters[SillyTavern.getContext().characterId]?.data?.extensions?.ExtBlocks ?? [];
        const globalBlocks = extStates.current_set?.global_blocks ?? [];
        
        const combined = {};
        embeddedBlocks.forEach(obj => {
            combined[obj.name] = obj;
        });

        globalBlocks.forEach(obj => {
            if (!combined[obj.name]) {
                combined[obj.name] = obj;
            }
        });
        return Object.values(combined);
    },

    /**
     * Gets all enabled blocks.
     */
    getAllEnabledBlocks() {
        return this.getAllBlocks().filter(item => !item.disabled);
    },

    /**
     * Gets blocks by type.
     */
    getBlocksByType(types, enabledOnly = false) {
        const blocks = enabledOnly ? this.getAllEnabledBlocks() : this.getAllBlocks();
        return blocks.filter(block => types.includes(block.block_type ?? BlockType.GENERATED));
    },

    /**
     * Saves or updates a block.
     */
    async saveBlock(block, index, isScoped) {
        const array = this._getBlockArray(isScoped);

        if (!block.id) {
            block.id = uuidv4();
        }

        if (!block.name) {
            toastr.error('Could not save block: The block name was undefined or empty!');
            return;
        }

        const existingData = array.find((e) => e.name === block.name);
        if (existingData && index === -1) {
            toastr.error('Could not save block: The block name must be unique.');
            return;
        }

        if (index !== -1) {
            array[index] = block;
        } else {
            array.push(block);
        }

        if (isScoped) {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            await writeExtensionField(SillyTavern.getContext().characterId, extName, array);
        }

        saveSettingsDebounced();
    },

    /**
     * Deletes a block by ID.
     */
    async deleteBlock(id, isScoped) {
        const array = this._getBlockArray(isScoped);
        const index = array.findIndex((block) => block.id === id);
        
        if (index !== -1) {
            array.splice(index, 1);
            if (isScoped) {
                await writeExtensionField(SillyTavern.getContext().characterId, extName, array);
            }
            saveSettingsDebounced();
        }
    },

    /**
     * Purges display text for a message.
     */
    purgeBlocksDisplayText(messageId) {
        if (chat[messageId]?.extra?.display_text) {
            delete chat[messageId].extra.display_text;
        }
    },

    /**
     * Purges block storage from a message.
     */
    async purgeBlocksExtra(messageId, noUpdate = false) {
        const message = chat[messageId];
        if (!message || !message.extra) return;

        message.extra.extblocks = '';

        if (message.swipe_id) {
            const current_swipe_id = message.swipe_id;
            if (message.swipe_info?.[current_swipe_id]?.extra) {
                message.swipe_info[current_swipe_id].extra.extblocks = '';
            }
        }

        if (!noUpdate) {
            await this.updateBlocksDisplay(messageId);
            await saveChat();
        }
    },

    /**
     * Purges display text for all messages in the chat.
     */
    async purgeAllBlocksDisplayText() {
        for (let messageId = 0; messageId < chat.length; messageId++) {
            const message = chat[messageId];
            if (message && message.extra && message.extra.display_text) {
                delete message.extra.display_text;
            }

            updateMessageBlock(messageId, message);
        }
        await saveChat();
    },

    /**
     * Gets blocks from message extra storage.
     */
    getBlocksFromExtra(messageId) {
        return chat[messageId]?.extra?.extblocks || '';
    },

    /**
     * Gets all enabled blocks as a combined string from previous messages.
     */
    getAllPreviousBlocks() {
        const blocks = this.getAllEnabledBlocks();
        let blocksStrArray = [];
        blocks.forEach(block => {
            blocksStrArray.push(ContextService.getPreviousBlockContextUnconditional(block, chat.length - 1, true).trim());
        });

        return blocksStrArray.join('\n\n');
    },

    /**
     * Adds blocks to message extra storage.
     */
    async addBlocksToExtra(messageId, blocksStr) {
        let effectiveId = Math.max(Math.min(messageId, chat.length - 1), 0);
        const message = chat[effectiveId];
        if (!message) return;

        if (!message.extra) message.extra = {};

        const blockNames = [...blocksStr.matchAll(/<([^\/\s>]+)/g)].map(match => match[1]);
        const purgeBlocks = (content) => {
            let result = content || '';
            for (const name of blockNames) {
                const purgeRegex = new RegExp(getRegexForBlock(name), 'g');
                result = result.replace(purgeRegex, '').trim();
            }
            return result;
        };

        const currentExtBlocks = purgeBlocks(message.extra.extblocks);
        message.extra.extblocks = (currentExtBlocks === '' ? blocksStr : `${currentExtBlocks}\n${blocksStr}`).trim();

        if (message.swipe_id) {
            const swipeId = message.swipe_id;
            if (!message.swipe_info) message.swipe_info = {};
            if (!message.swipe_info[swipeId]) {
                message.swipe_info[swipeId] = {
                    send_date: message.send_date,
                    gen_started: message.gen_started,
                    gen_finished: message.gen_finished,
                    extra: {},
                };
            };
            if (!message.swipe_info[swipeId].extra) message.swipe_info[swipeId].extra = {};
            
            const swipeExtra = message.swipe_info[swipeId].extra;
            const currentSwipeExtBlocks = purgeBlocks(swipeExtra.extblocks);
            swipeExtra.extblocks = (currentSwipeExtBlocks === '' ? blocksStr : `${currentSwipeExtBlocks}\n${blocksStr}`).trim();
        }

        await this.updateBlocksDisplay(effectiveId);
        await saveChat();
    },

    /**
     * Updates the display text of a message based on its blocks.
     */
    async updateBlocksDisplay(messageId) {
        const message = chat[messageId];
        if (!message) return;

        if (!message.extra?.extblocks) {
            if (message.extra?.display_text) {
                delete message.extra.display_text;
            }
        } else {
            const allBlocks = this.getAllBlocks();
            const blocksToDisplay = [];
            for (const block of allBlocks) {
                if (!block.hide_display) {
                    const blockContent = getBlockFromMessageWithRegex(message.extra.extblocks, getBlockEncloseRegex(block.name));
                    if (blockContent) {
                        blocksToDisplay.push(blockContent);
                    }
                }
            }
            message.extra.display_text = message.mes + `\n${blocksToDisplay.join("\n")}`;
        }

        updateMessageBlock(messageId, message);
    },

    /**
     * Updates display text for all messages in the chat.
     */
    async updateAllBlocksDisplayText() {
        for (let messageId = 0; messageId < chat.length; messageId++) {
            await this.updateBlocksDisplay(messageId);
        }

        await saveChat();
    },

    /**
     * Gets the full prompt for a group of blocks, including context and template.
     */
    getBlocksFullPrompt(blocks, messageId, allBlocks, additionalMacro = {}) {
        if (SillyTavern.getContext().characterId === undefined) {
            return [];
        }

        let combinedTemplate = `Block(s) template:\n${blocks.map(block => substituteParams(block.template, { dynamicMacros: additionalMacro })).join('\n')}`;
        let combinedPrompt = `Block(s) prompt:\n${blocks.map(block => substituteParams(block.prompt, { dynamicMacros: additionalMacro })).join('\n')}`;
        
        let combinedContext = [];
        if (blocks.length > 0) {
            combinedContext = ContextService.getBlockCombinedContext(blocks[0], messageId, allBlocks, additionalMacro);
        }

        if (combinedContext.length > 0 && combinedContext[0].role === MessageRole.SYSTEM) {
            combinedContext[0].content = `${combinedPrompt}\n\n${combinedTemplate}\n\n${combinedContext[0].content}`
        } else if (combinedContext.length > 0) {
            combinedContext.unshift({ role: MessageRole.SYSTEM, content: `${combinedPrompt}\n\n${combinedTemplate}` });
        } else {
            combinedContext = [{ role: MessageRole.USER, content: `${combinedPrompt}\n\n${combinedTemplate}` }];
        }

        return combinedContext;
    },

    /**
     * Gets the full prompt for a single block, including context and template.
     */
    getSingleBlockFullPrompt(block, messageId, allBlocks, additionalMacro = {}) {
        if (messageId === undefined) {
            messageId = chat.length - 1;
        }
        if (allBlocks === undefined) {
            allBlocks = this.getAllEnabledBlocks();
        }
        return this.getBlocksFullPrompt([block], messageId, allBlocks, additionalMacro);
    },

    /**
     * Handles swipe block extra storage.
     */
    async swipeBlockExtra(messageId, swipeId, updateDisplay = true) {
        const message = chat[messageId];
        if (!message) return;

        if (message.swipe_info?.[swipeId]?.extra?.extblocks) {
            message.extra.extblocks = message.swipe_info[swipeId].extra.extblocks;
        } else {
            message.extra.extblocks = '';
        }

        if (updateDisplay) {
            await this.updateBlocksDisplay(messageId);
            await saveChat();
        }
    },

    /**
     * Sets the first swipe block extra storage.
     */
    firstSwipeBlockExtra(messageId) {
        const message = chat[messageId];
        if (!message || !message.extra) return;

        if (!message.swipe_info) message.swipe_info = {};
        if (!message.swipe_info[0]) {
            message.swipe_info[0] = {
                send_date: message.send_date,
                gen_started: message.gen_started,
                gen_finished: message.gen_finished,
                extra: {},
            };
        };
        if (!message.swipe_info[0].extra) message.swipe_info[0].extra = {};

        message.swipe_info[0].extra.extblocks = message.extra.extblocks || '';
    },

    /**
     * Checks for blocks in the first message and moves them to extra storage.
     */
    async checkBlocksInFirstMessage() {
        if (!chat[0]) return;

        const allBlocks = this.getAllBlocks();
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
            await this.addBlocksToExtra(0, blocksStr);
        }
    },

    /**
     * Imports a block from a JSON object.
     */
    async importBlock(blockOrFile, isScoped) {
        let block = blockOrFile;

        if (blockOrFile instanceof File) {
            try {
                const fileText = await getFileText(blockOrFile);
                block = JSON.parse(fileText);
            } catch (error) {
                console.error(error);
                toastr.error('Invalid JSON file.');
                return false;
            }
        }

        if (!block || !block.name) {
            toastr.error('Could not import block: No name provided.');
            return false;
        }

        if (!block.id) {
            block.id = uuidv4();
        }

        const array = this._getBlockArray(isScoped);
        const existingData = array.find((e) => e.id === block.id);
        const idx = updateOrInsert(array, block);
        
        if (existingData && idx === array.length - 1) {
            toastr.error('Could not import block: The block id must be unique.');
            array.splice(idx, 1);
            return false;
        }

        if (isScoped) {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return false;
            }
            await writeExtensionField(SillyTavern.getContext().characterId, extName, array);
        }

        saveSettingsDebounced();
        toastr.success(`ExtBlocks block "${block.name}" imported.`);
        return true;
    },

    /**
     * Injects a block into the extension prompt.
     */
    injectBlock(block, blockConfig) {
        const key = `${defaultExtPrefix} ${blockConfig.name}`;
        const position = blockConfig.injection_position;
        const role = blockConfig.injection_role;
        let depth = blockConfig.injection_depth;
        if (depth < 0) {
            depth = chat.length - depth;
        }
        setExtensionPrompt(key, block, position, depth, true, role);
    },

    /**
     * Removes the block inject from the extension prompt.
     */
    removeBlockInject(blockConfig) {
        const blockKey = `${defaultExtPrefix} ${blockConfig.name}`;
        for (const key of Object.keys(extensionPrompts)) {
            if (key === blockKey) {
                delete extensionPrompts[key];
            }
        }
    },

    /**
     * Removes all block injects from the extension prompt.
     */
    removeAllBlockInjects() {
        for (const key of Object.keys(extensionPrompts)) {
            if (key.startsWith(defaultExtPrefix)) {
                delete extensionPrompts[key];
            }
        }
    },

    /**
     * Reloads the current chat if enabled.
     */
    async selfReloadCurrentChat() {
        if (SillyTavern.getContext().characterId !== undefined && extensionSettings.ExtBlocks.extblocks_is_enabled) {
            extStates.self_reload_flag = true;
            await reloadCurrentChat();
        }
    },

    /**
     * Updates display text for blocks.
     */
    async updateDisplayForBlocks() {
        if (SillyTavern.getContext().characterId !== undefined) {
            await this.updateAllBlocksDisplayText();
        }
    },

    /**
     * Internal helper to get the correct block array.
     */
    _getBlockArray(isScoped) {
        if (isScoped) {
            return characters[SillyTavern.getContext().characterId]?.data?.extensions?.ExtBlocks ?? [];
        }
        return extStates.current_set?.global_blocks ?? [];
    }
};