import Anthropic from '@anthropic-ai/sdk';

// Model per feature comes from the env var. The provider is picked from the model
// id — `claude-*` goes to Anthropic, anything else (gpt-*, o3, …) to OpenAI — so
// switching provider is just setting a different model name.
const DEFAULT_MODEL = 'claude-sonnet-5-5';
export const MODELS = {
  smartImport: process.env.MODEL_SMART_IMPORT || DEFAULT_MODEL,
  monthlyReport: process.env.MODEL_MONTHLY_REPORT || DEFAULT_MODEL,
};

const providerOf = (model) => (model.startsWith('claude') ? 'anthropic' : 'openai');

let anthropic;

// One text completion on either provider. `stable` is the part of the prompt that
// repeats across calls (cached explicitly on Anthropic; OpenAI caches prefixes on its
// own), `variable` the part that changes. Usage comes back in Anthropic's shape —
// input_tokens excludes cache reads — because that's what the frontend logs.
export async function complete({ model, system, stable, variable, maxTokens, jsonSchema, effort }) {
  if (providerOf(model) === 'anthropic') {
    anthropic ??= new Anthropic();
    const content = variable
      ? [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }, { type: 'text', text: variable }]
      : stable;
    const outputConfig = {
      ...(effort && { effort }),
      ...(jsonSchema && { format: { type: 'json_schema', schema: jsonSchema } }),
    };
    const message = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
      ...(Object.keys(outputConfig).length && { output_config: outputConfig }),
    });
    const text = message.content.find((b) => b.type === 'text')?.text ?? '';
    return { text, stopReason: message.stop_reason, usage: message.usage };
  }

  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      instructions: system,
      input: variable ? `${stable}\n\n${variable}` : stable,
      max_output_tokens: maxTokens,
      ...(jsonSchema && { text: { format: { type: 'json_schema', name: 'result', schema: jsonSchema, strict: true } } }),
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${data.error?.message ?? r.statusText}`);
  const text = (data.output ?? [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
  const cached = data.usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    text,
    stopReason: data.status === 'incomplete' ? data.incomplete_details?.reason : data.status,
    usage: {
      input_tokens: (data.usage?.input_tokens ?? 0) - cached,
      output_tokens: data.usage?.output_tokens ?? 0,
      cache_read_input_tokens: cached,
    },
  };
}
