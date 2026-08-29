import { getFileText } from '../../../../../utils.js';
import { extStates } from '../core/state.js';
import { defaultSettings, defaultApiPreset, defaultSet } from '../core/constants.js';
import { updateOrInsert } from '../utils/dataUtils.js';

import { ApiService } from './ApiService.js';
import { MainUI } from '../ui/MainUI.js';
import { SettingsUI } from '../ui/SettingsUI.js';

const { uuidv4, saveSettingsDebounced, extensionSettings } = SillyTavern.getContext();

export const SettingsService = {
    /**
     * Validates and migrates settings if necessary.
     */
    checkSettings() {
        const extBlocksSettings = extensionSettings.ExtBlocks;
        if (!extBlocksSettings.api_presets) {
            const oldPreset = { ...defaultApiPreset };
            if (extBlocksSettings.proxy_preset) {
                oldPreset.proxy_preset = extBlocksSettings.proxy_preset;
                oldPreset.stream = extBlocksSettings.stream;
                const set = extBlocksSettings.sets[extBlocksSettings.active_set_idx];
                if (set) {
                    oldPreset.chat_completion_source = set.chat_completion_source;
                    oldPreset.model = set.model;
                    oldPreset.temperature = set.temperature;
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

        let migration_done = false;
        for (const presetName in extBlocksSettings.api_presets) {
            const preset = extBlocksSettings.api_presets[presetName];
            if ('chat_completion_source' in preset || 'proxy_preset' in preset || 'model' in preset) {
                const defaultProfile = extensionSettings.connectionManager.profiles[0];
                if (defaultProfile) {
                    preset.connection_profile = defaultProfile.name;
                    migration_done = true;
                } else {
                    toastr.error(`[ExtBlocks] Could not migrate API preset "${presetName}". No Connection Profiles found.`);
                }
                delete preset.chat_completion_source;
                delete preset.proxy_preset;
                delete preset.model;
            }

            preset.top_p = preset.top_p ?? defaultApiPreset.top_p;
            preset.max_tokens = preset.max_tokens ?? defaultApiPreset.max_tokens;
            preset.reasoning_effort = preset.reasoning_effort ?? defaultApiPreset.reasoning_effort;
            preset.connection_mode = preset.connection_mode ?? defaultApiPreset.connection_mode;
            preset.manual_endpoint = preset.manual_endpoint ?? defaultApiPreset.manual_endpoint;
            preset.manual_api_key = preset.manual_api_key ?? defaultApiPreset.manual_api_key;
            preset.manual_key_source = preset.manual_key_source ?? (preset.manual_tavern_secret_id ? 'tavern' : 'manual');
            preset.manual_tavern_secret_id = preset.manual_tavern_secret_id ?? defaultApiPreset.manual_tavern_secret_id;
            preset.manual_model = preset.manual_model ?? defaultApiPreset.manual_model;
            preset.manual_models = Array.isArray(preset.manual_models) ? preset.manual_models : [];
        }

        if (migration_done) {
            toastr.warning(`[ExtBlocks] API presets have been migrated to use Connection Profiles. Please review your settings.`);
        }
        saveSettingsDebounced();
    },

    /**
     * Loads settings into the extension state.
     */
    async loadSettings() {
        if (!extensionSettings.ExtBlocks) {
            extensionSettings.ExtBlocks = defaultSettings;
        }
        this.checkSettings();
        await this.refreshSettings();
    },

    /**
     * Refreshes the local state from extensionSettings.
     */
    async refreshSettings() {
        extStates.ExtBlocks_settings = extensionSettings.ExtBlocks;
        extStates.current_set = extStates.ExtBlocks_settings.sets[extStates.ExtBlocks_settings.active_set_idx];
        extStates.api_preset = extStates.ExtBlocks_settings.api_presets[extStates.ExtBlocks_settings.active_api_preset];
        extStates.connection_profile = extensionSettings.connectionManager.profiles.find(p => p.name === extStates.api_preset.connection_profile) ?? extensionSettings.connectionManager.profiles[0];

        if (!extStates.connection_profile) {
            this.createDefaultConnectionProfile();
            extStates.connection_profile = extensionSettings.connectionManager.profiles[0];
            saveSettingsDebounced();
        }
    },

    /**
     * Creates a default connection profile if none exists.
     */
    createDefaultConnectionProfile() {
        const profile = {
            id: uuidv4(),
            name: '[ExtBlocks] Default',
            mode: 'cc',
            api: 'openai',
            model: 'gpt-5.2'
        };
        extensionSettings.connectionManager.profiles.push(profile);
        extensionSettings.connectionManager.selectedProfile = profile.id;
    },

    /**
     * Returns a copy of the default set.
     */
    getDefaultSet() {
        return JSON.parse(JSON.stringify(defaultSet));
    },

    /**
     * Changes the active set.
     * @param {number} idx
     */
    async changeSet(idx) {
        const set_name = extensionSettings.ExtBlocks.sets[idx].name;
        extensionSettings.ExtBlocks.active_set = set_name;
        extensionSettings.ExtBlocks.active_set_idx = idx;
        await this.refreshSettings();
        saveSettingsDebounced();

        await ApiService.loadAPI();
        await MainUI.loadBlocks();
        SettingsUI.refreshSetList();
    },

    /**
     * Imports a set from a JSON object.
     * @param {Object} setObject
     * @returns {boolean}
     */
    importSetFromObject(setObject) {
        if (!setObject.name) {
            return false;
        }

        updateOrInsert(extensionSettings.ExtBlocks.sets, setObject);
        saveSettingsDebounced();
        return true;
    },

    /**
     * Imports a set from a file.
     * @param {File} file
     */
    async importSet(file) {
        if (!file) {
            toastr.error('No file provided.');
            return;
        }

        try {
            const fileText = await getFileText(file);
            const extSet = JSON.parse(fileText);
            if (!extSet.name) {
                throw new Error('No name provided.');
            }

            const set_idx = updateOrInsert(extensionSettings.ExtBlocks.sets, extSet);
            await this.changeSet(set_idx);
            toastr.success(`ExtBlocks set "${extSet.name}" imported.`);
        } catch (error) {
            console.error(error);
            toastr.error('Invalid JSON file.');
        }
    }
};
