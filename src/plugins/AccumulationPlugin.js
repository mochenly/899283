import { BlockType } from '../core/constants.js';
import { ContextService } from '../services/ContextService.js';
import { BlockService } from '../services/BlockService.js';
import { getMultiBlockContentFromMessage } from '../utils/blockUtils.js';
import { applyMongoUpdate } from '../utils/dataUtils.js';
import * as yaml from '../../external/js-yaml.mjs';

const { chat } = SillyTavern.getContext();

/**
 * Parses a YAML/JSON string into a JSON object.
 */
function parseYaml(str) {
    try {
        return yaml.load(str);
    } catch (e) {
        console.error('[ExtBlocks] Failed to parse YAML:', e);
        return {};
    }
}

/**
 * Converts a JSON object to a YAML string.
 */
function stringifyYaml(obj) {
    try {
        return yaml.dump(obj);
    } catch (e) {
        console.error('[ExtBlocks] Failed to stringify YAML:', e);
        return '';
    }
}

/**
 * Extracts the wrapper (tags) from an accumulation block string.
 */
function getAccumulationBlockWrapper(blockStr) {
    const lines = blockStr.trim().split('\n');
    const upperWrapper = [];
    const bottomWrapper = [];

    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx].trim();
        if (line.includes(':') || line.startsWith('-')) break;
        upperWrapper.push(line);
    }

    for (let idx = lines.length - 1; idx >= 0; idx--) {
        const line = lines[idx].trim();
        if (line.includes(':') || line.startsWith('-')) break;
        bottomWrapper.push(line);
    }

    return {
        upperWrapper: upperWrapper.join('\n'),
        bottomWrapper: bottomWrapper.join('\n')
    }
}

/**
 * Plugin for handling Accumulation blocks.
 */
export const AccumulationPlugin = {
    type: BlockType.ACCUMULATION,

    /**
     * Executes the accumulation blocks.
     * @param {Object[]} blocks - The accumulation blocks to process.
     * @param {Object} options - Execution options.
     * @param {number} options.messageId - The ID of the message being processed.
     */
    async execute(blocks, options = {}) {
        const { messageId, externalContent } = options;
        const results = [];

        for (const block of blocks) {
            const blockStr = ContextService.getPreviousBlockContextUnconditional(block, messageId, true);
            if (!blockStr) continue;
            
            const wrapper = getAccumulationBlockWrapper(blockStr);
            let content = blockStr;
            if (wrapper.upperWrapper) content = content.replace(wrapper.upperWrapper, '');
            if (wrapper.bottomWrapper) content = content.replace(wrapper.bottomWrapper, '');
            
            const blockJson = parseYaml(content);
            const sourceText = externalContent || chat[messageId].mes;
            const blockUpdaterStr = getMultiBlockContentFromMessage(sourceText, block.updater_name);
            
            if (blockUpdaterStr) {
                const updateOps = parseYaml(blockUpdaterStr);
                const updatedBlock = applyMongoUpdate(blockJson, updateOps);
                
                const newContent = stringifyYaml(updatedBlock);
                const updatedBlockStr = `${wrapper.upperWrapper || `<${block.name}>`}\n${newContent.trim()}\n${wrapper.bottomWrapper || `</${block.name}>`}`;
                results.push(updatedBlockStr);
            }
        }

        if (results.length > 0) {
            await BlockService.addBlocksToExtra(messageId, results.join('\n'));
        }
    }
};