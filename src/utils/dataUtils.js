/**
 * Updates an existing item in a JSON array if it has the same name, or inserts it if not found.
 * @param {Object[]} jsonArray 
 * @param {Object} newJson 
 * @returns {number} The index of the updated or inserted item.
 */
export function updateOrInsert(jsonArray, newJson) {
    let index = -1;

    for (let i = 0; i < jsonArray.length; i++) {
        if (jsonArray[i].name === newJson.name) {
            jsonArray[i] = newJson;
            index = i;
            return index;
        }
    }

    if (index === -1) {
        jsonArray.push(newJson);
        index = jsonArray.length - 1;
    }

    return index;
}

/**
 * Groups blocks by their context.
 * @param {Object[]} blocks 
 * @returns {Object} An object where keys are context strings and values are arrays of blocks.
 */
export function groupBlocksByContext(blocks) {
    const contextToString = (context) => context.map(item => item.name).join('_');

    const groupedBlocks = {};

    blocks.forEach(block => {
        const contextStr = contextToString(block.context);
        if (!groupedBlocks[contextStr]) {
            groupedBlocks[contextStr] = [];
        }
        groupedBlocks[contextStr].push(block);
    });

    return groupedBlocks;
}

/**
 * Combines global and scoped blocks, with scoped blocks taking priority.
 * @param {Object[]} globalBlocks 
 * @param {Object[]} scopedBlocks 
 * @returns {Object[]}
 */
export function priorityCombineBlocks(globalBlocks, scopedBlocks) {
    const combined = {};
    scopedBlocks.forEach(obj => {
        combined[obj.name] = obj;
    });

    globalBlocks.forEach(obj => {
        if (!combined[obj.name]) {
            combined[obj.name] = obj;
        }
    });
    return Object.values(combined);
}

/**
 * Applies MongoDB-style update operators to a document.
 * Supported operators: $set, $inc, $push, $pull, $unset.
 * @param {Object} doc The document to update.
 * @param {Object} update The update object containing operators.
 * @returns {Object} The updated document.
 */
export function applyMongoUpdate(doc, update) {
    if (!update || typeof update !== 'object') return doc;

    const operators = {
        $set: (d, k, v) => { setDeepValue(d, k, v); },
        $unset: (d, k) => { unsetDeepValue(d, k); },
        $inc: (d, k, v) => {
            const current = getDeepValue(d, k) || 0;
            setDeepValue(d, k, current + v);
        },
        $push: (d, k, v) => {
            const current = getDeepValue(d, k) || [];
            if (Array.isArray(current)) {
                current.push(v);
                setDeepValue(d, k, current);
            }
        },
        $pull: (d, k, v) => {
            const current = getDeepValue(d, k) || [];
            if (Array.isArray(current)) {
                const index = current.indexOf(v);
                if (index !== -1) {
                    current.splice(index, 1);
                    setDeepValue(d, k, current);
                }
            }
        }
    };

    for (const op in update) {
        if (operators[op]) {
            for (const key in update[op]) {
                operators[op](doc, key, update[op][key]);
            }
        } else if (!op.startsWith('$')) {
            // Default to $set behavior for top-level keys if no operator is provided
            doc[op] = update[op];
        }
    }

    return doc;
}

function setDeepValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== 'object') {
            current[keys[i]] = {};
        }
        current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;
}

function getDeepValue(obj, path) {
    return path.split('.').reduce((prev, curr) => prev && prev[curr], obj);
}

function unsetDeepValue(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]]) return;
        current = current[keys[i]];
    }
    delete current[keys[keys.length - 1]];
}