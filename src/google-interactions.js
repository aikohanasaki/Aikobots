import { Readable } from 'node:stream';
import { Response } from 'node-fetch';

/** Older Gemini families cannot use the Interactions API. Unknown models try it first. */
export function requiresLegacyGoogleApi(model) {
    return /^(gemini-(?:1\.|2\.0)|gemma-(?:1|2|3)(?:\b|-)|learnlm|palm)/i.test(model);
}

/** Convert the existing Gemini prompt without changing its source messages. */
export function toGoogleInteraction(body, model, stream, originalMessages = []) {
    let callNumber = 0;
    const lastCalls = new Map();
    const originalCalls = originalMessages.flatMap(message => Array.isArray(message.tool_calls) ? message.tool_calls.map(call => call.id) : []);
    const resultIds = originalMessages.filter(message => typeof message.tool_call_id === 'string').map(message => message.tool_call_id);
    const input = body.contents.flatMap(message => {
        const content = message.parts.map(part => {
            if (typeof part.text === 'string') return { type: 'text', text: part.text };
            if (part.inlineData) return { type: part.inlineData.mimeType?.split('/')[0] || 'image', data: part.inlineData.data, mime_type: part.inlineData.mimeType };
            if (part.functionCall || part.functionResponse) return null;
            throw new Error('Unsupported Google prompt part.');
        }).filter(Boolean);
        const steps = content.length ? [{ type: message.role === 'model' ? 'model_output' : 'user_input', content }] : [];
        for (const part of message.parts) {
            if (part.functionCall) {
                const id = originalCalls[callNumber++] || `call_${callNumber}`;
                lastCalls.set(part.functionCall.name, id);
                steps.push({ type: 'function_call', id, name: part.functionCall.name, arguments: part.functionCall.args, ...(part.thoughtSignature && part.thoughtSignature !== 'skip_thought_signature_validator' ? { signature: part.thoughtSignature } : {}) });
            }
            if (part.functionResponse) {
                const callId = resultIds.shift() || lastCalls.get(part.functionResponse.name);
                if (!callId) throw new Error('Google tool result has no matching call.');
                steps.push({ type: 'function_result', call_id: callId, name: part.functionResponse.name, result: [{ type: 'text', text: String(part.functionResponse.response?.content ?? '') }] });
            }
        }
        return steps;
    });
    const config = body.generationConfig;
    const generation_config = {
        max_output_tokens: config.maxOutputTokens,
        seed: config.seed,
        stop_sequences: config.stopSequences,
    };
    if (config.temperature !== undefined && config.temperature !== 1 || config.topP !== undefined && config.topP !== 1 || config.topK !== undefined) throw new Error('Custom Google sampling settings require the legacy API.');
    if (config.thinkingConfig?.includeThoughts) generation_config.thinking_summaries = 'auto';
    if (config.thinkingConfig?.thinkingBudget !== undefined && config.thinkingConfig.thinkingBudget !== -1) throw new Error('Thinking token budgets require the legacy Google API.');
    const interaction = {
        model, input, stream, store: false, generation_config,
        safety_settings: body.safetySettings
            .filter(item => ['HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_DANGEROUS_CONTENT', 'HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_SEXUALLY_EXPLICIT'].includes(item.category))
            .map(item => ({ type: item.category.replace('HARM_CATEGORY_', '').toLowerCase(), threshold: item.threshold.toLowerCase() })),
    };
    if (body.systemInstruction?.parts?.length) interaction.system_instruction = body.systemInstruction.parts.map(part => part.text).join('\n\n');
    if (body.service_tier) interaction.service_tier = body.service_tier;
    if (config.responseMimeType || config.responseSchema) interaction.response_format = { type: 'text', mime_type: config.responseMimeType || 'application/json', ...(config.responseSchema ? { schema: config.responseSchema } : {}) };
    if (config.responseModalities?.some(value => value.toLowerCase() === 'image')) interaction.response_format = [{ type: 'text' }, { type: 'image' }];
    if (body.tools?.length) interaction.tools = body.tools.flatMap(tool => {
        if (tool.google_search) return [{ type: 'google_search' }];
        return (tool.function_declarations || []).map(declaration => ({ type: 'function', name: declaration.name, description: declaration.description, parameters: declaration.parameters }));
    });
    return interaction;
}

/** Keep only generated output; interaction resources may contain echoed user input. */
export function fromGoogleInteraction(interaction) {
    const parts = [];
    for (const step of interaction?.steps || []) {
        if (step.type === 'model_output' || step.type === 'thought') {
            for (const content of step.type === 'thought' ? step.summary || [] : step.content || []) {
                if (content.type === 'text' && typeof content.text === 'string') parts.push({ text: content.text, ...(step.type === 'thought' ? { thought: true } : {}), ...(step.signature ? { thoughtSignature: step.signature } : {}) });
                if (content.type === 'image' && typeof content.data === 'string' && typeof content.mime_type === 'string') parts.push({ inlineData: { data: content.data, mimeType: content.mime_type } });
            }
        } else if (step.type === 'function_call' && typeof step.name === 'string') {
            parts.push({ functionCall: { name: step.name, args: step.arguments || {} }, ...(step.signature ? { thoughtSignature: step.signature } : {}) });
        }
    }
    const responseContent = { role: 'model', parts };
    const content = parts.filter(part => typeof part.text === 'string' && !part.thought).map(part => part.text).join('\n\n');
    return {
        candidates: [{ content: responseContent }], responseContent,
        choices: [{ message: { content } }],
        ...(interaction?.usage ? { usage: { prompt_tokens: interaction.usage.total_input_tokens, completion_tokens: interaction.usage.total_output_tokens, total_tokens: interaction.usage.total_tokens } } : {}),
    };
}

/** Translate Interactions SSE events to the existing Google SSE contract. */
export function streamGoogleInteraction(fetchResponse) {
    const output = async function* () {
        let pending = '';
        const stepTypes = new Map();
        const functionCalls = new Map();
        const signatures = new Map();
        const images = new Map();
        const decoder = new TextDecoder();
        let completed = false;
        for await (const chunk of fetchResponse.body) {
            pending += decoder.decode(chunk, { stream: true });
            let boundary;
            while ((boundary = /\r?\n\r?\n/.exec(pending)) !== null) {
                const frame = pending.slice(0, boundary.index).replaceAll('\r', '');
                pending = pending.slice(boundary.index + boundary[0].length);
                const line = frame.split('\n').find(value => value.startsWith('data:'));
                if (!line) continue;
                let event;
                try { event = JSON.parse(line.slice(5).trim()); } catch { continue; }
                if (event.event_type === 'step.start') {
                    stepTypes.set(event.index, event.step?.type);
                    if (event.step?.type === 'function_call') functionCalls.set(event.index, { name: event.step.name, arguments: '' });
                }
                if (event.event_type === 'step.delta' && functionCalls.has(event.index) && event.delta?.type === 'arguments_delta') functionCalls.get(event.index).arguments += event.delta.arguments || '';
                if (event.event_type === 'step.delta' && event.delta?.type === 'thought_signature') signatures.set(event.index, event.delta.signature);
                if (event.event_type === 'step.delta' && (stepTypes.get(event.index) === 'model_output' || stepTypes.get(event.index) === 'thought')) {
                    const delta = event.delta;
                    const text = delta?.text ?? delta?.content?.text;
                    if (typeof text === 'string' && text) yield `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text, ...(stepTypes.get(event.index) === 'thought' ? { thought: true } : {}) }] } }] })}\n\n`;
                    if (delta?.type === 'image' && typeof delta.data === 'string') {
                        const previous = images.get(event.index) || { data: '', mimeType: delta.mime_type };
                        previous.data += delta.data;
                        images.set(event.index, previous);
                    }
                }
                if (event.event_type === 'step.stop' && images.has(event.index)) {
                    const inlineData = images.get(event.index);
                    yield `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ inlineData }] } }] })}\n\n`;
                    images.delete(event.index);
                }
                if (event.event_type === 'step.stop' && signatures.has(event.index) && stepTypes.get(event.index) === 'model_output') {
                    yield `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '', thoughtSignature: signatures.get(event.index) }] } }] })}\n\n`;
                }
                if (event.event_type === 'step.stop' && functionCalls.has(event.index)) {
                    const call = functionCalls.get(event.index);
                    let args;
                    try { args = JSON.parse(call.arguments); } catch { throw new Error('Incomplete Google function call.'); }
                    const part = { functionCall: { name: call.name, args }, ...(signatures.has(event.index) ? { thoughtSignature: signatures.get(event.index) } : {}) };
                    yield `data: ${JSON.stringify({ candidates: [{ content: { parts: [part] } }] })}\n\n`;
                    functionCalls.delete(event.index);
                }
                if (event.event_type === 'interaction.completed') completed = true;
            }
        }
        if (!completed) throw new Error('Google Interactions stream ended before completion.');
        yield 'data: [DONE]\n\n';
    };
    const bytes = async function* () { for await (const event of output()) yield Buffer.from(event); };
    return new Response(Readable.from(bytes()), { status: fetchResponse.status, headers: { 'content-type': 'text/event-stream' } });
}
