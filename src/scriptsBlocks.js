import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';

import { ScriptType, defaultExtPrefix } from './common.js';


const context = SillyTavern.getContext();

async function executeST(text) {
    const parser = new SlashCommandParser();
    const closure = parser.parse(text);
    await closure.execute();
}


function executeJS(text) {
    try {
        eval(text);
    } catch (error) {
        toastr.error(`${defaultExtPrefix} An error occurred in script: ${error.message}`);
    }
}

export async function handleScriptExecution(triggeredScriptBlocks) {
    for (let idx = 0; idx < triggeredScriptBlocks.length; idx++) {
        const block = triggeredScriptBlocks[idx];
        const blockScript = block.script;
        const blockScriptType = block.script_type;
        if (blockScriptType === ScriptType.ST) {
            await executeST(blockScript);
        } else if (blockScriptType === ScriptType.JS) {
            executeJS (blockScript);
        }
    };
}