/**
 * Lists OpenRouter's free chat models that can return insights, best candidates first.
 * The free list changes every few weeks; run this when LLM_MODEL starts failing and pick new values for
 * LLM_MODEL and LLM_FALLBACK_MODELS. Uses OpenRouter's public model list: no key needed.
 *
 *   npm run llm:free-models
 */
interface OpenRouterModel {
  id: string;
  context_length?: number;
  supported_parameters?: string[];
  architecture?: { output_modalities?: string[] };
}

const res = await fetch('https://openrouter.ai/api/v1/models');
if (!res.ok) throw new Error(`OpenRouter model list failed: ${res.status}`);
const { data } = (await res.json()) as { data: OpenRouterModel[] };

const rows = data
  .filter((model) => model.id.endsWith(':free'))
  .filter((model) => model.architecture?.output_modalities?.includes('text') ?? true)
  .map((model) => {
    const params = model.supported_parameters ?? [];
    const structured = params.includes('structured_outputs');
    const json = params.includes('response_format');
    return { model: model.id, structured, json, context: model.context_length ?? 0 };
  })
  // Structured outputs first (schema-enforced JSON), then JSON mode, then prompt-only.
  .sort((a, b) => Number(b.structured) - Number(a.structured) || Number(b.json) - Number(a.json) || b.context - a.context);

console.table(rows.map(({ model, structured, json, context }) => ({
  model, 'structured outputs': structured ? 'yes' : '', 'JSON mode': json ? 'yes' : '', context,
})));
console.log('Models without structured outputs still work (the prompt carries the schema), but break the format more often.');
