/**
 * Calls the Anthropic API to convert Figma design specs + a plain-English
 * prompt into a production-ready React component.
 */

import Anthropic from '@anthropic-ai/sdk';

export async function generateReactComponent(userPrompt, designSpecs) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const system = `You are an expert React developer. Given a plain-English UI description and Figma design specifications, output a single, complete React component.

Rules:
- Functional component with hooks only.
- Use Tailwind CSS (className props). No CSS imports or <style> tags.
- Pull exact color values, font sizes, spacing, and border radii from the Figma specs where present.
- Single default export, no external component dependencies.
- Output ONLY the JSX/JS code — no explanation, no markdown fences, no prose.`;

  const userMessage =
    `UI description: ${userPrompt}\n\nFigma design specs:\n${designSpecs}\n\nGenerate the React component now.`;

  const message = await anthropic.messages.create({
    model:      'claude-opus-4-6',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const raw = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Strip markdown fences if Claude added them despite instructions
  return raw.replace(/^```[a-z]*\n?/im, '').replace(/```\s*$/m, '').trim();
}
