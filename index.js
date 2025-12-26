import { templates_path, ElementTemplate } from './src/core/constants.js';

import { SettingsService } from './src/services/SettingsService.js';
import { MacroService } from './src/services/MacroService.js';
import { ApiService } from './src/services/ApiService.js';

import { MainUI } from './src/ui/MainUI.js';
import { SettingsUI } from './src/ui/SettingsUI.js';
import { EventController } from './src/ui/EventController.js';
import { SlashCommandController } from './src/ui/SlashCommandController.js';
import { SelectionRewriteController } from './src/ui/SelectionRewriteController.js';

import { PluginRegistry } from './src/core/PluginRegistry.js';
import { ScriptPlugin } from './src/plugins/ScriptPlugin.js';
import { AccumulationPlugin } from './src/plugins/AccumulationPlugin.js';
import { RewritePlugin } from './src/plugins/RewritePlugin.js';
import { GeneratedPlugin } from './src/plugins/GeneratedPlugin.js';

const { renderExtensionTemplateAsync, extensionSettings } = SillyTavern.getContext();

function initPlugins() {
    PluginRegistry.register(ScriptPlugin);
    PluginRegistry.register(AccumulationPlugin);
    PluginRegistry.register(RewritePlugin);
    PluginRegistry.register(GeneratedPlugin);
}

async function loadSettings() {
    await SettingsService.loadSettings();

    $('#extblocks_is_enabled').prop('checked', extensionSettings.ExtBlocks.extblocks_is_enabled);

    SettingsUI.refreshSetList();
    
    await ApiService.loadAPI();
    await MainUI.loadBlocks();
}

jQuery(async () => {
    initPlugins();
    $('#extensions_settings').append(await renderExtensionTemplateAsync(templates_path, ElementTemplate.SETTINGS));
    await loadSettings();
    await SettingsUI.setupListeners();
    EventController.init();
    SlashCommandController.init();
    await SelectionRewriteController.init();

    if (extensionSettings.ExtBlocks.extblocks_is_enabled) {
        MacroService.registerExtensionMacros();
    }

    console.log(`[ExtBlocks] extension loaded`);
});
