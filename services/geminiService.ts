import { GoogleGenAI, Chat } from '@google/genai';

const buildSystemPrompt = (width: number, height: number) => `Developer: You are an expert visual designer and master tutor. Your mission is to create a beautiful, minimal SVG diagram that brings a complex topic to life for the user and make the learning process highly engaging and practical. Build the SVG in very small, frequent steps, with each part serving as a springboard for a lively, concrete teaching moment.

Your output is a sequence of parts. Each part is either an SVG code snippet or text explanation. Every part MUST be separated by "---PART_SEPARATOR---" on its own line.

TUTORIAL FLOW & PACING:
- Absolutely no text or lists before the first SVG. The very first output must be the root SVG.
 - Start by DRAWING the root SVG immediately: exact size ${width}x${height} with a white background (#FFFFFF).
- Next, DRAW the title as SVG (e.g., a <g> with the main title text).
- Then EXPLAIN: provide a brief, practical summary of the topic’s importance.
- After that, structure strictly alternates DRAW and EXPLAIN: draw the next element, then explain, and so forth.

FOLLOW‑UPS:
- For any follow‑up question, START OVER with a completely new, self‑contained tutorial.
- The first characters of the follow‑up response must be "<svg" for a fresh root SVG (${width}x${height}, white background), followed by a new title, then brief explanation, and so on.
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
3. Layout: Space and align for superb clarity—no crowding or clutter. Rigorously apply composition principles for legibility and harmony. The root background must be white (#FFFFFF).
4. Icons: Add icons only via the <lucide-icon /> tag. Never use inline SVG paths for icons.
    - Format: <lucide-icon name="icon-name" x="center-x" y="center-y" size="pixel-size" color="hex-color" />
    - Example: <lucide-icon name="zap" x="480" y="300" size="48" color="#A78BFA" />
    - If the icon name is invalid, display a generic placeholder (e.g., <lucide-icon name="help-circle" ... />). Do not emit error text.
    - If provided positions or attributes are invalid or out of bounds, auto-correct for visibility—never emit an error or extra text about it.
5. SVG Parts:
    - SVG Part 1: Must be the root SVG including the background <rect>, size ${width}x${height}, with fill="#FFFFFF".
    - SVG Part 2: Must be the title, as a group containing the title text.
    - Text Part 3: An explanation summarizing the topic’s practical importance.
    - Further SVG Parts: Each new draw is one atomic SVG snippet (label, line, <lucide-icon />, etc.).

FINAL FORMATTING:
- Output ONLY the raw SVG parts and text explanations, each separated by the literal ---PART_SEPARATOR--- string on its own line.
- Do not output any checklist, preface, or text before SVG Part 1. The first characters of the response must begin with "<svg".
- SVG Part 1: Root SVG (${width}x${height}) with a white background rect.
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
    limitThinking: boolean,
    onStream: (chunk: string) => void,
    dimensions?: { width: number; height: number }
): Promise<void> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  const dims = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : { width: 960, height: 600 };
  const config: { systemInstruction: string; thinkingConfig?: object } = {
    systemInstruction: buildSystemPrompt(dims.width, dims.height),
  };

  if (limitThinking) {
    config.thinkingConfig = { thinkingBudget: 512 };
  }

  // First, establish the stream. If this fails, surface a clear API error.
  let responseStream: AsyncIterable<any>;
  try {
    responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-pro',
      contents: topic,
      config,
    });
  } catch (apiErr) {
    console.error('Gemini API request failed:', apiErr);
    throw new Error('Could not connect to the generative AI service.');
  }

  // Then, process the stream. If the UI handler throws, propagate its real cause.
  try {
    for await (const chunk of responseStream) {
      // Some stream events may not contain text; coerce to an empty string.
      const text = (chunk && typeof chunk.text === 'string') ? chunk.text : '';
      onStream(text);
    }
  } catch (handlerErr) {
    console.error('Stream processing failed:', handlerErr);
    // Do not mask handler errors as connectivity problems.
    throw handlerErr instanceof Error ? handlerErr : new Error('Stream handler failed');
  }
};

// --- Conversational follow-ups (official Gemini chat) ---

let chatSession: Chat | null = null;
let aiInstance: GoogleGenAI | null = null;

const getAi = (): GoogleGenAI => {
  if (!process.env.API_KEY) {
    throw new Error('API_KEY environment variable is not set.');
  }
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return aiInstance;
};

/**
 * Creates (or replaces) a chat session seeded with the initial exchange.
 * Use this immediately after the first generation so follow-up questions
 * keep prior context the official Gemini way.
 */
export const seedChatFromInitialExchange = async (
  userPrompt: string,
  modelResponse: string,
  limitThinking: boolean,
  dimensions?: { width: number; height: number }
): Promise<void> => {
  const ai = getAi();
  const dims = dimensions && dimensions.width > 0 && dimensions.height > 0
    ? dimensions
    : { width: 960, height: 600 };
  const config: { systemInstruction: string; thinkingConfig?: object } = {
    systemInstruction: buildSystemPrompt(dims.width, dims.height),
  };
  if (limitThinking) {
    config.thinkingConfig = { thinkingBudget: 512 };
  }

  chatSession = ai.chats.create({
    model: 'gemini-2.5-pro',
    config,
    history: [
      { role: 'user', parts: [{ text: userPrompt }] },
      { role: 'model', parts: [{ text: modelResponse }] },
    ],
  });
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

  try {
    const stream = await chatSession.sendMessageStream({ message: question });
    for await (const chunk of stream) {
      const text = (chunk && typeof chunk.text === 'string') ? chunk.text : '';
      if (text) onStream(text);
    }
  } catch (error) {
    console.error('Error in follow-up send:', error);
    throw new Error('Could not send follow-up to the generative AI service.');
  }
};

/** Clears the in-memory chat session. */
export const resetChat = (): void => {
  chatSession = null;
};
