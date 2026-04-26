import { generateObject, generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'
import type { AIConfig, Instrument } from '../types'

const DEFAULT_MODELS: Record<string, string> = {
  openai:    'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  ollama:    'llama3',
  lmstudio:  'local-model',
}

export const OPENAI_MODELS = [
  // GPT-4.1 family
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  // GPT-4o family
  'gpt-4o',
  'gpt-4o-mini',
  // o-series reasoning
  'o4-mini',
  'o3',
  'o3-mini',
  'o3-pro',
  'o1',
  'o1-mini',
  'o1-pro',
]
export const ANTHROPIC_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-7']

function buildProvider(cfg: AIConfig) {
  const model = cfg.model || DEFAULT_MODELS[cfg.provider]

  switch (cfg.provider) {
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey })(model)

    case 'anthropic':
      return createAnthropic({ apiKey: cfg.apiKey })(model)

    case 'ollama':
      return createOpenAI({
        baseURL: (cfg.baseUrl || 'http://localhost:11434') + '/v1',
        apiKey: 'ollama',
      })(model)

    case 'lmstudio':
      return createOpenAI({
        baseURL: (cfg.baseUrl || 'http://localhost:1234') + '/v1',
        apiKey: 'lm-studio',
      })(model)
  }
}

export async function testAIConnection(cfg: AIConfig): Promise<void> {
  const provider = buildProvider(cfg)
  await generateText({ model: provider, prompt: 'Reply with the single word: ok' })
}

export interface TabGenerationInput {
  sectionName: string
  instruments: Instrument[]
  chords: string
  bars: number
  timeSignature: string
  styleNote: string
}

export const tabPartsSchema = z.object({
  parts: z.array(z.object({
    instrument: z.enum(['guitar', 'bass', 'drums']),
    name: z.string(),
    content: z.string(),
  })),
})

export type GeneratedParts = z.infer<typeof tabPartsSchema>

export async function generateTabStructure(
  cfg: AIConfig,
  input: TabGenerationInput,
): Promise<GeneratedParts> {
  const provider = buildProvider(cfg)

  const instList = input.instruments.join(', ')
  const styleClause = input.styleNote ? `\nStyle/feel: ${input.styleNote}` : ''

  const prompt = `Generate blank ASCII tablature structure for the following song section.
Do NOT fill in any notes or fret numbers — use only dashes for empty beats.
Use | to mark bar lines. Each bar should have exactly 4 beats in ${input.timeSignature} time (adjust beat count accordingly).
Put the section name as a comment on the first line using // notation.

Section: ${input.sectionName}
Instruments: ${instList}
Chord progression: ${input.chords}
Number of bars: ${input.bars}
Time signature: ${input.timeSignature}${styleClause}

Rules per instrument:
- guitar: 6 strings labeled e B G D A E (high to low), one line each, bar lines with |
- bass: 4 strings labeled G D A E, one line each, bar lines with |
- drums: rows labeled BD SN HH (add OH CY if useful), bar lines with |, use - for empty beats

Name each part as "<SectionName> <Instrument>" (e.g. "Verse Guitar").
Return exactly ${input.instruments.length} part(s), one per requested instrument.`

  const result = await generateObject({
    model: provider,
    schema: tabPartsSchema,
    prompt,
  })

  return result.object
}
