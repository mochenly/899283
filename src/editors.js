import { callPopup, this_chid, characters } from '../../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../../extensions.js';
import { download, getFileText, uuidv4 } from '../../../../utils.js';

import { ElementTemplate, ContextType, templates_path, BlockType } from './common.js';
import { interactiveSortData } from './utils.js';
import { saveBlock } from './blocks.js';


export async function openEditor(existingId, isScoped) {
    const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.GENERATED_EDITOR));
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];
    let contextItems = [];
    let editingContextItemIndex = -1;
    let isResettingType = false;

    async function loadContextItems(editorHtml) {
        editorHtml.find('#ExtBlocks-editor-context-list').empty();
    
        const contextItemTemplate = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.CONTEXT_ITEM));
    
        function renderContextItem(container, context_item, index) {
            const contextItemHtml = contextItemTemplate.clone();
    
            if (!context_item.id) {
                context_item.id = uuidv4();
            }
    
            contextItemHtml.attr('id', context_item.id);
            contextItemHtml.find('.ExtBlocks_editor_context_item_name').text(context_item.name);
            contextItemHtml.find('.edit_context_item').on('click', async function () {
                editingContextItemIndex = index;
                loadContextItemForEditing(context_item);
            });
            contextItemHtml.find('.delete_context_item').on('click', async function () {
                const existingContextItemIndex = contextItems.findIndex((item) => item.id === context_item.id);
                if (!existingContextItemIndex || existingContextItemIndex !== -1) {
                    contextItems.splice(existingContextItemIndex, 1);
                    await loadContextItems(editorHtml);
                }
            });
    
            editorHtml.find(container).append(contextItemHtml);
        }
    
        contextItems.forEach((context_item, index, array) => renderContextItem('#ExtBlocks-editor-context-list', context_item, index));
    }

    function loadContextItemForEditing(context_item) {
        editorHtml.find('.ExtBlocks-editor-context-builder-name').val(context_item.name);

        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).off('change', handleContextItemTypeChange);
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val(context_item.type).trigger('change');
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).on('change', handleContextItemTypeChange);

        if (context_item.type === ContextType.TEXT) {
            editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val(context_item.text);
        } else if (context_item.type === ContextType.LAST_MESSAGES) {
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val(context_item.messages_count);
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val(context_item.messages_offset ?? 0);
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val(context_item.messages_separator);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val(context_item.user_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val(context_item.user_suffix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val(context_item.char_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val(context_item.char_suffix);
        } else if (context_item.type === ContextType.LAST_MESSAGES_KEYWORD) {
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val(context_item.keyword_stopper);
            editorHtml.find('select[name="ExtBlocks-editor-context-builder-keywordmessages-separator"]').val(context_item.messages_separator);
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-userprefix').val(context_item.user_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-usersuffix').val(context_item.user_suffix);
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charprefix').val(context_item.char_prefix);
            editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charsuffix').val(context_item.char_suffix);
        } else if (context_item.type === ContextType.PREVIOUS_BLOCK) {
            editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val(context_item.block_name);
            editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val(context_item.block_count ?? 1);
        }

        editorHtml.find('#ExtBlocks-editor-context-item-new').hide();
        editorHtml.find('#ExtBlocks-editor-context-item-save').show();
        editorHtml.find('#ExtBlocks-editor-context-item-exit').show();
    }

    function exitEditMode(context_type='text') {
        editingContextItemIndex = -1;
        editorHtml.find('.ExtBlocks-editor-context-builder-name').val('');

        editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val('');
        editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val('');
        editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val('');
        editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val('double_newline');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val('');
        editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val('');
        editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val('1');

        isResettingType = true;
        editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val(context_type).trigger('change');
        isResettingType = false;

        editorHtml.find('#ExtBlocks-editor-context-item-new').show();
        editorHtml.find('#ExtBlocks-editor-context-item-save').hide();
        editorHtml.find('#ExtBlocks-editor-context-item-exit').hide();
    }

    function handleContextItemTypeChange() {
        if (isResettingType) return;

        const value = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
        if (value === 'text') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').show()
        } else if (value === 'last_messages') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').show()
        } else if (value === 'previous_block') {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').show()
        } else if (value === 'last_messages_keyword') {
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').show()
        }
        exitEditMode(value);
    }

    editorHtml.find('#ExtBlocks-editor-context-item-save').off('click').on('click', () => {
        if (editingContextItemIndex !== -1) {
            let context_item;
            const id = contextItems[editingContextItemIndex].id;
            const name = String(editorHtml.find('.ExtBlocks-editor-context-builder-name').val());
            const context_type = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
            if (context_type === ContextType.TEXT) {
                context_item = {
                    id: id,
                    name: name,
                    type: context_type,
                    text: String(editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val())
                };
            } else if (context_type === ContextType.LAST_MESSAGES) {
                context_item = {
                    id: id,
                    name: name,
                    type: context_type,
                    messages_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val())) || 10,
                    messages_offset: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val())) || 0,
                    messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val()),
                    user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n'),
                    user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n'),
                    char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n'),
                    char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n')
                };
            } else if (context_type === ContextType.LAST_MESSAGES_KEYWORD) {
                context_item = {
                    id: id,
                    name: name,
                    type: context_type,
                    keyword_stopper: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val()) || '',
                    messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-keywordmessages-separator"]').val()),
                    user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-userprefix').val()).replace(/\\n/g, '\n'),
                    user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-usersuffix').val()).replace(/\\n/g, '\n'),
                    char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charprefix').val()).replace(/\\n/g, '\n'),
                    char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charsuffix').val()).replace(/\\n/g, '\n')
                };
            } else if (context_type === ContextType.PREVIOUS_BLOCK) {
                context_item = {
                    id: id,
                    name: name,
                    type: context_type,
                    block_name: String(editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val()),
                    block_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val())) || 1
                };
            }

            if (!context_item.name) {
                toastr.error('Could not save context item: The context item name was undefined or empty!');
                return;
            }

            contextItems[editingContextItemIndex] = context_item;
            loadContextItems(editorHtml);
            exitEditMode();
        }
    });

    editorHtml.find('#ExtBlocks-editor-context-item-exit').off('click').on('click', () => {
        exitEditMode();
    });

    editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).off('change').on('change', handleContextItemTypeChange);

    editorHtml.find('#ExtBlocks-editor-context-importFile').on('change', async function () {
        const inputElement = this instanceof HTMLInputElement && this;
        for (const file of inputElement.files) {
            if (!file) {
                toastr.error('No file provided.');
                return;
            }
        
            try {
                const fileText = await getFileText(file);
                contextItems = JSON.parse(fileText).items;
                await loadContextItems(editorHtml)
            } catch (error) {
                console.log(error);
                toastr.error('Invalid JSON file.');
                return;
            }
        }
        inputElement.value = '';
    });
    editorHtml.find('#ExtBlocks-editor-context-import').on('click', function () {
        editorHtml.find('#ExtBlocks-editor-context-importFile').trigger('click');
    });
    editorHtml.find('#ExtBlocks-editor-context-export').on('click', async function () {
        const fileName = `context.json`;
        const fileData = JSON.stringify({items: contextItems}, null, 4);
        download(fileData, fileName, 'application/json');
    });

    function changeTriggerPeriodicity(trigger_periodicity) {
        if (trigger_periodicity === "keyword") {
            editorHtml.find('.Extblocks-editor-period-wrapper').hide();
            editorHtml.find('.Extblocks-editor-keyword-wrapper').show();
        } else {
            editorHtml.find('.Extblocks-editor-period-wrapper').show();
            editorHtml.find('.Extblocks-editor-keyword-wrapper').hide();
        }
    }

    function handleBlockTypeChange(blockType) {
        const hideDisplayWrapper = editorHtml.find('#ExtBlocks-editor-hide-display-wrapper');
        const injectBlockWrapper = editorHtml.find('#ExtBlocks-editor-inject-block-wrapper');
        const injectSettings = editorHtml.find('#ExtBlocks-editor-inject-settings');
        const generationOrderWrapper = editorHtml.find('#ExtBlocks-editor-generation-order-wrapper');
    
        if (blockType === BlockType.REWRITE) {
            injectSettings.hide();
            hideDisplayWrapper.hide();
            injectBlockWrapper.hide();
            generationOrderWrapper.show();
        } else {
            injectSettings.show();
            hideDisplayWrapper.show();
            injectBlockWrapper.show();
            generationOrderWrapper.hide();
        }
    }
    
    let existingBlockIndex = -1;
    let blockApiPreset = 'big';
    if (existingId) {
        existingBlockIndex = array.findIndex((block) => block.id === existingId);
        if (existingBlockIndex !== -1) {
            const existingBlock = array[existingBlockIndex];
            contextItems = existingBlock.context.slice();
            if (existingBlock.name) {
                editorHtml.find('.ExtBlocks-editor-block-name').val(existingBlock.name);
            } else {
                toastr.error('This block doesn\'t have a name! Please delete it.');
                return;
            }

            blockApiPreset = existingBlock.api_preset;
            const blockType = existingBlock.block_type ?? BlockType.GENERATED;
            editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).val(blockType);
            editorHtml.find('.ExtBlocks-editor-block-template').val(existingBlock.template ?? '');
            editorHtml.find('.ExtBlocks-editor-block-prompt').val(existingBlock.prompt ?? '');

            editorHtml.find('input[name="user_message"]').prop('checked', existingBlock.user_message ?? false);
            editorHtml.find('input[name="char_message"]').prop('checked', existingBlock.char_message ?? true);

            const block_keyword = existingBlock.keyword;
            const trigger_periodicity = (block_keyword && block_keyword !== '') ? "keyword" : "periodic";
            editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val(trigger_periodicity);
            editorHtml.find('input[name="period"]').val(existingBlock.period ?? 2);
            editorHtml.find('input[name="keyword"]').val(block_keyword ?? '');
            editorHtml.find('input[name="keyword_is_regex"]').prop('checked', existingBlock.keyword_is_regex ?? false);
            changeTriggerPeriodicity(trigger_periodicity);
            
            editorHtml.find('input[name="hide_display"]').prop('checked', existingBlock.hide_display ?? false);
            editorHtml.find('input[name="inject_block"]').prop('checked', existingBlock.inject_block ?? false);
            editorHtml.find('input[name="disabled"]').prop('checked', existingBlock.disabled ?? false);

            editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val(existingBlock.injection_role ?? 0);
            editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val(existingBlock.injection_position ?? 0);
            editorHtml.find('input[name="injection_depth"]').val(existingBlock.injection_depth ?? 2);
            editorHtml.find(`select[name="ExtBlocks-editor-generation-order"]`).val(existingBlock.generation_order ?? 'before');
            await loadContextItems(editorHtml, existingBlock);

            handleBlockTypeChange(blockType);
        }
    } else {
        editorHtml.find('input[name="disabled"]').prop('checked', false);
        editorHtml.find('input[name="char_message"]').prop('checked', true);
        editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val('periodic');
        changeTriggerPeriodicity('periodic');
    }

    editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).off('click').on('change', (event) => {
        const value = editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val();
        changeTriggerPeriodicity(value);
    });

    editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).off('click').on('change', (event) => {
        const value = editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).val();
        handleBlockTypeChange(value);
    })

    let sortableContextItems = [
        {
            selector: editorHtml.find('#ExtBlocks-editor-context-list'),
            setter: x => contextItems = x,
            getter: () => contextItems ?? [],
        },
    ];
    await interactiveSortData(sortableContextItems);

    editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).off('click').on('change', (event) => {
        const value = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
        if (value === ContextType.TEXT) {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').show()
        } else if (value === ContextType.LAST_MESSAGES) {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').show()
        } else if (value === ContextType.PREVIOUS_BLOCK) {
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').show()
        } else if (value === ContextType.LAST_MESSAGES_KEYWORD) {
            editorHtml.find('#ExtBlocks-editor-context-builder-messages').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-text').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-block').hide()
            editorHtml.find('#ExtBlocks-editor-context-builder-keywordmessages').show()
        }
    });

    editorHtml.find('.ExtBlocks-preset-context-item-add').off('click').on('click', () => {
        let context_item;
        const id = uuidv4();
        const name = String(editorHtml.find('.ExtBlocks-editor-context-builder-name').val());
        const context_type = editorHtml.find(`select[name="ExtBlocks-editor-context-item"]`).val();
        if (context_type === ContextType.TEXT) {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                text: String(editorHtml.find('.ExtBlocks-editor-context-builder-text-content').val())
            };
        } else if (context_type === ContextType.LAST_MESSAGES) {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                messages_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-count"]').val())) || 10,
                messages_offset: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-messages-offset"]').val())) || 0,
                messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-messages-separator"]').val()),
                user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-userprefix').val()).replace(/\\n/g, '\n'),
                user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-usersuffix').val()).replace(/\\n/g, '\n'),
                char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charprefix').val()).replace(/\\n/g, '\n'),
                char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-messages-charsuffix').val()).replace(/\\n/g, '\n')
            };
        } else if (context_type === ContextType.LAST_MESSAGES_KEYWORD) {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                keyword_stopper: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-keywordstopper').val()) || '',
                messages_separator: String(editorHtml.find('select[name="ExtBlocks-editor-context-builder-keywordmessages-separator"]').val()),
                user_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-userprefix').val()).replace(/\\n/g, '\n'),
                user_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-usersuffix').val()).replace(/\\n/g, '\n'),
                char_prefix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charprefix').val()).replace(/\\n/g, '\n'),
                char_suffix: String(editorHtml.find('.ExtBlocks-editor-context-builder-keywordmessages-charsuffix').val()).replace(/\\n/g, '\n')
            };
        } else if (context_type === ContextType.PREVIOUS_BLOCK) {
            context_item = {
                id: id,
                name: name,
                type: context_type,
                block_name: String(editorHtml.find('.ExtBlocks-editor-context-builder-block-name').val()),
                block_count: parseInt(String(editorHtml.find('input[name="ExtBlocks-editor-context-builder-block-count"]').val())) || 1
            };
        }

        if (!context_item.name) {
            toastr.error('Could not save context item: The context item name was undefined or empty!');
            return;
        }

        contextItems.push(context_item);
        loadContextItems(editorHtml);
    });


    const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save', wide: true});
    if (popupResult) {
        const trigger_periodicity = editorHtml.find(`select[name="ExtBlocks-editor-trigger-periodicity"]`).val();
        const block_keyword = trigger_periodicity === 'keyword' ? String(editorHtml.find('input[name="keyword"]').val() || '') : '';
        const newBlock = {
            id: existingId ? String(existingId) : uuidv4(),
            block_type: editorHtml.find(`select[name="ExtBlocks-editor-block-type"]`).val(),
            name: String(editorHtml.find('.ExtBlocks-editor-block-name').val()),
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            template: String(editorHtml.find('.ExtBlocks-editor-block-template').val()),
            prompt: String(editorHtml.find('.ExtBlocks-editor-block-prompt').val()),
            user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
            char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
            period: parseInt(String(editorHtml.find('input[name="period"]').val() || 2)),
            keyword: block_keyword,
            keyword_is_regex: editorHtml.find('input[name="keyword_is_regex"]').prop('checked'),
            hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
            inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
            injection_role: parseInt(String(editorHtml.find(`select[name="ExtBlocks-editor-injection-role"]`).val())),
            injection_position: parseInt(String(editorHtml.find(`select[name="ExtBlocks-editor-injection-position"]`).val())),
            injection_depth: parseInt(String(editorHtml.find('input[name="injection_depth"]').val() || 4)),
            generation_order: editorHtml.find(`select[name="ExtBlocks-editor-generation-order"]`).val() || 'before',
            context: contextItems,
            api_preset: blockApiPreset
        };

        saveBlock(newBlock, existingBlockIndex, isScoped);
    }
}

export async function openAccumulationEditor(existingId, isScoped) {
    const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.ACCUMULATION_EDITOR));
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];

    let existingBlockIndex = -1;
    if (existingId) {
        existingBlockIndex = array.findIndex((block) => block.id === existingId);
        if (existingBlockIndex !== -1) {
            const existingBlock = array[existingBlockIndex];
            if (existingBlock.name) {
                editorHtml.find('.ExtBlocks-accumulationeditor-block-name').val(existingBlock.name);
            } else {
                toastr.error('This block doesn\'t have a name! Please delete it.');
                return;
            }

            editorHtml.find('.ExtBlocks-accumulationeditor-blockupdater-name').val(existingBlock.updater_name);

            editorHtml.find('input[name="user_message"]').prop('checked', existingBlock.user_message ?? false);
            editorHtml.find('input[name="char_message"]').prop('checked', existingBlock.char_message ?? true);
            
            editorHtml.find('input[name="hide_display"]').prop('checked', existingBlock.hide_display ?? false);
            editorHtml.find('input[name="inject_block"]').prop('checked', existingBlock.inject_block ?? false);
            editorHtml.find('input[name="disabled"]').prop('checked', existingBlock.disabled ?? false);

            editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-role"]`).val(existingBlock.injection_role ?? 0);
            editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-position"]`).val(existingBlock.injection_position ?? 0);
            editorHtml.find('input[name="injection_depth"]').val(existingBlock.injection_depth ?? 2);
        }
    } else {
        editorHtml.find('input[name="disabled"]').prop('checked', false);
        editorHtml.find('input[name="char_message"]').prop('checked', true);
    }

    const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save'});
    if (popupResult) {
        const newBlock = {
            id: existingId ? String(existingId) : uuidv4(),
            block_type: BlockType.ACCUMULATION,
            name: String(editorHtml.find('.ExtBlocks-accumulationeditor-block-name').val()),
            updater_name: String(editorHtml.find('.ExtBlocks-accumulationeditor-blockupdater-name').val()),
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
            char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
            hide_display: editorHtml.find('input[name="hide_display"]').prop('checked'),
            inject_block: editorHtml.find('input[name="inject_block"]').prop('checked'),
            injection_role: parseInt(String(editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-role"]`).val())),
            injection_position: parseInt(String(editorHtml.find(`select[name="ExtBlocks-accumulationeditor-injection-position"]`).val())),
            injection_depth: parseInt(String(editorHtml.find('input[name="injection_depth"]').val() || 4)),
        };

        saveBlock(newBlock, existingBlockIndex, isScoped);
    }
}

export async function openScriptEditor(existingId, isScoped) {
    const editorHtml = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.SCRIPT_EDITOR));
    const array = (isScoped ? characters[this_chid]?.data?.extensions?.ExtBlocks : extension_settings.ExtBlocks.sets[extension_settings.ExtBlocks.active_set_idx].global_blocks) ?? [];
    
    function changeTriggerPeriodicity(trigger_periodicity) {
        if (trigger_periodicity === "keyword") {
            editorHtml.find('.ExtBlocks-scripteditor-period-wrapper').hide();
            editorHtml.find('.ExtBlocks-scripteditor-keyword-wrapper').show();
        } else {
            editorHtml.find('.ExtBlocks-scripteditor-period-wrapper').show();
            editorHtml.find('.ExtBlocks-scripteditor-keyword-wrapper').hide();
        }
    }

    let existingBlockIndex = -1;
    if (existingId) {
        existingBlockIndex = array.findIndex((block) => block.id === existingId);
        if (existingBlockIndex !== -1) {
            const existingBlock = array[existingBlockIndex];
            if (existingBlock.name) {
                editorHtml.find('.ExtBlocks-scripteditor-block-name').val(existingBlock.name);
            } else {
                toastr.error('This block doesn\'t have a name! Please delete it.');
                return;
            }

            editorHtml.find(`select[name="ExtBlocks-scripteditor-script-type"]`).val(existingBlock.script_type ?? 'stscript');
            editorHtml.find('.ExtBlocks-scripteditor-script').val(existingBlock.script ?? '');

            editorHtml.find('input[name="user_message"]').prop('checked', existingBlock.user_message ?? false);
            editorHtml.find('input[name="char_message"]').prop('checked', existingBlock.char_message ?? true);

            const block_keyword = existingBlock.keyword;
            const trigger_periodicity = (block_keyword && block_keyword !== '') ? "keyword" : "periodic";
            editorHtml.find(`select[name="ExtBlocks-scripteditor-trigger-periodicity"]`).val(trigger_periodicity);
            editorHtml.find('input[name="period"]').val(existingBlock.period ?? 2);
            editorHtml.find('input[name="keyword"]').val(block_keyword ?? '');
            changeTriggerPeriodicity(trigger_periodicity);

            editorHtml.find('input[name="disabled"]').prop('checked', existingBlock.disabled ?? false);
            editorHtml.find(`select[name="ExtBlocks-editor-execution-order"]`).val(existingBlock.execution_order ?? 'before');
        }
    } else {
        editorHtml.find('input[name="disabled"]').prop('checked', false);
        editorHtml.find('input[name="char_message"]').prop('checked', true);
        editorHtml.find(`select[name="ExtBlocks-scripteditor-trigger-periodicity"]`).val('periodic');
        changeTriggerPeriodicity('periodic');
    }

    editorHtml.find(`select[name="ExtBlocks-scripteditor-trigger-periodicity"]`).off('click').on('change', (event) => {
        const value = editorHtml.find(`select[name="ExtBlocks-scripteditor-trigger-periodicity"]`).val();
        changeTriggerPeriodicity(value);
    });

    const popupResult = await callPopup(editorHtml, 'confirm', undefined, { okButton: 'Save', wide: true });
    if (popupResult) {
        const trigger_periodicity = editorHtml.find(`select[name="ExtBlocks-scripteditor-trigger-periodicity"]`).val();
        const block_keyword = trigger_periodicity === 'keyword' ? String(editorHtml.find('input[name="keyword"]').val() || '') : '';
        const newBlock = {
            id: existingId ? String(existingId) : uuidv4(),
            block_type: BlockType.SCRIPT,
            name: String(editorHtml.find('.ExtBlocks-scripteditor-block-name').val()),
            script_type: editorHtml.find(`select[name="ExtBlocks-scripteditor-script-type"]`).val(),
            script: String(editorHtml.find('.ExtBlocks-scripteditor-script').val()),
            disabled: editorHtml.find('input[name="disabled"]').prop('checked'),
            user_message: editorHtml.find('input[name="user_message"]').prop('checked'),
            char_message: editorHtml.find('input[name="char_message"]').prop('checked'),
            period: parseInt(String(editorHtml.find('input[name="period"]').val() || 2)),
            keyword: block_keyword,
            execution_order: editorHtml.find(`select[name="ExtBlocks-editor-execution-order"]`).val() || 'before'
        };

        saveBlock(newBlock, existingBlockIndex, isScoped);
    }
}
