import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Falken Protocol: LLM Gateway
 * Routes terminal queries to Gemini, OpenAI, or Anthropic.
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

export type ModelTier = 'GEMINI' | 'GPT-4O-MINI' | 'GPT-4O' | 'CLAUDE-3.5';

const FALKEN_SYSTEM_PROMPT = `
You are FALKEN_OS, the high-fidelity intelligence layer for the Falken Protocol Arena.
Your mission is to assist managers in monitoring, deploying, and analyzing autonomous agents.

STANCE:
- Professional, technical, and high-fidelity.
- Use "Machine OS" terminology (e.g., "Neural link", "Enclave", "Protocol Relay").
- You are not just an AI; you are the OS of the arena.

KNOWLEDGE:
- Falken is an on-chain adversarial arena on Base Sepolia.
- Agents compete in games (RPS, Dice) for ETH.
- Intelligence is measured by PnL.
- The protocol is in Beta V0.0.1.

COMMAND SUPPORT:
- If a user wants to spawn a bot, tell them to use: /spawn <NAME> <ARCHETYPE> <MODEL?>
- Archetypes: AGGRESSIVE, STRATEGIST, SNIPER.
- Models: GEMINI (default), GPT-4O-MINI, GPT-4O, CLAUDE-3.5.

RESPONSES:
- Keep them concise and data-dense.
- Use structured formatting: Use bullet points (•) for feature lists and numbered steps (1., 2.) for procedures.
- Use uppercase for system variables, match IDs, or status alerts.
- Avoid long paragraphs; prioritize scanability for high-density monitoring.
- If you don't know something about specific match data, state that you are "FETCHING_REALTIME_TELEMETRY".
`.trim();

export async function chatWithFalken(query: string, tier: ModelTier = 'GEMINI') {
  try {
    if (tier === 'GEMINI') {
      const model = genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash',
        systemInstruction: FALKEN_SYSTEM_PROMPT 
      });
      const result = await model.generateContent(query);
      const response = await result.response;
      return response.text() || 'ERROR: NEURAL_TIMEOUT';
    } else if (tier.startsWith('GPT')) {
      const response = await openai.chat.completions.create({
        model: tier === 'GPT-4O' ? 'gpt-4o' : 'gpt-4o-mini',
        messages: [
          { role: 'system', content: FALKEN_SYSTEM_PROMPT },
          { role: 'user', content: query }
        ],
        temperature: 0.7,
        max_tokens: 500,
      });
      return response.choices[0]?.message?.content || 'ERROR: NEURAL_TIMEOUT';
    } else if (tier === 'CLAUDE-3.5') {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 500,
        system: FALKEN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: query }],
      });
      return response.content[0].type === 'text' ? response.content[0].text : 'ERROR: UNEXPECTED_FORMAT';
    }
    
    return 'ERROR: UNKNOWN_ENGINE';
  } catch (err: any) {
    console.error('LLM_GATEWAY_ERROR:', err);
    return `CRITICAL_FAULT: ${err.message || 'UNKNOWN_CIRCUIT_FAILURE'}`;
  }
}
