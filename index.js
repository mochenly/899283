import { saveSettingsDebounced, callPopup, this_chid, characters, eventSource,
     event_types, chat } from '../../../../script.js';
import { selected_group } from '../../../group-chats.js';
import { extension_settings, writeExtensionField, renderExtensionTemplateAsync } from '../../../extensions.js';
import { download, uuidv4 } from '../../../utils.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument} from '../../../slash-commands/SlashCommandArgument.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';

import { defaultExtPrefix, extStates, path, templates_path, ElementTemplate, ExtSlashCommand, editButton,
    extName, defaultSettings, defaultApiPreset } from './src/common.js';
import { interactiveSortData, selfReloadCurrentChat, getDefaultSet, updateOrInsert, refreshSettings, getRegexForBlock } from './src/utils.js';
import { createRegexForBlocks, purgeAllBlocksDisplayText, importBlock, getBlocksFromExtra,
    purgeBlocksExtra, addBlocksToExtra, loadBlocks, updateBlocksDisplay, checkBlocksInFirstMessage,
    firstSwipeBlockExtra, swipeBlockExtra
 } from './src/blocks.js';
import { populateBlockMacrosBuffer, purgeAllBlocksMacros } from './src/macros.js';
import { changeSet, importSet, importSetFromObject, refreshSetList } from './src/sets.js';
import { loadAPI, loadApiPreset } from './src/api.js';
import { handleUserTrigger, handleCharTrigger, handleBlocksGeneration,
    runBlockGenerationCallback, appendStringToExtraCallback, purgeExtraCallback, runBlockRegenerationCallback,
    runRewriteBlocksCallback, runScriptsExecutionCallback, exportBlocksCallback
 } from './src/handlers.js';
import { openEditor, openAccumulationEditor, openScriptEditor } from './src/editors.js';


function addEditButtons() {
    $('#chat .mes').each(function() {
        if ($(this).find('.extraMesButtons .Extblocks-storage-edit').length === 0) {
            $(this).find('.extraMesButtons').append(editButton);
        }
    });
}

function addEditButtonToLastMessage() {
    var lastMes = $('#chat .mes').last();

    if (lastMes.find('.extraMesButtons .Extblocks-storage-edit').length === 0) {
        lastMes.find('.extraMesButtons').append(editButton);
    }
}

function checkSettings() {
    const extBlocksSettings = extension_settings.ExtBlocks;
    if (!extBlocksSettings.api_presets) {
        const oldPreset = { ...defaultApiPreset };
        if (extBlocksSettings.proxy_preset) {
            oldPreset.proxy_preset = extBlocksSettings.proxy_preset;
            oldPreset.stream = extBlocksSettings.stream;
            const set = extBlocksSettings.sets[extBlocksSettings.active_set_idx];
            if(set) {
                oldPreset.chat_completion_source = set.chat_completion_source;
                oldPreset.model = set.model;
                oldPreset.temperature = set.temperature;
                oldPreset.system_prompt = set.system_prompt;
                oldPreset.assistant_prefill = set.assistant_prefill;
                oldPreset.confirmation_jb = set.confirmation_jb;
            }
        }

        extBlocksSettings.api_presets = {
            'big': { ...oldPreset },
            'medium': { ...oldPreset },
            'small': { ...oldPreset },
        };
        extBlocksSettings.active_api_preset = 'big';
    }
    Object.assign(extBlocksSettings, {
        autohide_display: extBlocksSettings.autohide_display ?? defaultSettings.autohide_display,
        autohide_prompt: extBlocksSettings.autohide_prompt ?? defaultSettings.autohide_prompt,
    });
    saveSettingsDebounced();
}

async function loadSettings() {
    if (!extension_settings.ExtBlocks) {
        extension_settings.ExtBlocks = defaultSettings;
    };
    checkSettings()
    await refreshSettings();

    $('#extblocks_is_enabled').prop('checked', extStates.ExtBlocks_settings.extblocks_is_enabled);
    $('#ExtBlocks-autoregex-display').val(extension_settings.ExtBlocks.autohide_display);
    $('#ExtBlocks-autoregex-prompt').val(extension_settings.ExtBlocks.autohide_prompt);

    refreshSetList();
    
    await loadAPI();
    await loadBlocks();
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
        let newSetHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.NEW_SET_POPUP));
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
        const fileName = `${extStates.current_set.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
        const fileData = JSON.stringify(extStates.current_set, null, 4);
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

    $('#ExtBlocks-autoregex-toggle').off('click').on('click', function () {
        $('#ExtBlocks-autoregex').slideToggle(200, 'swing');
    });
    $('#ExtBlocks-autoregex-display').off('click').on('input', function () {
        const value = $('#ExtBlocks-autoregex-display').val();
        extension_settings.ExtBlocks.autohide_display = String(value);
        saveSettingsDebounced();
    });
    $('#ExtBlocks-autoregex-prompt').off('click').on('input', function () {
        const value = $('#ExtBlocks-autoregex-prompt').val();
        extension_settings.ExtBlocks.autohide_prompt = String(value);
        saveSettingsDebounced();
    });
    $('#ExtBlocks-autoregex-apply').off('click').on('click', async function () {
        const hide_display_blocks = extension_settings.ExtBlocks.autohide_display.split(',').map((name) => name.trim());
        const hide_prompt_blocks = extension_settings.ExtBlocks.autohide_prompt.split(',').map((name) => name.trim());
        extension_settings.regex = extension_settings.regex.filter(item => !item.scriptName.includes(defaultExtPrefix));

        if (hide_display_blocks.length != 0 && hide_display_blocks[0] !== '') {
            const hideDisplayScript = {
                id: uuidv4(),
                scriptName: `${defaultExtPrefix} Hide from display`,
                findRegex: `/${hide_display_blocks.map(name => getRegexForBlock(name)).join('|')}/g`,
                replaceString: '',
                trimStrings: [],
                placement: [1, 2],
                disabled: false,
                markdownOnly: true,
                promptOnly: false,
                runOnEdit: true,
                substituteRegex: false,
                minDepth: null,
                maxDepth: null,
            };
            extension_settings.regex.push(hideDisplayScript);
        }

        if (hide_prompt_blocks.length != 0 && hide_prompt_blocks[0] !== '') {
            const hidePromptScript = {
                id: uuidv4(),
                scriptName: `${defaultExtPrefix} Hide from prompt`,
                findRegex: `/${hide_prompt_blocks.map(name => getRegexForBlock(name)).join('|')}/g`,
                replaceString: '',
                trimStrings: [],
                placement: [1, 2],
                disabled: false,
                markdownOnly: false,
                promptOnly: true,
                runOnEdit: true,
                substituteRegex: false,
                minDepth: null,
                maxDepth: null,
            };
            extension_settings.regex.push(hidePromptScript);
        }

        saveSettingsDebounced();
        await selfReloadCurrentChat();
    });


    $('#ExtBlocks-api-preset').on('change', async function () {
        const presetName = $(this).val();
        extension_settings.ExtBlocks.active_api_preset = presetName;
        saveSettingsDebounced();
        await loadApiPreset();
    });
    
    $('#ExtBlocks-proxy-toggle').off('click').on('click', function () {
        $('#ExtBlocks-proxy').slideToggle(200, 'swing');
    });
    $('#ExtBlocks-proxy-ccsource').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-ccsource').val();
        extStates.api_preset.chat_completion_source = value;
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-stream').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-stream').prop('checked');
        extStates.api_preset.stream = value;
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-preset').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-preset').val();
        extStates.api_preset.proxy_preset = value;
        saveSettingsDebounced();
    });

    $("#ExtBlocks-proxy-ccmodel").select2({
        tags: true
    });

    $('#ExtBlocks-proxy-ccmodel').off('click').on('change', function () {
        const value = $('#ExtBlocks-proxy-ccmodel').val();
        extStates.api_preset.model = value;
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-temperature').off('click').on('input', function () {
        const value = $('#ExtBlocks-proxy-temperature').val();
        extStates.api_preset.temperature = parseFloat(String(value));
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-system').off('click').on('input', function () {
        const value = $('#ExtBlocks-proxy-system').val();
        extStates.api_preset.system_prompt = String(value);
        saveSettingsDebounced();
    });
    $('#ExtBlocks-proxy-prefill').off('click').on('input', function () {
        const value = $('#ExtBlocks-proxy-prefill').val();
        extStates.api_preset.assistant_prefill = String(value);
        saveSettingsDebounced();
    });

    $('#ExtBlocks-enable-jb').off('click').on('click', () => {
        const value = $('#ExtBlocks-enable-jb').prop('checked');
        extStates.api_preset.confirmation_jb = value;

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

    $('#ExtBlocks-blocks-global-openscripteditor').off('click').on('click', () => {
        openScriptEditor(false, false);
    });
    $('#ExtBlocks-blocks-scoped-openscripteditor').off('click').on('click', () => {
        if (this_chid === undefined) {
            toastr.error('No character selected.');
            return;
        }

        if (selected_group) {
            toastr.error('Cannot edit embedded blocks in group chats.');
            return;
        }
        openScriptEditor(false, true);
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

    $('#chat').on('click', '.Extblocks-storage-edit', async function() {
        const messageId = $(this).closest('.mes').attr('mesid');
        const blocksStr = getBlocksFromExtra(messageId);

        let storageEditorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.STORAGE_EDITOR));
        storageEditorHtml.find('.ExtBlocks-storage').val(blocksStr);

        const popupResult = await callPopup(storageEditorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
        if (popupResult) {
            await purgeBlocksExtra(messageId, true);
            await addBlocksToExtra(messageId, storageEditorHtml.find('.ExtBlocks-storage').val());
        }
    });

    $('#chat').on('click', '.custom-menu-button', function() {
        const value = $(this).find('.custom-cyoa-option-value').text();
        $('#send_textarea').val(value);
    });


    let sortableBlocks = [
        {
            selector: '#ExtBlocks-blocks-global-list',
            setter: x => extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks = x,
            getter: () => extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks ?? [],
        },
        {
            selector: '#ExtBlocks-blocks-scoped-list',
            setter: x => writeExtensionField(this_chid, extName, x),
            getter: () => characters[this_chid]?.data?.extensions?.ExtBlocks ?? [],
        },
    ];
    await interactiveSortData(sortableBlocks);
}

jQuery(async () => {
    $('#extensions_settings').append(await renderExtensionTemplateAsync(path, ElementTemplate.SETTINGS));
    await loadSettings();
    await setupListeners();
    eventSource.makeFirst(event_types.CHAT_CHANGED, async () => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            return;
        }

        if (this_chid === undefined) {
            return;
        }

        if (extStates.self_reload_flag) {
            extStates.self_reload_flag = false;
        } else {
            extStates.is_chat_modified = false;
            await loadBlocks();
            populateBlockMacrosBuffer();
        }

        addEditButtons();
    });
    eventSource.makeFirst(event_types.MESSAGE_EDITED, () => {
        extStates.is_chat_modified = true;
    });
    eventSource.makeLast(event_types.MESSAGE_UPDATED, (messageId) => {
        if (extension_settings.ExtBlocks.extblocks_is_enabled) {
            updateBlocksDisplay(messageId);
        }
    });
    eventSource.on(event_types.MESSAGE_DELETED, () => extStates.is_chat_modified = true);
    eventSource.makeFirst(event_types.USER_MESSAGE_RENDERED, async (messageId) => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            return;
        }
        
        await handleUserTrigger(messageId);
        addEditButtonToLastMessage();
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
        addEditButtonToLastMessage();
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

    eventSource.on("/fatpresets/import/extblocks", ({ setObject, returnCode }) => {
        const isOk = importSetFromObject(setObject);
        returnCode.code = isOk;
    });
    
    eventSource.on("/fatpresets/change/extblocks", async ({ presetName, reloadFlag }) => {
        if (!extension_settings.ExtBlocks.extblocks_is_enabled) {
            extension_settings.ExtBlocks.extblocks_is_enabled = true;
            $('#extblocks_is_enabled').prop('checked', extension_settings.ExtBlocks.extblocks_is_enabled);
            await createRegexForBlocks(false, true);
            reloadFlag.value = true;
            if (this_chid !== undefined) {
                populateBlockMacrosBuffer();
            }
            saveSettingsDebounced();
        }
        if (extension_settings.ExtBlocks.active_set === presetName) return;
        
        const index = extension_settings.ExtBlocks.sets.findIndex(set => set.name === presetName);
        if (index !== -1) {
            await changeSet(index);
        }
    });
    
    eventSource.on("/fatpresets/disable/extblocks", async () => {
        extension_settings.ExtBlocks.extblocks_is_enabled = false;
        $('#extblocks_is_enabled').prop('checked', extension_settings.ExtBlocks.extblocks_is_enabled);
        if (this_chid !== undefined) {
            purgeAllBlocksMacros();
            await purgeAllBlocksDisplayText();
        }
        saveSettingsDebounced();
    });

    eventSource.on(`/extblocks/generate`, async (messageId, isUser, allBlocks, triggeredBlocks, callback) => {
        const blocksList = await handleBlocksGeneration(messageId, isUser, allBlocks, triggeredBlocks);
        
        if (!callback) return;
        try {
            callback(blocksList);
        } catch (error) {
            console.log(error);
            return;
        }
    })


    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.GENERATE,
        callback: runBlockGenerationCallback,
        returns: 'void',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'block name(s)',
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
        helpString: 'Starts generating block(s) by its/their name.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.STORAGE_APPEND,
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
        name: ExtSlashCommand.STORAGE_PURGE,
        callback: purgeExtraCallback,
        returns: 'void',
        helpString: 'Purge the last message block storage.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.REGENERATE,
        callback: runBlockRegenerationCallback,
        returns: 'void',
        helpString: 'Regenerates last blocks.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.FLUSH_INJECTS,
        callback: async () => await selfReloadCurrentChat(),
        returns: 'void',
        helpString: 'Flushes ExtBlocks injects.',
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.STORAGE_EXPORT,
        callback: async () => await exportBlocksCallback(),
        returns: 'void',
        helpString: 'Exports each enabled block to a system message.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.REWRITE,
        callback: runRewriteBlocksCallback,
        returns: 'void',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'rewrite block name(s)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            })
        ],
        unnamedArgumentList: [
            new SlashCommandArgument(
                'additional prompt', [ARGUMENT_TYPE.STRING], false, false, ''
            ),
        ],
        helpString: 'Rewrites the last message using rewriting blocks.',
    }));
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: ExtSlashCommand.EXECUTE_SCRIPT,
        callback: runScriptsExecutionCallback,
        returns: 'void',
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'name',
                description: 'script block name(s)',
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
            })
        ],
        helpString: 'Executes script blocks.',
    }));

    console.log(`${defaultExtPrefix} extension loaded`);
});
