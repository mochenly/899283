import { download } from '../../../../../utils.js';
import { 
    templates_path, 
    ElementTemplate, 
    selectionRewriteButton 
} from '../core/constants.js';
import { extStates } from '../core/state.js';
import { updateOrInsert } from '../utils/dataUtils.js';
import { SettingsService } from '../services/SettingsService.js';
import { MacroService } from '../services/MacroService.js';
import { BlockService } from '../services/BlockService.js';
import { MainUI } from './MainUI.js';
import { ApiService } from '../services/ApiService.js';
import { GeneratedEditor } from './editors/GeneratedEditor.js';
import { AccumulationEditor } from './editors/AccumulationEditor.js';
import { ScriptEditor } from './editors/ScriptEditor.js';
import { SelectionRewriteController } from './SelectionRewriteController.js'

const { 
    saveSettingsDebounced, extensionSettings,
    renderExtensionTemplateAsync, callPopup
 } = SillyTavern.getContext();
 
export const SettingsUI = {
    /**
     * Refreshes the set list in the settings panel.
     */
    refreshSetList() {
        let sets_name = extStates.ExtBlocks_settings.sets.map(obj => obj.name);
        $('#ExtBlocks-preset-list').empty();
        sets_name.forEach(function(option) {
            $('#ExtBlocks-preset-list').append($('<option>', {
                value: option,
                text: option
            }));
        });
        $(`#ExtBlocks-preset-list option[value="${extStates.ExtBlocks_settings.active_set}"]`).attr('selected', true);
    },

    /**
     * Sets up all event listeners for the settings panel.
     */
    async setupListeners() {
        $('#extblocks_is_enabled').off('click').on('click', async () => {
            const value = $('#extblocks_is_enabled').prop('checked');
            extensionSettings.ExtBlocks.extblocks_is_enabled = value;
            if (value) {
                await BlockService.updateDisplayForBlocks();
                MacroService.registerExtensionMacros();
            } else {
                MacroService.unregisterExtensionMacros();
                if (SillyTavern.getContext().characterId !== undefined) {
                    await BlockService.purgeAllBlocksDisplayText();
                    BlockService.removeAllBlockInjects();
                }
            }
            saveSettingsDebounced();
        });

        $('#ExtBlocks-preset-list').on('change', async function () {
            const idx = $('#ExtBlocks-preset-list').prop('selectedIndex');
            await SettingsService.changeSet(idx);
        }.bind(this));

        $('#ExtBlocks-preset-new').on('click', async function () {
            let newSetHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.NEW_SET_POPUP));
            const popupResult = await callPopup(newSetHtml, 'confirm', undefined, { okButton: 'Save' });
            if (popupResult) {
                let newSet = SettingsService.getDefaultSet();
                newSet.name = String(newSetHtml.find('.ExtBlocks-newset-name').val());
                const set_idx = updateOrInsert(extensionSettings.ExtBlocks.sets, newSet);
                await SettingsService.changeSet(set_idx);
                this.refreshSetList();
            }
        }.bind(this));

        $('#ExtBlocks-preset-importFile').on('change', async function () {
            const inputElement = /** @type {HTMLInputElement} */ (this);
            if (!inputElement.files) return;
            for (const file of inputElement.files) {
                await SettingsService.importSet(file);
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

            extensionSettings.ExtBlocks.sets.splice(extensionSettings.ExtBlocks.active_set_idx, 1);
            if (extensionSettings.ExtBlocks.sets.length != 0) {
                await SettingsService.changeSet(0);
            } else {
                const set_idx = updateOrInsert(extensionSettings.ExtBlocks.sets, SettingsService.getDefaultSet());
                await SettingsService.changeSet(set_idx);
            }
        }.bind(this));

        $('#ExtBlocks-api-preset').on('change', async function () {
            const presetName = $(this).val();
            extensionSettings.ExtBlocks.active_api_preset = presetName;
            saveSettingsDebounced();
            await ApiService.loadApiPreset();
        });
        
        $('#ExtBlocks-proxy-toggle').off('click').on('click', function () {
            $('#ExtBlocks-proxy').slideToggle(200, 'swing');
        });

        $('#ExtBlocks-connection-mode').off('change').on('change', function () {
            extStates.api_preset.connection_mode = String($(this).val());
            ApiService.toggleConnectionSettings();
            saveSettingsDebounced();
        });

        $('#ExtBlocks-manual-endpoint').off('input').on('input', function () {
            extStates.api_preset.manual_endpoint = String($(this).val()).trim();
            saveSettingsDebounced();
        });

        $('#ExtBlocks-manual-api-key').off('input').on('input', function () {
            extStates.api_preset.manual_api_key = String($(this).val());
            saveSettingsDebounced();
        });

        $('#ExtBlocks-manual-key-source').off('change').on('change', function () {
            extStates.api_preset.manual_key_source = $(this).prop('checked') ? 'tavern' : 'manual';
            ApiService.toggleManualKeySettings();
            saveSettingsDebounced();
        });

        $('#ExtBlocks-manual-tavern-secret').off('change').on('change', function () {
            extStates.api_preset.manual_tavern_secret_id = String($(this).val());
            saveSettingsDebounced();
        });

        $('#ExtBlocks-manual-tavern-secrets-refresh').off('click').on('click', async function () {
            const button = $(this);
            button.addClass('fa-spin').prop('disabled', true);
            try {
                await ApiService.refreshTavernSecretsFromServer();
                $('#ExtBlocks-manual-tavern-secret').val(extStates.api_preset.manual_tavern_secret_id ?? '');
                toastr.success('Saved Tavern keys refreshed.');
            } catch (error) {
                console.error('[ExtBlocks] Could not refresh Tavern keys.', error);
                toastr.error('Could not refresh saved Tavern keys.');
            } finally {
                button.removeClass('fa-spin').prop('disabled', false);
            }
        });

        $('#ExtBlocks-manual-model').off('input').on('input', function () {
            extStates.api_preset.manual_model = String($(this).val()).trim();
            saveSettingsDebounced();
        });

        $('#ExtBlocks-manual-models-refresh').off('click').on('click', async function () {
            const button = $(this);
            button.addClass('fa-spin').prop('disabled', true);
            try {
                const models = await ApiService.refreshManualModelsFromEndpoint();
                saveSettingsDebounced();
                toastr.success(`Loaded ${models.length} model${models.length === 1 ? '' : 's'}.`);
            } catch (error) {
                console.error('[ExtBlocks] Could not load manual models.', error);
                toastr.error(error.message || 'Could not load models from the manual endpoint.');
            } finally {
                button.removeClass('fa-spin').prop('disabled', false);
            }
        });

        $('#ExtBlocks-proxy-stream').off('click').on('change', function () {
            const value = $('#ExtBlocks-proxy-stream').prop('checked');
            extStates.api_preset.stream = value;
            saveSettingsDebounced();
        });

        $('#ExtBlocks-proxy-connection-profile').off('click').on('change', function () {
            const value = $('#ExtBlocks-proxy-connection-profile').val();
            extStates.api_preset.connection_profile = value;
            saveSettingsDebounced();
        });

        $('#ExtBlocks-proxy-connection-profile-refresh').on('click', function() {
            ApiService.refreshConnectionProfiles();
            toastr.success('Connection profiles list refreshed!');
        });

        $('#ExtBlocks-proxy-temperature').off('click').on('input', function () {
            const value = $('#ExtBlocks-proxy-temperature').val();
            extStates.api_preset.temperature = parseFloat(String(value));
            saveSettingsDebounced();
        });

        $('#ExtBlocks-proxy-topp').off('click').on('input', function () {
            const value = $('#ExtBlocks-proxy-topp').val();
            extStates.api_preset.top_p = parseFloat(String(value));
            saveSettingsDebounced();
        });

        $('#ExtBlocks-proxy-maxtokens').off('click').on('input', function () {
            const value = $('#ExtBlocks-proxy-maxtokens').val();
            extStates.api_preset.max_tokens = parseInt(String(value), 10);
            saveSettingsDebounced();
        });

        $('#ExtBlocks-proxy-reasoningeffort').off('click').on('change', function () {
            const value = $('#ExtBlocks-proxy-reasoningeffort').val();
            extStates.api_preset.reasoning_effort = value;
            saveSettingsDebounced();
        });

        $('#ExtBlocks-enable-jb').off('click').on('click', () => {
            const value = $('#ExtBlocks-enable-jb').prop('checked');
            extStates.api_preset.confirmation_jb = value;
            saveSettingsDebounced();
        });

        $('#ExtBlocks-blocks-global-openeditor').off('click').on('click', () => {
            GeneratedEditor.open(false, false);
        });

        $('#ExtBlocks-blocks-scoped-openeditor').off('click').on('click', () => {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            GeneratedEditor.open(false, true);
        });

        $('#ExtBlocks-blocks-global-openaccumulationeditor').off('click').on('click', () => {
            AccumulationEditor.open(false, false);
        });

        $('#ExtBlocks-blocks-scoped-openaccumulationeditor').off('click').on('click', () => {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            AccumulationEditor.open(false, true);
        });

        $('#ExtBlocks-blocks-global-openscripteditor').off('click').on('click', () => {
            ScriptEditor.open(false, false);
        });

        $('#ExtBlocks-blocks-scoped-openscripteditor').off('click').on('click', () => {
            if (SillyTavern.getContext().characterId === undefined) {
                toastr.error('No character selected.');
                return;
            }
            ScriptEditor.open(false, true);
        });

        $('#ExtBlocks-blocks-global-import-file').on('change', async function () {
            const inputElement = /** @type {HTMLInputElement} */ (this);
            if (!inputElement.files) return;
            for (const file of inputElement.files) {
                await BlockService.importBlock(file, false);
            }
            inputElement.value = '';
            await MainUI.loadBlocks();
        });

        $('#ExtBlocks-blocks-global-import').on('click', function () {
            $('#ExtBlocks-blocks-global-import-file').trigger('click');
        });

        $('#ExtBlocks-blocks-scoped-import-file').on('change', async function () {
            const inputElement = /** @type {HTMLInputElement} */ (this);
            if (!inputElement.files) return;
            for (const file of inputElement.files) {
                await BlockService.importBlock(file, true);
            }
            inputElement.value = '';
            await MainUI.loadBlocks();
        });

        $('#ExtBlocks-blocks-scoped-import').on('click', function () {
            $('#ExtBlocks-blocks-scoped-import-file').trigger('click');
        });

        $('#chat').on('click', '.Extblocks-storage-edit', async function() {
            const messageId = $(this).closest('.mes').attr('mesid');
            const blocksStr = BlockService.getBlocksFromExtra(messageId);

            let storageEditorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.STORAGE_EDITOR));
            storageEditorHtml.find('.ExtBlocks-storage').val(blocksStr);

            const popupResult = await callPopup(storageEditorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
            if (popupResult) {
                await BlockService.purgeBlocksExtra(messageId, true);
                await BlockService.addBlocksToExtra(messageId, storageEditorHtml.find('.ExtBlocks-storage').val());
            }
        });

        $('#chat').on('click', '.custom-menu-button', function() {
            const value = $(this).find('.custom-cyoa-option-value').text();
            $('#send_textarea').val(value);
        });

        $('#chat').on('focus', '#curEditTextarea', function () {
            const message = $(this).closest('.mes');
            if (message.find('.mes_edit_buttons .Extblocks-selection-rewrite').length === 0) {
                const copyButton = message.find('.mes_edit_buttons .mes_edit_copy');
                copyButton.after(selectionRewriteButton);
            }
        });

        $('#chat').on('click', '.mes_edit_cancel', function() {
            SelectionRewriteController.deactivate();
        });

        $('#chat').on('click', '.mes_edit_done', function() {
            SelectionRewriteController.deactivate();
        });
    }
};
