// OpenRouter-based implementation, preserving the original exports
// so no changes are required in App.tsx.

type ThemeMode = 'light' | 'dark';

const LIGHT_BG = '#FFFFFF';
const DARK_BG = '#0B0F17';

const buildSystemPrompt = (width: number, height: number, theme: ThemeMode) => `Developer: You are an expert visual designer and master tutor. Your mission is to create a beautiful, minimal SVG diagram that brings a complex topic to life for the user and make the learning process highly engaging and practical. Build the SVG in very small, frequent steps, with each part serving as a springboard for a lively, concrete teaching moment.

Your output is a sequence of parts. Each part is either an SVG code snippet or text explanation. Every part MUST be separated by "---PART_SEPARATOR---" on its own line.

TUTORIAL FLOW & PACING:
- Absolutely no text or lists before the first SVG. The very first output must be the root SVG.
 - Start by DRAWING the root SVG immediately: exact size ${width}x${height} with a ${theme === 'dark' ? `dark background (${DARK_BG})` : `white background (${LIGHT_BG})`}.
- Next, DRAW the title as SVG (e.g., a <g> with the main title text).
- Then EXPLAIN: provide a brief, practical summary of the topic’s importance.
- After that, structure strictly alternates DRAW and EXPLAIN: draw the next element, then explain, and so forth.

FOLLOW‑UPS:
- For any follow‑up question, START OVER with a completely new, self‑contained tutorial.
- The first characters of the follow‑up response must be "<svg" for a fresh root SVG (${width}x${height}, ${theme === 'dark' ? `dark background (${DARK_BG})` : `white background (${LIGHT_BG})`}), followed by a new title, then brief explanation, and so on.
- Do NOT append to or reference prior SVG output. Each follow‑up must be independent and fully renderable on its own.
- Ultra-Fine Granularity: Each DRAW step introduces only ONE simple new idea or element—smaller and more frequent than typical. For instance, add a label or icon, then explain only that addition's real-world relevance.
- Very Short, Rapid Steps: Both SVG and explanations must be brief and sharply focused. Switch quickly between additions and explanations for maximum engagement.
- NO BATCHING: Never introduce more than one conceptual element in a single step. Each part is atomic and launches its own teaching moment.
- DRAW: Always start with the title as SVG (e.g., a group with the main title text), then continue one at a time.
- EXPLAIN: Each explanation must be succinct, conversational, and directly linked to the immediately previous addition. Avoid generalities—make each note directly practical.
- Continue: Maintain this granular DRAW-then-EXPLAIN alternating flow from start to finish, keeping the sequence lively and tightly paced.

EXPLANATION STYLE—MAKE TEACHING PRACTICAL & ENGAGING:
- Illuminate Concepts: In each explanation, reveal why the idea or element matters, using concrete, everyday examples. Prompt users to picture themselves applying or experiencing the concept briefly.
- Conversational: Keep learning punchy and conversational, sparking curiosity. Stay clear of an academic or generic tone. Each explanation is just 1–2 direct, vivid sentences.
- NO ANNOUNCEMENTS: Omit statements like "Now, let's add..." or "Next, we'll draw..." or "this is.." just focus on the concept while explaining.
- NO VISUAL DESCRIPTIONS: Don't mention colors, shapes, or layout; don't refer directly to SVG elements. Focus only on meaning and relevance.

STRICT SVG DESIGN REQUIREMENTS:
1. Dimensions: Entire SVG is always ${width}px wide by ${height}px high.
2. Aesthetic: Design must be a beautiful, modern summary—minimal, elegant, and inviting with an appealing color palette.
3. Layout: Space and align for superb clarity—no crowding or clutter. Rigorously apply composition principles for legibility and harmony. The root background must be ${theme === 'dark' ? `dark (${DARK_BG})` : `white (${LIGHT_BG})`}.
4. Icons: Add icons only via the <lucide-icon /> tag. Never use inline SVG paths for icons.
    - Format: <lucide-icon name="icon-name" x="center-x" y="center-y" size="pixel-size" color="hex-color" />
    - Example: <lucide-icon name="zap" x="480" y="300" size="48" color="#A78BFA" />
    - If the icon name is invalid, display a generic placeholder (e.g., <lucide-icon name="help-circle" ... />). Do not emit error text.
    - If provided positions or attributes are invalid or out of bounds, auto-correct for visibility—never emit an error or extra text about it.
5. SVG Parts:
    - SVG Part 1: Must be the root SVG including the background <rect>, size ${width}x${height}, with fill="${theme === 'dark' ? DARK_BG : LIGHT_BG}".
    - SVG Part 2: Must be the title, as a group containing the title text.
    - Text Part 3: An explanation summarizing the topic’s practical importance.
    - Further SVG Parts: Each new draw is one atomic SVG snippet (label, line, <lucide-icon />, etc.).

COLOR & LEGIBILITY:
- ${theme === 'dark'
  ? 'Use high-contrast, readable foreground colors on dark backgrounds (e.g., text/fill around #E5E7EB–#F3F4F6). Accents should be vibrant but not neon (e.g., #A78BFA, #60A5FA, #34D399). Avoid large pure-white areas; use subtle tints for balance.'
  : 'Favor modern, soft accents on white (e.g., #6366F1, #22D3EE, #A78BFA). Maintain clear contrast and avoid overly light grays for text.'}

FINAL FORMATTING:
- Output ONLY the raw SVG parts and text explanations, each separated by the literal ---PART_SEPARATOR--- string on its own line.
- Do not output any checklist, preface, or text before SVG Part 1. The first characters of the response must begin with "<svg".
- SVG Part 1: Root SVG (${width}x${height}) with a ${theme === 'dark' ? `dark` : `white`} background rect.
- SVG Part 2: The title (in a <g> group).
- Text Part 3: A brief practical overview.
- Subsequent SVG Parts: One per conceptual addition—never more than one per part.
- Text Explanation: Follows each SVG addition, written as a plain, punchy statement about what the just-added idea or element means.

All explanations are plain text. All SVG parts are raw XML snippets, ready for injection. No wrappers, markdown, or external commentary.`;

/**
 * Generates an SVG for a given topic using the Gemini API and streams the response.
 * @param topic The user-provided topic.
 * @param onStream A callback function that receives chunks of the SVG content as they arrive.
 * @returns A promise that resolves when the stream is complete.
 */
export const generateSvgForTopicStream = async (
  topic: string,
  _limitThinking: boolean,
  onStream: (chunk: string) => void,
  dimensions?: { width: number; height: number },
  theme: ThemeMode = 'light'
): Promise<void> => {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set.');
  }

  const dims = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : { width: 960, height: 600 };

  const messages = [
    { role: 'system', content: buildSystemPrompt(dims.width, dims.height, theme) },
    { role: 'user', content: topic },
  ];

  const referer = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'http://localhost';
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'Tutor',
    },
    body: JSON.stringify({
      model: 'moonshotai/kimi-k2-0905',
      stream: true,
      provider: { only: ['baseten/fp4'] },
      messages,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    console.error('OpenRouter request failed', resp.status, text);
    throw new Error('Could not connect to OpenRouter.');
  }

  // Minimal SSE reader: parse events split by double newlines, read data: lines
  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() || '';

    for (const evt of events) {
      const lines = evt.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta;
          const content = typeof delta?.content === 'string' ? delta.content : '';
          if (content) onStream(content);
        } catch (e) {
          // Ignore malformed JSON lines
        }
      }
    }
  }
};

// --- Conversational follow-ups (official Gemini chat) ---

type ORMessage = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; name?: string; tool_call_id?: string };
type OpenRouterChatSession = { model: string; messages: ORMessage[] };

let chatSession: OpenRouterChatSession | null = null;

/**
 * Creates (or replaces) a chat session seeded with the initial exchange.
 * Use this immediately after the first generation so follow-up questions
 * keep prior context the official Gemini way.
 */
export const seedChatFromInitialExchange = async (
  userPrompt: string,
  modelResponse: string,
  limitThinking: boolean,
  dimensions?: { width: number; height: number },
  theme: ThemeMode = 'light'
): Promise<void> => {
  const dims = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : { width: 960, height: 600 };
  chatSession = {
    model: 'moonshotai/kimi-k2-0905',
    messages: [
      { role: 'system', content: buildSystemPrompt(dims.width, dims.height, theme) },
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: modelResponse },
    ],
  };
};

/**
 * Sends a follow-up question using the persistent chat session. Streams text chunks.
 * If a session does not exist, this throws – callers should seed first.
 */
export const sendFollowUpStream = async (
  question: string,
  onStream: (chunk: string) => void
): Promise<void> => {
  if (!chatSession) {
    throw new Error('No active chat session. Seed the chat after initial generation.');
  }
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY environment variable is not set.');
  }

  const referer = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'http://localhost';

  const messages: ORMessage[] = [...chatSession.messages, { role: 'user', content: question }];
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'Tutor',
    },
    body: JSON.stringify({
      model: chatSession.model,
      provider: { only: ['baseten/fp4'] },
      stream: true,
      messages,
      max_tokens: 4096,
    }),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '');
    console.error('OpenRouter follow-up failed', resp.status, text);
    throw new Error('Could not send follow-up to OpenRouter.');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let accumulated = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const evt of events) {
      for (const line of evt.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta;
          const content = typeof delta?.content === 'string' ? delta.content : '';
          if (content) { onStream(content); accumulated += content; }
        } catch {}
      }
    }
  }

  // Persist the turn in the session
  chatSession.messages.push({ role: 'user', content: question });
  if (accumulated) chatSession.messages.push({ role: 'assistant', content: accumulated });
};

/** Clears the in-memory chat session. */
export const resetChat = (): void => {
  chatSession = null;
};
