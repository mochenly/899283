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
 * Generates a RegExp for enclosing/extracting block content.
 * @param {string} block_name 
 * @returns {RegExp}
 */
export function getBlockEncloseRegex(block_name) {
    const block_names = checkAttributesInBlockName(block_name);
    const block_regex = new RegExp(`(?:[\\s\\S]*?(?=<${block_names.upper_block_name}(\\s+[^>]+)?>)|$)|(?<=<\\/${block_names.bottom_block_name}>|^)[\\s\\S]*`, "g");
    return block_regex;
}

/**
 * Extracts block content from a message using a provided regex.
 * @param {string} message 
 * @param {RegExp} block_regex 
 * @returns {string}
 */
export function getBlockFromMessageWithRegex(message, block_regex) {
    let block = message.replace(block_regex, '');
    block = block.replace(/^<+/, '<');
    return block;
}

/**
 * Extracts block content from a message by block name.
 * @param {string} message 
 * @param {string} block_name 
 * @returns {string}
 */
export function getBlockFromMessage(message, block_name) {
    const block_regex = getBlockEncloseRegex(block_name);
    return getBlockFromMessageWithRegex(message, block_regex);
}

/**
 * Extracts content from multiple blocks of the same name in a message.
 * @param {string} message 
 * @param {string} block_name 
 * @returns {string}
 */
export function getMultiBlockContentFromMessage(message, block_name) {
    const block_names = checkAttributesInBlockName(block_name);
    const block_regex = new RegExp(`<${block_names.upper_block_name}(\\s+[^>]+)?>\\n*|<\\/${block_names.bottom_block_name}>|(?:(?<=^)|(?<=<\\/${block_names.bottom_block_name}>))([\\s\\S]*?)(?=<${block_names.upper_block_name}(\\s+[^>]+)?>|$)`, "g");
    return getBlockFromMessageWithRegex(message, block_regex).trim();
}