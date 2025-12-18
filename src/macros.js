import { this_chid, chat } from '../../../../../script.js';
import { oai_settings, setupChatCompletionPromptManager } from '../../../../openai.js';
import { power_user } from '../../../../power-user.js';
import { macros } from '../../../../macros/macro-system.js';
import { checkWorldInfo } from '../../../../world-info.js';

import { mainPromptMacros, worldInfoMacrosNames, extName } from './common.js';
import { getAllEnabledBlocks, getPreviousBlockContextUnconditional } from './blocks.js';
import { runBlockGenerationCallback, runRewriteBlocksCallback, runScriptsExecutionCallback } from './handlers.js'

const MacroName = {
    MAIN: `${extName}`,
    GET_BLOCK_BY_NAME: `${extName}-GetBlockByName`,
    CALL_GENERATION: `${extName}-Call`,
    CALL_REWRITE: `${extName}-CallRewrite`,
    CALL_SCRIPT: `${extName}-CallScript`
}

export function registerExtensionMacros() {
    power_user.experimental_macro_engine = true;

    macros.registry.registerMacro(MacroName.MAIN, {
        category: extName,
        description: 'Returns the content of a block by its name.',
        unnamedArgs: [
            {
                name: 'name',
                description: 'Block name.',
                type: 'string',
            }
        ],
        aliases: [
            { alias: MacroName.GET_BLOCK_BY_NAME, visible: true }
        ],
        handler: ({ unnamedArgs: [name] }) => {
            if (this_chid === undefined) return '';
            const allBlocks = getAllEnabledBlocks();
            const block = allBlocks.filter(b => b.name === name)?.[0];
            if (!block) return '';
            else return getPreviousBlockContextUnconditional(block, chat.length - 1, true);

        }
    });

    macros.registry.registerMacro(MacroName.CALL_GENERATION, {
        category: extName,
        description: 'Calls block generation by block name.',
        unnamedArgs: [
            {
                name: 'name',
                description: 'Block name or blocks names, separated by comma.',
                type: 'string',
            },
            {
                name: 'additional_prompt',
                description: 'Additional prompt for blocks.',
                optional: true,
                type: "string"
            }
        ],
        returns: '',
        handler: async ({ unnamedArgs: [name, additional_prompt] }) => {
            if (this_chid === undefined) return '';
            await runBlockGenerationCallback({ name }, additional_prompt);
            return '';
        }
    });

    macros.registry.registerMacro(MacroName.CALL_REWRITE, {
        category: extName,
        description: 'Calls message rewrite by block name.',
        unnamedArgs: [
            {
                name: 'name',
                description: 'Block name or blocks names, separated by comma.',
                type: 'string',
            },
            {
                name: 'additional_prompt',
                description: 'Additional prompt for blocks.',
                optional: true,
                type: "string"
            }
        ],
        returns: '',
        handler: async ({ unnamedArgs: [name, additional_prompt] }) => {
            if (this_chid === undefined) return '';
            await runRewriteBlocksCallback({ name }, additional_prompt);
            return '';
        }
    });

    macros.registry.registerMacro(MacroName.CALL_SCRIPT, {
        category: extName,
        description: 'Runs script execution generation by block name.',
        unnamedArgs: [
            {
                name: 'name',
                description: 'Block name or blocks names, separated by comma.',
                type: 'string',
            }
        ],
        returns: '',
        handler: async ({ unnamedArgs: [name] }) => {
            if (this_chid === undefined) return '';
            await runScriptsExecutionCallback({ name });
            return '';
        }
    });
}

export function unregisterExtensionMacros() {
    macros.registry.unregisterMacro(MacroName.MAIN);
}

export async function checkWorldInfoMacros(prompt) {
    const containsWorldInfoMacros = prompt.some(message => 
        worldInfoMacrosNames.some(wiMacros => message.content.includes(wiMacros))
    );
    
    if (containsWorldInfoMacros && this_chid !== undefined) {
        const promptChat = prompt.map(msg => msg.content).reverse();
        const maxContext = 2e5;
        const activatedWorldInfo = await checkWorldInfo(promptChat, maxContext, true, {});
        
        let worldInfoAll = [];
        let worldInfoBefore = activatedWorldInfo.worldInfoBefore;
        if (worldInfoBefore !== '') {
            worldInfoAll.push(worldInfoBefore);
        }
        
        let worldInfoAfter = activatedWorldInfo.worldInfoAfter;
        if (worldInfoAfter !== '') {
            worldInfoAll.push(worldInfoAfter);
        }
        
        let worldInfoExamples = activatedWorldInfo.EMEntries ?? [];
        if (worldInfoExamples.length !== 0) {
            worldInfoExamples = worldInfoExamples.map(item => item.content).join('\n\n');
            worldInfoAll.push(worldInfoExamples);
        } else {
            worldInfoExamples = '';
        }
        
        let worldInfoDepth = activatedWorldInfo.WIDepthEntries ?? [];
        if (worldInfoDepth.length !== 0) {
            worldInfoDepth = worldInfoDepth.map(item => item.entries.join('\n')).join('\n\n');
            worldInfoAll.push(worldInfoDepth);
        } else {
            worldInfoDepth = '';
        }
        
        worldInfoAll = worldInfoAll.join('\n\n');

        prompt = prompt.map(message => {
            let content = message.content;
            content = content.replace(/{{wiBefore}}/gi, worldInfoBefore);
            content = content.replace(/{{wiAfter}}/gi, worldInfoAfter);
            content = content.replace(/{{wiExamples}}/gi, worldInfoExamples);
            content = content.replace(/{{wiDepth}}/gi, worldInfoDepth);
            content = content.replace(/{{wiAll}}/gi, worldInfoAll);
            
            return {
                ...message,
                content
            };
        });
    }

    return prompt;
}

export function checkMainPromptMacros(prompt) {
    const containsMainPromptMacros = prompt.some(message => 
        message.content.includes(mainPromptMacros)
    );
    
    if (containsMainPromptMacros) {
        const promptCollection = setupChatCompletionPromptManager(oai_settings).getPromptCollection();
        let mainPrompt = promptCollection.collection.find(p => p.identifier === 'main');
        if (mainPrompt) {
            mainPrompt = mainPrompt.content;
        } else {
            mainPrompt = '';
        }

        prompt = prompt.map(message => {
            if (message.content.includes(mainPromptMacros)) {
                return {
                    ...message,
                    content: message.content.replace(/{{mainPrompt}}/gi, mainPrompt)
                };
            }
            return message;
        });
    }

    return prompt;
}

export async function checkAllMacros(prompt) {
    prompt = await checkWorldInfoMacros(prompt);
    prompt = checkMainPromptMacros(prompt);
    return prompt;
}

