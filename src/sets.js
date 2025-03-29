import { saveSettingsDebounced, this_chid } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { getFileText } from '../../../../utils.js';

import { extStates } from './common.js';
import { refreshSettings, updateOrInsert } from './utils.js';
import { populateBlockMacrosBuffer } from './macros.js';
import { loadAPI } from './api.js';
import { loadBlocks } from './blocks.js';


export function refreshSetList() {
    let sets_name = extStates.ExtBlocks_settings.sets.map(obj => obj.name);
    $('#ExtBlocks-preset-list').empty();
    sets_name.forEach(function(option) {
        $('#ExtBlocks-preset-list').append($('<option>', {
            value: option,
            text: option
        }));
    });
    $(`#ExtBlocks-preset-list option[value="${extStates.ExtBlocks_settings.active_set}"]`).attr('selected', true);
}

export async function changeSet(idx) {
    const set_name = extension_settings.ExtBlocks.sets[idx].name;
    extension_settings.ExtBlocks.active_set = set_name;
    extension_settings.ExtBlocks.active_set_idx = idx;
    refreshSettings();
    refreshSetList();
    saveSettingsDebounced();
    await loadAPI();
    await loadBlocks();
    if (this_chid !== undefined) {
        populateBlockMacrosBuffer();
    }
}

export function importSetFromObject(setObject) {
    if (!setObject.name) {
        return false;
    }

    updateOrInsert(extension_settings.ExtBlocks.sets, setObject);
    saveSettingsDebounced();
    return true
}

export async function importSet(file) {
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

        const set_idx = updateOrInsert(extension_settings.ExtBlocks.sets, extSet);
        await changeSet(set_idx);
        

        
        toastr.success(`ExtBlocks set "${extSet.name}" imported.`);
    } catch (error) {
        console.log(error);
        toastr.error('Invalid JSON file.');
        return;
    }
}