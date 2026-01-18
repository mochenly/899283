/**
 * Checks if a block name contains attributes (indicated by '=') and returns upper and bottom names.
 * @param {string} block_name 
 * @returns {{upper_block_name: string, bottom_block_name: string}}
 */
export function checkAttributesInBlockName(block_name) {
    if (block_name.includes('=')) {
        const indexOfFirstEqual = block_name.indexOf('=');
        const bottom_block_name = block_name.substring(0, indexOfFirstEqual).trim().split(/\s+/).slice(0, -1).join(' ');
        return {
            upper_block_name: block_name,
            bottom_block_name: bottom_block_name
        }
    } else {
        return {
            upper_block_name: block_name,
            bottom_block_name: block_name
        }
    }
}

/**
 * Generates a regex string for finding a block by name.
 * @param {string} block_name 
 * @returns {string}
 */
export function getRegexForBlock(block_name) {
    const block_names = checkAttributesInBlockName(block_name);
    return `(\\n*<${block_names.upper_block_name}(\\s+[^>]+)?>[\\s\\S]*?<\\/${block_names.bottom_block_name}>)`;
}

/**
 * Extracts block content (including tags) from a message by block name.
 * Returns the first matching block.
 * @param {string} message
 * @param {string} block_name
 * @returns {string}
 */
export function getBlockFromMessage(message, block_name) {
    if (!message) return '';
    const { upper_block_name, bottom_block_name } = checkAttributesInBlockName(block_name);
    const startTagIndicator = `<${upper_block_name}`;
    const closingTag = `</${bottom_block_name}>`;
    
    let startIndex = message.indexOf(startTagIndicator);
    
    while (startIndex !== -1) {
        const nextChar = message[startIndex + startTagIndicator.length];
        if (nextChar === '>' || nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r') {
             const tagEndIndex = message.indexOf('>', startIndex);
             if (tagEndIndex === -1) {
                 startIndex = message.indexOf(startTagIndicator, startIndex + 1);
                 continue;
             }

             const endIndex = message.indexOf(closingTag, tagEndIndex);
             if (endIndex === -1) {
                 startIndex = message.indexOf(startTagIndicator, startIndex + 1);
                 continue;
             }

             return message.substring(startIndex, endIndex + closingTag.length);
        }
        startIndex = message.indexOf(startTagIndicator, startIndex + 1);
    }
    
    return '';
}

/**
 * Extracts and concatenates inner content from multiple blocks of the same name.
 * @param {string} message
 * @param {string} block_name
 * @returns {string}
 */
export function getMultiBlockContentFromMessage(message, block_name) {
    if (!message) return '';
    const { upper_block_name, bottom_block_name } = checkAttributesInBlockName(block_name);
    const startTagIndicator = `<${upper_block_name}`;
    const closingTag = `</${bottom_block_name}>`;
    
    let contents = [];
    let searchIndex = 0;

    while (true) {
        let startIndex = message.indexOf(startTagIndicator, searchIndex);
        if (startIndex === -1) break;

        const nextChar = message[startIndex + startTagIndicator.length];
        if (nextChar === '>' || nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r') {
            const tagEndIndex = message.indexOf('>', startIndex);
            if (tagEndIndex === -1) {
                searchIndex = startIndex + 1;
                continue;
            }

            const endIndex = message.indexOf(closingTag, tagEndIndex);
            if (endIndex === -1) {
                searchIndex = startIndex + 1;
                continue;
            }

            // Extract inner content
            const innerContent = message.substring(tagEndIndex + 1, endIndex);
            contents.push(innerContent.trim());
            searchIndex = endIndex + closingTag.length;
        } else {
            searchIndex = startIndex + 1;
        }
    }

    return contents.join('\n').trim();
}