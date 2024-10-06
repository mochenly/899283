import { SlashCommandParser } from '../../../../slash-commands/SlashCommandParser.js';

import { ScriptType } from './common.js';


const context = SillyTavern.getContext();

async function executeST(text) {
    const parser = new SlashCommandParser();
    const closure = parser.parse(text);
    await closure.execute();
}


function executeJS(text) {
    eval(text);
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