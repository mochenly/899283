import { oai_settings, proxies, chat_completion_sources } from '../../../../../openai.js';
import { getEventSourceStream } from '../../../../../sse-stream.js';
import { SECRET_KEYS, readSecretState, secret_state } from '../../../../../secrets.js';

import { extStates } from '../core/state.js';
import { MessageRole, defaultExtPrefix } from '../core/constants.js';
import { SettingsService } from './SettingsService.js';

const { getRequestHeaders, extensionSettings } = SillyTavern.getContext();

export const ApiService = {
    /**
     * Loads the API preset into the UI.
     */
    async loadApiPreset() {
        await SettingsService.refreshSettings();
        const preset = extStates.api_preset;
        const connection_profile = extStates.connection_profile;
        $(`#ExtBlocks-proxy-connection-profile`).val(connection_profile.name);
        $('#ExtBlocks-connection-mode').val(preset.connection_mode ?? 'profile');
        $('#ExtBlocks-manual-endpoint').val(preset.manual_endpoint ?? '');
        $('#ExtBlocks-manual-api-key').val(preset.manual_api_key ?? '');
        $('#ExtBlocks-manual-key-source').prop('checked', preset.manual_key_source === 'tavern');
        this.refreshTavernSecrets();
        $('#ExtBlocks-manual-tavern-secret').val(preset.manual_tavern_secret_id ?? '');
        $('#ExtBlocks-manual-model').val(preset.manual_model ?? '');
        this.refreshManualModels();
        this.toggleConnectionSettings();
        this.toggleManualKeySettings();
        $('#ExtBlocks-proxy-temperature').val(preset.temperature);
        $('#ExtBlocks-proxy-topp').val(preset.top_p);
        $('#ExtBlocks-proxy-maxtokens').val(preset.max_tokens);
        $('#ExtBlocks-proxy-reasoningeffort').val(preset.reasoning_effort);
        $('#ExtBlocks-proxy-stream').prop('checked', preset.stream);
        $('#ExtBlocks-enable-jb').prop('checked', preset.confirmation_jb ?? false);
    },

    /**
     * Refreshes the connection profiles list in the UI.
     */
    refreshConnectionProfiles() {
        const connection_profile_names = extensionSettings.connectionManager.profiles.map(obj => obj.name);
        const select = $('#ExtBlocks-proxy-connection-profile');
        select.empty();
        connection_profile_names.forEach(function(option) {
            select.append($('<option>', {
                value: option,
                text: option
            }));
        });
        select.val(extStates.api_preset.connection_profile);
    },

    /** Shows settings for the selected connection type. */
    toggleConnectionSettings() {
        const isManual = extStates.api_preset.connection_mode === 'manual';
        $('#ExtBlocks-profile-connection-settings').toggle(!isManual);
        $('#ExtBlocks-manual-connection-settings').toggle(isManual);
    },

    /** Updates the model suggestions without overwriting a manually entered value. */
    refreshManualModels() {
        const models = extStates.api_preset.manual_models ?? [];
        const select = $('#ExtBlocks-manual-model-select');
        const selectedModel = extStates.api_preset.manual_model ?? '';
        select.empty().append($('<option>', { value: '', text: 'Refresh models to select one' }));
        models.forEach(model => select.append($('<option>', { value: model, text: model })));
        if (selectedModel && !models.includes(selectedModel)) {
            select.append($('<option>', { value: selectedModel, text: selectedModel }));
        }
        select.val(selectedModel);
    },

    /** Populates saved Custom API keys without exposing their values. */
    refreshTavernSecrets() {
        const select = $('#ExtBlocks-manual-tavern-secret');
        select.empty().append($('<option>', { value: '', text: 'Enter a key manually' }));
        const secrets = secret_state[SECRET_KEYS.CUSTOM] ?? [];
        secrets.forEach(secret => {
            select.append($('<option>', {
                value: secret.id,
                text: secret.label || 'Unnamed Tavern key',
            }));
        });
    },

    /** Shows the input appropriate for the selected manual key source. */
    toggleManualKeySettings() {
        const useTavernKey = extStates.api_preset.manual_key_source === 'tavern';
        $('#ExtBlocks-manual-key-input-settings').toggle(!useTavernKey);
        $('#ExtBlocks-manual-tavern-key-settings').toggle(useTavernKey);
    },

    /** Gets the latest secret metadata from Tavern, then redraws the key picker. */
    async refreshTavernSecretsFromServer() {
        await readSecretState();
        this.refreshTavernSecrets();
    },

    /** True when the manual preset should use a key stored in Tavern's secret manager. */
    usesTavernSecret(preset) {
        return preset.manual_key_source === 'tavern' && Boolean(preset.manual_tavern_secret_id);
    },

    /** Builds an OpenAI-compatible URL from a base endpoint or a full chat-completions URL. */
    getManualUrl(endpoint, path) {
        let base = String(endpoint ?? '').trim().replace(/\/+$/, '');
        base = base.replace(/\/(?:chat\/completions|models)$/i, '');
        if (!base) throw new Error('Manual endpoint is required.');
        return `${base}/${path}`;
    },

    /** Loads available models from a manual OpenAI-compatible endpoint. */
    async refreshManualModelsFromEndpoint() {
        const preset = extStates.api_preset;
        if (preset.manual_key_source === 'tavern' && !preset.manual_tavern_secret_id) {
            throw new Error('Select a saved Tavern key first.');
        }
        if (this.usesTavernSecret(preset)) {
            const response = await fetch('/api/backends/chat-completions/status', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({
                    chat_completion_source: chat_completion_sources.CUSTOM,
                    custom_url: this.getManualUrl(preset.manual_endpoint, ''),
                    custom_include_headers: oai_settings.custom_include_headers,
                    secret_id: preset.manual_tavern_secret_id,
                }),
            });
            if (!response.ok) throw new Error(`Could not load models (HTTP ${response.status}).`);
            const data = await response.json();
            return this.setManualModels(data);
        }

        const endpoint = this.getManualUrl(preset.manual_endpoint, 'models');
        const headers = {};
        if (preset.manual_api_key) headers.Authorization = `Bearer ${preset.manual_api_key}`;

        const response = await fetch(endpoint, { headers });
        if (!response.ok) throw new Error(`Could not load models (HTTP ${response.status}).`);
        const data = await response.json();
        return this.setManualModels(data);
    },

    /** Stores a normalized list of models returned by either connection type. */
    setManualModels(rawModels) {
        const preset = extStates.api_preset;
        let modelEntries = rawModels;
        for (let i = 0; i < 3 && !Array.isArray(modelEntries) && modelEntries && typeof modelEntries === 'object'; i++) {
            const nestedModels = modelEntries.data ?? modelEntries.models;
            if (!nestedModels || nestedModels === modelEntries) break;
            modelEntries = nestedModels;
        }
        if (!Array.isArray(modelEntries) && modelEntries && typeof modelEntries === 'object') {
            modelEntries = Object.values(modelEntries);
        }
        if (!Array.isArray(modelEntries)) {
            throw new Error('The endpoint returned an invalid models response.');
        }

        const models = modelEntries
            .map(model => typeof model === 'string' ? model : (model.id ?? model.name))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
        if (!models.length) throw new Error('The endpoint returned no models.');

        preset.manual_models = [...new Set(models)];
        this.refreshManualModels();
        return preset.manual_models;
    },

    /**
     * Initializes the API settings.
     */
    async loadAPI() {
        this.refreshConnectionProfiles();
        const connection_profile_names = extensionSettings.connectionManager.profiles.map(obj => obj.name);

        if (!connection_profile_names.find(p => p === extStates.api_preset.connection_profile)) {
            extStates.api_preset.connection_profile = connection_profile_names[0];
        }
        
        $('#ExtBlocks-api-preset').val(extStates.ExtBlocks_settings.active_api_preset);
        await this.loadApiPreset();
    },

    /**
     * Gets an API preset by name.
     */
    getApiPreset(presetName) {
        if (!presetName) return extStates.api_preset;
        const preset = extStates.ExtBlocks_settings.api_presets[presetName];
        if (preset) return preset;
        else return extStates.api_preset;
    },

    /**
     * Gets a connection profile for a given preset.
     */
    getConnectionProfile(apiPreset) {
        if (!apiPreset) return extStates.connection_profile;
        const connection_profile = extensionSettings.connectionManager.profiles.find(p => p.name === apiPreset.connection_profile);
        if (connection_profile) return connection_profile;
        else return extensionSettings.connectionManager.profiles[0];
    },

    /**
     * Maps API names to chat completion sources.
     */
    getChatCompletionSource(apiName) {
        if (apiName === 'google') return chat_completion_sources.MAKERSUITE;
        else return apiName;
    },

    /** Sends a request to a manual OpenAI-compatible endpoint. */
    async generateManualBlocks(messages, preset, stream) {
        if (!preset.manual_model?.trim()) throw new Error('Manual model is required.');
        if (preset.manual_key_source === 'tavern' && !preset.manual_tavern_secret_id) {
            throw new Error('Select a saved Tavern key first.');
        }
        if (this.usesTavernSecret(preset)) {
            return await this.generateWithTavernSecret(messages, preset, stream);
        }
        const headers = { 'Content-Type': 'application/json' };
        if (preset.manual_api_key) headers.Authorization = `Bearer ${preset.manual_api_key}`;
        if (stream) headers.Accept = 'text/event-stream';

        extStates.abortController = new AbortController();
        let response;
        try {
            response = await fetch(this.getManualUrl(preset.manual_endpoint, 'chat/completions'), {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    messages,
                    model: preset.manual_model.trim(),
                    temperature: preset.temperature,
                    top_p: preset.top_p,
                    max_tokens: preset.max_tokens,
                    reasoning_effort: preset.reasoning_effort,
                    stream,
                }),
                signal: extStates.abortController.signal,
            });
        } finally {
            extStates.abortController = null;
        }

        if (!response.ok) {
            const details = await response.text().catch(() => '');
            throw new Error(`Manual API returned HTTP ${response.status}${details ? `: ${details}` : ''}`);
        }

        if (!stream) return await response.json();

        const eventStream = getEventSourceStream();
        response.body.pipeThrough(eventStream);
        const reader = eventStream.readable.getReader();
        let text = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done || value.data === '[DONE]') break;
            const parsed = JSON.parse(value.data);
            text += this.getStreamingReply(parsed, chat_completion_sources.OPENAI);
        }
        return { content: text, swipes: [] };
    },

    /** Sends a manual request through Tavern, keeping the selected saved key on the server. */
    async generateWithTavernSecret(messages, preset, stream) {
        extStates.abortController = new AbortController();
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                messages,
                model: preset.manual_model.trim(),
                temperature: preset.temperature,
                top_p: preset.top_p,
                max_tokens: preset.max_tokens,
                reasoning_effort: preset.reasoning_effort,
                stream,
                chat_completion_source: chat_completion_sources.CUSTOM,
                custom_url: this.getManualUrl(preset.manual_endpoint, ''),
                custom_include_headers: oai_settings.custom_include_headers,
                custom_include_body: oai_settings.custom_include_body,
                custom_exclude_body: oai_settings.custom_exclude_body,
                secret_id: preset.manual_tavern_secret_id,
            }),
            signal: extStates.abortController.signal,
        });
        extStates.abortController = null;

        if (!response.ok) {
            const details = await response.text().catch(() => '');
            throw new Error(`Tavern API returned HTTP ${response.status}${details ? `: ${details}` : ''}`);
        }
        if (!stream) return await response.json();

        const eventStream = getEventSourceStream();
        response.body.pipeThrough(eventStream);
        const reader = eventStream.readable.getReader();
        let text = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done || value.data === '[DONE]') break;
            text += this.getStreamingReply(JSON.parse(value.data), chat_completion_sources.OPENAI);
        }
        return { content: text, swipes: [] };
    },

    /**
     * Extracts the reply from a streaming response.
     */
    getStreamingReply(data, cc_source) {
        if (cc_source === chat_completion_sources.CLAUDE) {
            return data?.delta?.text || '';
        } else if (cc_source === chat_completion_sources.MAKERSUITE) {
            return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            return data.choices[0]?.delta?.content ?? data.choices[0]?.message?.content ?? data.choices[0]?.text ?? '';
        }
    },

    /**
     * Generates blocks using the specified messages and preset.
     */
    async generateBlocks(messages, apiPresetName) {
        const preset = this.getApiPreset(apiPresetName);
        const stream = preset.stream ?? false;

        if (preset.confirmation_jb) {
            messages.push({ role: MessageRole.ASSISTANT, content: "[Please confirm your request]" });
            messages.push({ role: MessageRole.USER, content: "[I confirm]" });
        }

        if (preset.connection_mode === 'manual') {
            return await this.generateManualBlocks(messages, preset, stream);
        }

        const connection_profile = this.getConnectionProfile(preset);
        const cc_source = this.getChatCompletionSource(connection_profile.api);
        let generate_data = {
            'messages': messages,
            'model': connection_profile.model,
            'temperature': preset.temperature,
            'stream': stream,
            'chat_completion_source': cc_source,
            'max_tokens': preset.max_tokens,
            'reasoning_effort': preset.reasoning_effort
        };
        const top_p = preset.top_p;
        if (preset.top_p !== 1.0) {
            generate_data['top_p'] = top_p;
        }

        const proxy_preset = proxies.find(p => p.name === connection_profile.proxy);
        if (proxy_preset && cc_source !== chat_completion_sources.OPENROUTER) {
            generate_data['reverse_proxy'] = proxy_preset.url;
            generate_data['proxy_password'] = proxy_preset.password;
        }

        if (cc_source === chat_completion_sources.MAKERSUITE || cc_source === chat_completion_sources.CLAUDE) {
            generate_data['use_sysprompt'] = true;
        }

        extStates.abortController = new AbortController();
        const generate_url = '/api/backends/chat-completions/generate';
        const response = await fetch(generate_url, {
            method: 'POST',
            body: JSON.stringify(generate_data),
            headers: getRequestHeaders(),
            signal: extStates.abortController.signal,
        });
        extStates.abortController = null;

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
                        swipes[swipeIndex] = (swipes[swipeIndex] || '') + this.getStreamingReply(parsed, cc_source);
                    } else {
                        text += this.getStreamingReply(parsed, cc_source);
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
    },

    /**
     * Extracts the message content from the API response.
     */
    extractMessageFromData(data, preset) {
        if (preset.connection_mode === 'manual') {
            return preset.stream ? data.content.trim() : data.choices[0].message.content.trim();
        }
        const connection_profile = this.getConnectionProfile(preset);
        const cc_source = this.getChatCompletionSource(connection_profile.api);
        if (preset.stream) {
            return data.content.trim();
        } else {
            if (cc_source === chat_completion_sources.CLAUDE) {
                return data.content[0].text.trim();
            } else {
                return data.choices[0].message.content.trim();
            }
        }
    },

    /**
     * Aborts the current generation.
     */
    abortGeneration() {
        if (extStates.abortController) {
            extStates.abortController.abort();
            extStates.abortController = null;
            toastr.info(`${defaultExtPrefix} Generation aborted.`);
        }
    }
};
