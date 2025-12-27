import { checkWorldInfo } from '../../../../../world-info.js';
import { mainPromptMacros, worldInfoMacrosNames, extName, MacroName, ExtTopic } from '../core/constants.js';
import { BlockService } from './BlockService.js';
import { ContextService } from './ContextService.js';
import { CommandService } from './CommandService.js';

const { 
    chat, 
    chatCompletionSettings, 
    setupChatCompletionPromptManager, 
    powerUserSettings, 
    macros,
    eventSource
} = SillyTavern.getContext();

const { runBlockGenerationCallback, runRewriteBlocksCallback, runScriptsExecutionCallback } = CommandService;

export const MacroService = {
    /**
     * Registers all extension macros.
     */
    registerExtensionMacros() {
        powerUserSettings.experimental_macro_engine = true;

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
                if (SillyTavern.getContext().characterId === undefined) return '';
                const allBlocks = BlockService.getAllEnabledBlocks();
                const block = allBlocks.find(b => b.name === name);
                if (!block) return '';
                else return ContextService.getPreviousBlockContextUnconditional(block, chat.length - 1, true);
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
                if (SillyTavern.getContext().characterId === undefined) return '';
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
                if (SillyTavern.getContext().characterId === undefined) return '';
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
                if (SillyTavern.getContext().characterId === undefined) return '';
                await runScriptsExecutionCallback({ name });
                return '';
            }
        });
    },

    /**
     * Unregisters extension macros.
     */
    unregisterExtensionMacros() {
        macros.registry.unregisterMacro(MacroName.GET_BLOCK_BY_NAME);
        macros.registry.unregisterMacro(MacroName.MAIN);
        macros.registry.unregisterMacro(MacroName.CALL_GENERATION);
        macros.registry.unregisterMacro(MacroName.CALL_REWRITE);
        macros.registry.unregisterMacro(MacroName.CALL_SCRIPT);
    },

    /**
     * Processes World Info macros in the prompt.
     */
    async checkWorldInfoMacros(prompt) {
        const containsWorldInfoMacros = prompt.some(message => 
            worldInfoMacrosNames.some(wiMacros => message.content.includes(wiMacros))
        );
        
        if (containsWorldInfoMacros && SillyTavern.getContext().characterId !== undefined) {
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
    },

    /**
     * Processes Main Prompt macros in the prompt.
     */
    checkMainPromptMacros(prompt) {
        const containsMainPromptMacros = prompt.some(message => 
            message.content.includes(mainPromptMacros)
        );
        
        if (containsMainPromptMacros) {
            const promptCollection = setupChatCompletionPromptManager(chatCompletionSettings).getPromptCollection();
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
    },

    /**
     * Processes all macros in the prompt.
     */
    async checkAllMacros(prompt) {
        prompt = await this.checkWorldInfoMacros(prompt);
        prompt = this.checkMainPromptMacros(prompt);
        const data = { template: prompt };
        await eventSource.emit(ExtTopic.PROMPT_TEMPLATE_ENGINE, data);
        prompt = data.template;
        return prompt;
    }
};