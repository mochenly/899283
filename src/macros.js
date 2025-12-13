import { this_chid, chat } from '../../../../../script.js';
import { oai_settings, setupChatCompletionPromptManager } from '../../../../openai.js';
import { MacrosParser } from '../../../../macros.js';
import { checkWorldInfo } from '../../../../world-info.js';

import { mainPromptMacros, worldInfoMacrosNames, defaultExtMacrosPrefix } from './common.js';
import { getAllEnabledBlocks, getPreviousBlockContextUnconditional } from './blocks.js';


export function insertBlockMacros(block) {
    const getBlockContext = () => getPreviousBlockContextUnconditional(block, chat.length - 1, true);
    const blockKey = `${defaultExtMacrosPrefix}${block.name}`;
    MacrosParser.registerMacro(blockKey, getBlockContext);
}

export function deleteBlockMacros(block_name) {
    const blockKey = `${defaultExtMacrosPrefix}${block_name}`;
    MacrosParser.unregisterMacro(blockKey);
}

export function purgeAllBlocksMacros() {
    const dummyEnv = {};
    MacrosParser.populateEnv(dummyEnv);
    const macrosKeys = Object.keys(dummyEnv);
    const extBlocksKeys = macrosKeys.filter(key => key.includes(defaultExtMacrosPrefix));
    extBlocksKeys.forEach(key => {
        deleteBlockMacros(key.split(':')[1]);
    });
}

export function populateBlockMacrosBuffer() {
    purgeAllBlocksMacros();
    const allBlocks = getAllEnabledBlocks();
    allBlocks.forEach((block) => {
        if (block.block_type !== 'rewrite') {
            insertBlockMacros(block);
        }
    });
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

