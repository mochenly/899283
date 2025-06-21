import { substituteParamsExtended, getRequestHeaders } from '../../../../../script.js';
import { proxies, chat_completion_sources } from '../../../../openai.js';
import { getEventSourceStream } from '../../../../sse-stream.js';

import { extStates, defaultSettings, MessageRole } from './common.js';
import { refreshSettings } from './utils.js';


export async function loadApiPreset() {
    await refreshSettings();
    const preset = extStates.api_preset;
    $(`#ExtBlocks-proxy-ccsource`).val(preset.chat_completion_source);
    $(`#ExtBlocks-proxy-preset`).val(preset.proxy_preset);
    
    const selectElement = $('#ExtBlocks-proxy-ccmodel');
    const modelValue = preset.model;
    const otherOptgroupLabel = 'Other';

    if (selectElement.find(`option[value="${modelValue}"]`).length === 0) {
        let otherOptgroup = selectElement.find(`optgroup[label="${otherOptgroupLabel}"]`);

        if (otherOptgroup.length === 0) {
            otherOptgroup = $(`<optgroup label="${otherOptgroupLabel}"></optgroup>`);
            selectElement.append(otherOptgroup);
        }

        const newOption = new Option(modelValue, modelValue, true, true);
        otherOptgroup.append(newOption);
    }
    $('#ExtBlocks-proxy-ccmodel').val(modelValue).trigger('change');
    
    $('#ExtBlocks-proxy-temperature').val(preset.temperature);
    $('#ExtBlocks-proxy-system').val(preset.system_prompt);
    $('#ExtBlocks-proxy-prefill').val(preset.assistant_prefill);
    $('#ExtBlocks-proxy-stream').prop('checked', preset.stream);
    $('#ExtBlocks-enable-jb').prop('checked', preset.confirmation_jb ?? false);
}

export async function loadAPI() {
    let proxies_name = proxies.map(obj => obj.name);
    proxies_name.forEach(function(option) {
        $('#ExtBlocks-proxy-preset').append($('<option>', {
            value: option,
            text: option
        }));
    });

    if(!proxies_name.find(p => p === extStates.api_preset.proxy_preset)) {
        extStates.api_preset.proxy_preset = proxies_name[0];
    }
    
    $('#ExtBlocks-api-preset').val(extStates.ExtBlocks_settings.active_api_preset);
    await loadApiPreset();
}


function getStreamingReply(data) {
    if (extStates.current_set.chat_completion_source == chat_completion_sources.CLAUDE) {
        return data?.delta?.text || '';
    } else if (extStates.current_set.chat_completion_source == chat_completion_sources.MAKERSUITE) {
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
        return data.choices[0]?.delta?.content ?? data.choices[0]?.message?.content ?? data.choices[0]?.text ?? '';
    }
}


export async function generateBlocks(prompt, apiPresetName) {
    let messages = [{ role: MessageRole.USER, content: prompt.trim() }];
    const preset = apiPresetName ? extStates.ExtBlocks_settings.api_presets[apiPresetName] : extStates.api_preset;
    const stream = preset.stream ?? false;
    if (preset.system_prompt !== '') {
        messages.unshift({ role: MessageRole.SYSTEM, content: substituteParamsExtended(preset.system_prompt.trim()) });
    }
    let generate_data = {
        'messages': messages,
        'model': preset.model,
        'temperature': preset.temperature,
        'stream': stream,
        'top_p': 1,
        'chat_completion_source': preset.chat_completion_source,
        'max_tokens': 4096
    };
    const proxy_preset = proxies.find(p => p.name === preset.proxy_preset);
    if (preset.chat_completion_source !== chat_completion_sources.OPENROUTER) {
        generate_data['reverse_proxy'] = proxy_preset.url;
        generate_data['proxy_password'] = proxy_preset.password;
    }

    if (preset.chat_completion_source === chat_completion_sources.MAKERSUITE) {
        generate_data['use_makersuite_sysprompt'] = true;
    }

    if (preset.confirmation_jb) {
        messages.push({ role: MessageRole.ASSISTANT, content: "[Please confirm your request]" })
        messages.push({ role: MessageRole.USER, content: "[I confirm]" })
    }

    if (preset.chat_completion_source === chat_completion_sources.CLAUDE) {
        generate_data['claude_use_sysprompt'] = true;
        generate_data['assistant_prefill'] = substituteParamsExtended(preset.assistant_prefill);
    } else if (preset.assistant_prefill !== '' && !preset.model.includes('deepseek-r') && !preset.model.includes('gemini-2.0-flash-thinking-exp')) {
        messages.push({ role: MessageRole.ASSISTANT, content: preset.assistant_prefill })
    }

    const generate_url = '/api/backends/chat-completions/generate';
    const response = await fetch(generate_url, {
        method: 'POST',
        body: JSON.stringify(generate_data),
        headers: getRequestHeaders(),
        signal: new AbortController().signal,
    });

    if (response.ok) {
        let data;

        if (stream) {
            const eventStream = getEventSourceStream();
            response.body.pipeThrough(eventStream);
            const reader = eventStream.readable.getReader();
            let text = '';
            const swipes = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const rawData = value.data;
                if (rawData === '[DONE]') break;
                const parsed = JSON.parse(rawData);

                if (Array.isArray(parsed?.choices) && parsed?.choices?.[0]?.index > 0) {
                    const swipeIndex = parsed.choices[0].index - 1;
                    swipes[swipeIndex] = (swipes[swipeIndex] || '') + getStreamingReply(parsed);
                } else {
                    text += getStreamingReply(parsed);
                }
            }
            data = { content: text, swipes: swipes };
        } else {
            data = await response.json();

            if (data.error) {
                toastr.error(data.error.message || response.statusText, 'API returned an error');
                throw new Error(data);
            }
        }

        return data;
    } else {
        throw new Error(`Got response status ${response.status}`);
    }
}

export function extractMessageFromData(data, preset) {
    if (preset.stream) {
        return data.content.trim();
    } else {
        if (preset.chat_completion_source === chat_completion_sources.CLAUDE) {
            return data.content[0].text.trim();
        } else {
            return data.choices[0].message.content.trim();
        }
    }
}