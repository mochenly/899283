import { chat } from '../../../../../script.js';

import { addBlocksToExtra, getPreviousBlockContextUnconditional } from './blocks.js';
import { getMultiBlockContentFromMessage } from './utils.js';


export function applyOperationsToAccumulationBlock(mainBlock, operationsStr) {
    const operations = operationsStr.trim().split('\n');

    operations.forEach(operation => {
        operation = operation.trim();

        if (operation.includes(':')) {
            const [key, value] = operation.split(':').map(s => s.trim());

            if (value.startsWith('- ') || value.startsWith('+ ')) {
                const itemValue = value.slice(2).trim();
                if (mainBlock[key] !== undefined) {
                    if (mainBlock[key][itemValue] !== undefined) {
                        if (value.startsWith('-')) {
                            mainBlock[key][itemValue]--;
                            if (mainBlock[key][itemValue] <= 0) {
                                delete mainBlock[key][itemValue];
                            }
                        } else if (value.startsWith('+')) {
                            mainBlock[key][itemValue]++;
                        }
                    } else if (value.startsWith('+')) {
                        mainBlock[key][itemValue] = 1;
                    }
                } else if (value.startsWith('+')) {
                    mainBlock[key] = { [itemValue]: 1 };
                }
            } else if (value.startsWith('-') || value.startsWith('+')) {
                const numValue = parseInt(value, 10);
                if (!isNaN(numValue)) {
                    if (mainBlock[key] !== undefined) {
                        mainBlock[key] += numValue;
                    } else {
                        mainBlock[key] = numValue;
                    }
                }
            } else {
                if (!isNaN(value)) {
                    mainBlock[key] = parseInt(value, 10);
                } else {
                    mainBlock[key] = value;
                }
            }
        }
    });

    return mainBlock;
}

export function parseAccumulationBlock(blockStr) {
    const lines = blockStr.trim().split('\n');
    const result = {};
    let currentObject = result;
    const stack = [];

    const blockWrapper = getAccumulationBlockWrapper(blockStr);

    lines.forEach(line => {
        line = line.trim();
		
		if (blockWrapper.upperWrapper.includes(line) || blockWrapper.bottomWrapper.includes(line)) {
            return;
        }

        if (line.endsWith('[')) {
            const key = line.replace(': [', '').trim();
            const newObject = {};
            currentObject[key] = newObject;
            stack.push(currentObject);
            currentObject = newObject;
        } else if (line === ']') {
            currentObject = stack.pop();
        } else {
            const [key, value] = line.split(':').map(s => s.trim());
            if (value === undefined) {
                currentObject[key] = 1;
            } else if (!isNaN(value)) {
                currentObject[key] = parseInt(value, 10);
            } else {
                currentObject[key] = value;
            }
        }
    });

    return result;
}


export function getAccumulationBlockWrapper(blockStr) {
    const lines = blockStr.trim().split('\n');
    const upperWrapper = [];
    const bottomWrapper = [];

    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx].trim();
        if (line.includes(':') || line.includes(']')) break;
        upperWrapper.push(line);
    }

    for (let idx = lines.length - 1; idx >= 0; idx--) {
        const line = lines[idx].trim();
        if (line.includes(':') || line.includes(']')) break;
        bottomWrapper.push(line);
    }

    return {
        upperWrapper: upperWrapper.join('\n'),
        bottomWrapper: bottomWrapper.join('\n')
    }
}

export function accumulationBlockToString(jsonObj, indentLevel = 0) {
    const indent = '  '.repeat(indentLevel);
    let result = '';

    for (const key in jsonObj) {
        if (typeof jsonObj[key] === 'object' && !Array.isArray(jsonObj[key])) {
            result += `${indent}${key}: [\n`;
            result += accumulationBlockToString(jsonObj[key], indentLevel + 1);
            result += `${indent}]\n`;
        } else if (Array.isArray(jsonObj[key])) {
            result += `${indent}${key}: [${jsonObj[key].join(', ')}]\n`;
        } else if (jsonObj[key] === 1) {
            result += `${indent}${key}\n`;
        } else {
            result += `${indent}${key}: ${jsonObj[key]}\n`;
        }
    }

    return result;
}

export function stringifyAccumulationBlock(blockJson, oldBlockStr, block_name) {
    let blockWrapper;
    if (oldBlockStr !== '') {
        blockWrapper = getAccumulationBlockWrapper(oldBlockStr);
    } else {
        blockWrapper = {
            upperWrapper: `<${block_name}>`,
            bottomWrapper: `</${block_name}>`
        }
    }
    const newBlockStr = accumulationBlockToString(blockJson);
    return `${blockWrapper.upperWrapper}\n${newBlockStr.trim()}\n${blockWrapper.bottomWrapper}`;
}

export async function handleBlocksAccumulation(messageId, triggeredAccumulationBlocks) {
    const blocks = []
    for (let idx = 0; idx < triggeredAccumulationBlocks.length; idx++) {
        const block = triggeredAccumulationBlocks[idx];
        const blockStr = getPreviousBlockContextUnconditional(block, chat.length - 1);
        const blockJson = parseAccumulationBlock(blockStr);
        const blockUpdater = getMultiBlockContentFromMessage(chat[messageId].mes, block.updater_name);
        const updatedBlock = applyOperationsToAccumulationBlock(blockJson, blockUpdater);
        const updatedBlockStr = stringifyAccumulationBlock(updatedBlock, blockStr, block.name);
        blocks.push(updatedBlockStr);
    };

    await addBlocksToExtra(messageId, blocks.join('\n'));
}
