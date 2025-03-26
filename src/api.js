import { substituteParamsExtended, getRequestHeaders } from '../../../../../script.js';
import { proxies, chat_completion_sources } from '../../../../openai.js';
import { getEventSourceStream } from '../../../../sse-stream.js';

import { extStates, defaultSettings, MessageRole } from './common.js';
import { refreshSettings } from './utils.js';


export async function loadAPI() {
    await refreshSettings();

    $(`#ExtBlocks-proxy-ccsource option[value="${extStates.current_set.chat_completion_source}"]`).attr('selected', true);
    $(`#ExtBlocks-proxy-preset option[value="${extStates.ExtBlocks_settings.proxy_preset}"]`).attr('selected', true);
    
    const selectElement = $('#ExtBlocks-proxy-ccmodel');
    const modelValue = extStates.current_set.model;
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
    $(`#ExtBlocks-proxy-ccmodel option[value="${modelValue}"]`).attr('selected', true);
    
    $('#ExtBlocks-proxy-temperature').val(extStates.current_set.temperature);
    $('#ExtBlocks-proxy-system').val(extStates.current_set.system_prompt);
    $('#ExtBlocks-proxy-prefill').val(extStates.current_set.assistant_prefill);
    if (extStates.ExtBlocks_settings.stream === undefined) {
        extStates.ExtBlocks_settings.stream = defaultSettings.stream;
    }
    $('#ExtBlocks-proxy-stream').prop('checked', extStates.ExtBlocks_settings.stream);
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


export async function generateBlocks(prompt) {
    let messages = [{ role: MessageRole.USER, content: prompt.trim() }];
    const stream = extStates.ExtBlocks_settings.stream ?? false;
    if (extStates.current_set.system_prompt !== '') {
        messages.unshift({ role: MessageRole.SYSTEM, content: substituteParamsExtended(extStates.current_set.system_prompt.trim()) });
    }
    let generate_data = {
        'messages': messages,
        'model': extStates.current_set.model,
        'temperature': extStates.current_set.temperature,
        'stream': stream,
        'top_p': 1,
        'chat_completion_source': extStates.current_set.chat_completion_source,
        'max_tokens': 2048
    };
    const preset = proxies.find(p => p.name === extStates.ExtBlocks_settings.proxy_preset);
    if (extStates.current_set.chat_completion_source !== chat_completion_sources.OPENROUTER) {
        generate_data['reverse_proxy'] = preset.url;
        generate_data['proxy_password'] = preset.password;
    }

    if (extStates.current_set.chat_completion_source === chat_completion_sources.MAKERSUITE) {
        generate_data['use_makersuite_sysprompt'] = true;
    }

    if (extStates.current_set.chat_completion_source === chat_completion_sources.CLAUDE) {
        generate_data['claude_use_sysprompt'] = true;
        generate_data['assistant_prefill'] = substituteParamsExtended(extStates.current_set.assistant_prefill);
    } else if (extStates.current_set.assistant_prefill !== '' && !extStates.current_set.model.includes('deepseek-r') && !extStates.current_set.model.includes('gemini-2.0-flash-thinking-exp')) {
        messages.push({ role: MessageRole.ASSISTANT, content: extStates.current_set.assistant_prefill })
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

export function extractMessageFromData(data) {
    if (extStates.ExtBlocks_settings.stream) {
        return data.content.trim();
    } else {
        if (extStates.current_set.chat_completion_source === chat_completion_sources.CLAUDE) {
            return data.content[0].text.trim();
        } else {
            return data.choices[0].message.content.trim();
        }
    }
}