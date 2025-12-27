import { download } from '../../../../../utils.js';
import { 
    templates_path, 
    ElementTemplate, 
    BlockType, 
    extName, 
    editButton,
    defaultExtPrefix
} from '../core/constants.js';
import { extStates } from '../core/state.js';
import { interactiveSortData } from '../utils/uiUtils.js';
import { SettingsService } from '../services/SettingsService.js';
import { BlockService } from '../services/BlockService.js';
import { MacroService } from '../services/MacroService.js';
import { GeneratedEditor } from './editors/GeneratedEditor.js';
import { AccumulationEditor } from './editors/AccumulationEditor.js';
import { ScriptEditor } from './editors/ScriptEditor.js';

const { 
    writeExtensionField, extensionSettings,
    renderExtensionTemplateAsync, characters, uuidv4,
    callPopup, chat
 } = SillyTavern.getContext();

export const MainUI = {
    /**
     * Adds edit buttons to all messages in the chat.
     */
    addEditButtons() {
        $('#chat .mes').each(function() {
            if ($(this).find('.extraMesButtons .Extblocks-storage-edit').length === 0) {
                $(this).find('.extraMesButtons').append(editButton);
            }
        });
    },

    /**
     * Adds an edit button to the last message in the chat.
     */
    addEditButtonToLastMessage() {
        var lastMes = $('#chat .mes').last();

        if (lastMes.find('.extraMesButtons .Extblocks-storage-edit').length === 0) {
            lastMes.find('.extraMesButtons').append(editButton);
        }
    },

    /**
     * Loads and renders the block list in the settings panel.
     */
    async loadBlocks() {
        $('#ExtBlocks-blocks-global-list').empty();
        $('#ExtBlocks-blocks-scoped-list').empty();

        await SettingsService.refreshSettings();

        const blockTemplate = $(await renderExtensionTemplateAsync(templates_path, ElementTemplate.BLOCK));

        const renderBlock = async (container, block, isScoped, index) => {
            const blockHtml = blockTemplate.clone();

            if (!block.id) {
                block.id = uuidv4();
            }

            let block_type = block.block_type ?? BlockType.GENERATED;
            let editor_func;

            if (block_type === BlockType.GENERATED) {
                blockHtml.find('.ExtBlocks-block-atype-icon').hide();
                blockHtml.find('.ExtBlocks-block-stype-icon').hide();
                blockHtml.find('.ExtBlocks-block-rtype-icon').hide();
                editor_func = GeneratedEditor.open.bind(GeneratedEditor);
                blockHtml.find('.export_prompt_ExtBlocks').on('click', async function () {
                    if (SillyTavern.getContext().characterId === undefined) {
                        toastr.warning(`${defaultExtPrefix} Please select a chat first.`);
                        return;
                    }
                    const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                    const messageId = chat.length - 1;
                    const allBlocks = BlockService.getAllEnabledBlocks();
                    const fullPrompt = await MacroService.checkAllMacros(BlockService.getSingleBlockFullPrompt(block, messageId, allBlocks));
                    const fileData = JSON.stringify({ fullPrompt }, null, 4);
                    download(fileData, fileName, 'application/json');
                });
            } else if (block_type === BlockType.ACCUMULATION) {
                blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
                blockHtml.find('.ExtBlocks-block-stype-icon').hide();
                blockHtml.find('.ExtBlocks-block-rtype-icon').hide();
                blockHtml.find('.export_prompt_ExtBlocks').hide();
                blockHtml.find('.ExtBlocks-block-preset').hide();
                editor_func = AccumulationEditor.open.bind(AccumulationEditor);
            } else if (block_type === BlockType.REWRITE) {
                blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
                blockHtml.find('.ExtBlocks-block-stype-icon').hide();
                blockHtml.find('.ExtBlocks-block-atype-icon').hide();
                editor_func = GeneratedEditor.open.bind(GeneratedEditor);
                blockHtml.find('.export_prompt_ExtBlocks').on('click', async function () {
                    if (SillyTavern.getContext().characterId === undefined) {
                        toastr.warning(`${defaultExtPrefix} Please select a chat first.`);
                        return;
                    }
                    const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()} prompt.json`;
                    const messageId = chat.length - 1;
                    const allBlocks = BlockService.getAllEnabledBlocks();
                    const fullPrompt = await MacroService.checkAllMacros(BlockService.getSingleBlockFullPrompt(block, messageId, allBlocks));
                    const fileData = JSON.stringify({ fullPrompt }, null, 4);
                    download(fileData, fileName, 'application/json');
                });
            } else if (block_type === BlockType.SCRIPT) {
                blockHtml.find('.ExtBlocks-block-gtype-icon').hide();
                blockHtml.find('.ExtBlocks-block-rtype-icon').hide();
                blockHtml.find('.ExtBlocks-block-atype-icon').hide();
                blockHtml.find('.export_prompt_ExtBlocks').hide();
                blockHtml.find('.ExtBlocks-block-preset').hide();
                editor_func = ScriptEditor.open.bind(ScriptEditor);
            }

            blockHtml.attr('id', block.id);
            blockHtml.find('.ExtBlocks_block_name').text(block.name);

            const presetButtonContainer = blockHtml.find('.ExtBlocks-block-preset');
            const presetButtonIcon = presetButtonContainer.find('i');
            const presets = ['big', 'medium', 'small'];
            const presetIcons = {
                'big': 'fa-battery-full',
                'medium': 'fa-battery-half',
                'small': 'fa-battery-empty',
            };
            const presetTitles = {
                'big': 'API Preset: Big',
                'medium': 'API Preset: Medium',
                'small': 'API Preset: Small',
            };

            if (block.api_preset === undefined) {
                block.api_preset = 'big';
            }

            let currentPreset = block.api_preset;

            const updateIcon = () => {
                presetButtonIcon.removeClass('fa-battery-full fa-battery-half fa-battery-empty');
                const iconClass = presetIcons[currentPreset];
                presetButtonIcon.addClass(iconClass);
                presetButtonContainer.attr('title', presetTitles[currentPreset]);
            };

            updateIcon();

            presetButtonContainer.on('click', async function () {
                const currentIndex = presets.indexOf(currentPreset);
                currentPreset = presets[(currentIndex + 1) % presets.length];
                block.api_preset = currentPreset;
                updateIcon();
                await BlockService.saveBlock(block, index, isScoped);
                await this.loadBlocks();
            }.bind(this));

            const $checkbox = blockHtml.find('.disable_ExtBlocks');
            $checkbox.prop('checked', block.disabled ?? false);

            const toggleBlock = async () => {
                block.disabled = !!$checkbox.prop('checked');
                if (block.disabled) {
                    BlockService.removeBlockInject(block);
                }
                await BlockService.saveBlock(block, index, isScoped);
            };

            $checkbox.on('change', async function () {
                await toggleBlock();
            });

            blockHtml.find('.ExtBlocks-toggle-on, .ExtBlocks-toggle-off').on('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                $checkbox.prop('checked', !$checkbox.prop('checked')).trigger('change');
            });

            blockHtml.find('.edit_existing_ExtBlocks').on('click', async function () {
                await editor_func(blockHtml.attr('id'), isScoped);
            });

            blockHtml.find('.export_ExtBlocks').on('click', async function () {
                const fileName = `${block.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
                const fileData = JSON.stringify(block, null, 4);
                download(fileData, fileName, 'application/json');
            });

            blockHtml.find('.delete_ExtBlocks').on('click', async function () {
                const confirm = await callPopup('Are you sure you want to delete this block?', 'confirm');

                if (!confirm) {
                    return;
                }

                await BlockService.deleteBlock(block.id, isScoped);
                await this.loadBlocks();
            }.bind(this));

            $(container).append(blockHtml);
        };

        extStates.current_set.global_blocks.forEach((block, index) => renderBlock('#ExtBlocks-blocks-global-list', block, false, index));
        characters[SillyTavern.getContext().characterId]?.data?.extensions?.ExtBlocks?.forEach((block, index) => renderBlock('#ExtBlocks-blocks-scoped-list', block, true, index));

        if (extStates.ExtBlocks_settings.extblocks_is_enabled) {
            await BlockService.updateDisplayForBlocks();
        }

        // Initialize sortable
        let sortableBlocks = [
            {
                selector: '#ExtBlocks-blocks-global-list',
                setter: x => extensionSettings.ExtBlocks.sets[extensionSettings.ExtBlocks.active_set_idx].global_blocks = x,
                getter: () => extensionSettings.ExtBlocks.sets[extensionSettings.ExtBlocks.active_set_idx].global_blocks ?? [],
            },
            {
                selector: '#ExtBlocks-blocks-scoped-list',
                setter: x => writeExtensionField(SillyTavern.getContext().characterId, extName, x),
                getter: () => characters[SillyTavern.getContext().characterId]?.data?.extensions?.ExtBlocks ?? [],
            },
        ];
        await interactiveSortData(sortableBlocks);
    }
};