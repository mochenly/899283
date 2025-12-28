import { defaultExtPrefix, ExtTopic } from '../core/constants.js';
import { extStates } from '../core/state.js';
import {
    stringToRegex,
    removeAfterRegexMatch,
    removeAfterSubstring
} from '../utils/stringUtils.js';
import { BlockService } from '../services/BlockService.js';
import { GenerationService } from '../services/GenerationService.js';
import { MacroService } from '../services/MacroService.js';
import { SettingsService } from '../services/SettingsService.js';
import { MainUI } from './MainUI.js';

const { 
    eventSource, 
    event_types, 
    chat,
    extensionSettings,
    saveSettingsDebounced,
    updateMessageBlock,
    saveChat,
    stopGeneration
} = SillyTavern.getContext();

export const EventController = {
    /**
     * Initializes all event listeners for the extension.
     */
    init() {
        eventSource.makeFirst(event_types.CHAT_CHANGED, async () => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled) {
                return;
            }

            if (SillyTavern.getContext().characterId === undefined) {
                return;
            }

            if (extStates.self_reload_flag) {
                extStates.self_reload_flag = false;
            } else {
                extStates.is_chat_modified = false;
                await MainUI.loadBlocks();
                extStates.cachedPauseBlocks = null;
                extStates.pauseCounter = 0;
            }

            MainUI.addEditButtons();
        });

        eventSource.makeFirst(event_types.MESSAGE_EDITED, () => {
            extStates.is_chat_modified = true;
        });

        eventSource.makeLast(event_types.MESSAGE_UPDATED, (messageId) => {
            if (extensionSettings.ExtBlocks.extblocks_is_enabled) {
                BlockService.updateBlocksDisplay(messageId);
            }
        });

        eventSource.on(event_types.MESSAGE_DELETED, () => extStates.is_chat_modified = true);


        eventSource.on(event_types.GENERATION_AFTER_COMMANDS, (type, data, dryRun) => {
            if (!dryRun) {
                BlockService.injectAllEnabledBlocks(chat.length - 1);
            }
        });

        eventSource.makeFirst(event_types.USER_MESSAGE_RENDERED, async (messageId) => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled) {
                return;
            }
            
            await GenerationService.handleUserTrigger(messageId);
            MainUI.addEditButtonToLastMessage();
        });

        eventSource.makeFirst(event_types.CHARACTER_MESSAGE_RENDERED, async (messageId) => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled) {
                return;
            }

            extStates.cachedPauseBlocks = null;
            if (extStates.generationPaused) {
                await GenerationService.handleMessageTrigger(messageId, false);
                extStates.generationPaused = false;
                setTimeout(() => {
                    $('#send_but').trigger('click');
                    toastr.info(`${defaultExtPrefix} Generation resumed...`);
                }, 1000);
            } else if (messageId > 0) {
                await GenerationService.handleCharTrigger(messageId);
                if (messageId > 2) {
                    await BlockService.updateBlocksDisplay(messageId - 2);
                }
                extStates.pauseCounter = 0;
            } else {
                await BlockService.checkBlocksInFirstMessage();
            }
            MainUI.addEditButtonToLastMessage();
        });

        eventSource.makeFirst(event_types.MESSAGE_RECEIVED, async (messageId) => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled || !extStates.generationPaused || !extStates.triggeredPauseBlock) {
                return;
            }
        
            const block = extStates.triggeredPauseBlock;
            const message = chat[messageId];
        
            if (block.keyword_is_regex) {
                const regex = stringToRegex(block.keyword);
                message.mes = removeAfterRegexMatch(message.mes, regex);
            } else {
                message.mes = removeAfterSubstring(message.mes, block.keyword);
            }
        
            if (message.swipes) {
                message.swipes[message.swipe_id] = message.mes;
            }
        
            extStates.triggeredPauseBlock = null;
        
            updateMessageBlock(messageId, message, { rerenderMessage: true });
            await saveChat();
        });
        
        eventSource.makeFirst(event_types.MESSAGE_SWIPED, async (messageId) => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled) {
                return;
            }

            const current_swipe_id = chat[messageId].swipe_id;
            if (messageId !== 0) {
                if (current_swipe_id === chat[messageId].swipes.length) {
                    if (current_swipe_id === 1) {
                        BlockService.firstSwipeBlockExtra(messageId);
                    }
                    await GenerationService.handleUserTrigger(messageId - 1, true);
                    await BlockService.swipeBlockExtra(messageId, current_swipe_id, false);
                } else {
                    await BlockService.swipeBlockExtra(messageId, current_swipe_id);
                }
            } else {
                await BlockService.checkBlocksInFirstMessage();
                await BlockService.swipeBlockExtra(messageId, current_swipe_id);
            }
        });

        eventSource.makeFirst(event_types.STREAM_TOKEN_RECEIVED, (text) => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled || extStates.generationPaused) {
                return;
            }

            if (extStates.cachedPauseBlocks === null) {
                const allBlocks = BlockService.getAllEnabledBlocks();
                extStates.cachedPauseBlocks = allBlocks
                    .filter(b => b.generation_pause && b.keyword)
                    .map(b => ({ block: b, regex: stringToRegex(b.keyword) }))
                    .filter(item => item.regex);
            }
        
            for (const item of extStates.cachedPauseBlocks) {
                if (item.regex.test(text)) {
                    extStates.generationPaused = true;
                    extStates.pauseCounter++;
                    extStates.triggeredPauseBlock = item.block;
                    extStates.cachedPauseBlocks = null;
                    toastr.info(`${defaultExtPrefix} Generation paused...`);
                    stopGeneration();
                    return;
                }
            }
        });
    
        eventSource.on(ExtTopic.FATPRESETS_IMPORT, ({ setObject, returnCode }) => {
            const isOk = SettingsService.importSetFromObject(setObject);
            returnCode.code = isOk;
        });
        
        eventSource.on(ExtTopic.FATPRESETS_CHANGE, async ({ presetName, reloadFlag }) => {
            if (!extensionSettings.ExtBlocks.extblocks_is_enabled) {
                extensionSettings.ExtBlocks.extblocks_is_enabled = true;
                $('#extblocks_is_enabled').prop('checked', extensionSettings.ExtBlocks.extblocks_is_enabled);
                await BlockService.updateDisplayForBlocks();
                reloadFlag.value = true;
                MacroService.registerExtensionMacros();
                saveSettingsDebounced();
            }
            if (extensionSettings.ExtBlocks.active_set === presetName) return;
            
            const index = extensionSettings.ExtBlocks.sets.findIndex(set => set.name === presetName);
            if (index !== -1) {
                await SettingsService.changeSet(index);
            }
        });
        
        eventSource.on(ExtTopic.FATPRESETS_DISABLE, async () => {
            extensionSettings.ExtBlocks.extblocks_is_enabled = false;
            $('#extblocks_is_enabled').prop('checked', extensionSettings.ExtBlocks.extblocks_is_enabled);
            MacroService.unregisterExtensionMacros();
            if (SillyTavern.getContext().characterId !== undefined) {
                await BlockService.purgeAllBlocksDisplayText();
            }
            saveSettingsDebounced();
        });

        eventSource.on(ExtTopic.GENERATE_BLOCKS, async (messageId, isUser, allBlocks, triggeredBlocks, callback) => {
            const blocksList = await GenerationService.handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
            
            if (!callback) return;
            try {
                callback(blocksList);
            } catch (error) {
                console.log(`${defaultExtPrefix} ${error}`);
                return;
            }
        });
    }
};
