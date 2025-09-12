const FLASH_DEBUG = true;
const flog = (...args: any[]) => { if (FLASH_DEBUG) console.log('[Flash]', ...args); };
const fwarn = (...args: any[]) => { if (FLASH_DEBUG) console.warn('[Flash]', ...args); };
const ferr = (...args: any[]) => { if (FLASH_DEBUG) console.error('[Flash]', ...args); };

export type FlashToolName =
  | 'askOpenEndedQuestion'
  | 'askMultipleChoiceQuestion'
  | 'askTrueFalseQuestion'
  | 'giveDetailedLesson';

export type FlashEvent =
  | { type: 'openQuestion'; showOpenEded: boolean; preface?: string }
  | { type: 'multipleChoice'; choices: string[]; topic: string; preface?: string }
  | { type: 'trueFalse'; showTrueFalse: boolean; preface?: string }
  | { type: 'detailedLesson'; concept: string; userLevel?: string; examples?: string[]; connectionToPriorKnowledge?: string; preface?: string };

export type FlashTranscriptItem = {
  role: 'assistant' | 'user' | 'system';
  text: string;
};

const TEACHING_ASSISTANT_PROMPT = `You are an approachable-yet-dynamic teacher who helps users learn through guided discovery and progressive topic mastery.

CORE PRINCIPLES

Guide, don't give answers – Help users discover solutions through questions and hints
Build on existing knowledge – Connect new ideas to what they already know
Progress systematically – Move through topics in logical sequence with brief engagement bursts. first give a general lession using giveDetailedLesson then call it again after checking understanding and warming up to go deeper each time.

LESSON FLOW STRUCTURE
Default approach: Start with warming the student through socratic method (1-3 very simple and short questions)  then call giveDetailedLesson for explaining the topics, then briefly check understanding then warm for the next topic (giveDetailedLesson) and so on.
For each topic cycle:

Warm up (1-3) very short and simple questions using the socratic method
Core Teaching FIRST - Use giveDetailedLesson to deliver an explanation
Understanding Check - (1-2) question to verify comprehension
Topic Transition - Brief warm-up (1-2 socratic) for next related topic, then call giveDetailedLesson again


ENGAGEMENT STRATEGIES
There are 5 types of engagement you can use depending on the context (you don't have to use all).
giveDetailedLesson - PRIMARY TOOL for teaching concepts and topics
askOpenEndedQuestion - For understanding checks and topic transitions
askMultipleChoiceQuestion - For quick understanding or engagement
askTrueFalseQuestion - For rapid comprehension checks

PROGRESSION RULES

Socratic, Teach, then verify 
No questioning loops - Maximum 2 questions before delivering content
One function call per response - Wait for user response before continuing
Forward momentum - Always work toward deeper understanding

TONE

Warm but focused
Patient but maintains progress
Plain-spoken, minimal exclamation marks
Conversational, not lecture-like

Function parameter rules:
- askMultipleChoiceQuestion: remove 'question' property; only provide 'choices' (array) and 'topic' (string)
- askTrueFalseQuestion: only provide { showTrueFalse: boolean }
- askOpenEndedQuestion: only provide { showOpenEded: boolean }
- Do NOT use any two-choices function.

Start by a very short intro and a simple easy question in socratic method.
Response structure rules:

- For the FIRST response only: write exactly TWO very short sentences of plain text before the function call:
  1) a very short intro (≤10 words)
  2) one Socratic question (≤15 words)
  Then include exactly ONE function call.

- For all SUBSEQUENT responses: write exactly ONE short sentence (≤20 words) that contains the next Socratic question or brief transition, then include exactly ONE function call.

- Never omit the plain-text preface. The natural-language question must be visible in that preface even if function parameters are minimal.
- When using askOpenEndedQuestion, include the full question in the preface (since the function only takes a boolean).
- When using askMultipleChoiceQuestion or askTrueFalseQuestion, include the question or statement in the preface as a single sentence.
- Do not output more than the allowed number of sentences of plain text before the function call.
`;

const functionDeclarations = [
  {
    name: 'askOpenEndedQuestion',
    description:
      'Engages the user with an open-ended question to explore their understanding and encourage critical thinking',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        showOpenEded: { type: 'boolean', description: 'Whether to show an open-ended input' },
      },
      required: ['showOpenEded'],
    },
  },
  {
    name: 'askMultipleChoiceQuestion',
    description:
      'Presents a multiple choice question to test understanding and provide structured learning paths',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        choices: { type: 'array', description: 'Array of answer choices', items: { type: 'string' } },
        topic: { type: 'string', description: 'The subject area being tested' },
      },
      required: ['choices', 'topic'],
    },
  },
  {
    name: 'askTrueFalseQuestion',
    description: 'Poses a true/false question to quickly assess understanding of key concepts',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        showTrueFalse: { type: 'boolean', description: 'Whether to show a True/False prompt' },
      },
      required: ['showTrueFalse'],
    },
  },
  {
    name: 'giveDetailedLesson',
    description: 'Provides a comprehensive explanation of a concept with examples and guided practice',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        concept: { type: 'string', description: 'The main concept or topic to teach' },
        userLevel: { type: 'string', description: "User's grade level or experience" },
        examples: { type: 'array', items: { type: 'string' }, description: 'Relevant examples' },
        connectionToPriorKnowledge: { type: 'string', description: 'Links to prior knowledge' },
      },
      required: ['concept'],
    },
  },
];

type OnEvent = (event: FlashEvent) => void;

export class FlashTutorService {
  private messages: any[] = [];
  private onEvent?: OnEvent;
  private pendingCall: { id: string; name: FlashToolName } | null = null;
  private submitting = false;

  constructor() {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY environment variable is not set.');
    }
  }

  private mapTools() {
    // Map our declarations to OpenAI-compatible tool schema
    return functionDeclarations.map((fd) => ({
      type: 'function',
      function: {
        name: fd.name,
        description: fd.description,
        parameters: fd.parametersJsonSchema,
      },
    }));
  }

  private headers() {
    const referer = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'http://localhost';
    return {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': referer,
      'X-Title': 'Tutor',
    } as Record<string, string>;
  }

  async start(goal: string, onEvent: OnEvent): Promise<void> {
    this.onEvent = onEvent;
    this.messages = [
      { role: 'system', content: TEACHING_ASSISTANT_PROMPT },
      { role: 'user', content: goal },
    ];
    flog('start()', { goalPreview: goal.slice(0, 120) });
    const body = {
      model: 'moonshotai/kimi-k2-0905',
      messages: this.messages,
      tools: this.mapTools(),
      tool_choice: 'required',
      provider: { only: ['baseten/fp4'] },
      max_tokens: 2048,
    } as any;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      ferr('start(): OpenRouter error', resp.status, t);
      throw new Error('Flash agent request failed');
    }
    const json = await resp.json();
    flog('start(): response received');
    this.handleResponse(json);
  }

  // For tool results, pass the function name and a structured response object
  async submitToolResult(functionName: FlashToolName, response: unknown): Promise<void> {
    if (this.submitting) return; // prevent double submissions
    this.submitting = true;
    try {
      flog('submitToolResult()', { expect: this.pendingCall, sendingFor: functionName, response });
      const id = this.pendingCall?.id;
      const expectName = this.pendingCall?.name;
      if (!id || !expectName || expectName !== functionName) {
        // No pending tool call: treat this as a plain user reply
        fwarn('submitToolResult(): pending mismatch, sending as user message');
        let userText = '';
        try {
          if (functionName === 'askTrueFalseQuestion') {
            const ans = (response as any)?.answer;
            userText = `Answer: ${ans ? 'True' : 'False'}`;
          } else if (functionName === 'askMultipleChoiceQuestion') {
            const sel = (response as any)?.selected;
            userText = `I choose: ${String(sel)}`;
          } else if (functionName === 'askOpenEndedQuestion') {
            const ans = (response as any)?.answer;
            userText = typeof ans === 'string' ? ans : JSON.stringify(response);
          } else if (functionName === 'giveDetailedLesson') {
            userText = 'Ready for the next lesson segment.';
          }
        } catch { userText = JSON.stringify(response); }
        this.messages.push({ role: 'user', content: userText });
        const reqBody = {
          model: 'moonshotai/kimi-k2-0905',
          messages: this.messages,
          tools: this.mapTools(),
          tool_choice: 'required',
          provider: { only: ['baseten/fp4'] },
          max_tokens: 1024,
        } as any;
        try {
          const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(reqBody),
          });
          const json = await resp.json();
          flog('submitToolResult(): response after mismatch');
          this.handleResponse(json);
        } catch (e) {
          ferr('submitToolResult(): network error on mismatch path', e);
          throw new Error('Network error submitting reply. Please try again.');
        }
        return;
      }
      // Send tool result
      this.messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(response) });
      flog('submitToolResult(): sending tool result');
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          model: 'moonshotai/kimi-k2-0905',
          messages: this.messages,
          tools: this.mapTools(),
          tool_choice: 'required',
          provider: { only: ['baseten/fp4'] },
          max_tokens: 1024,
        }),
      });
      const json = await resp.json();
      flog('submitToolResult(): response after tool content');
      // Clear pending call after we send the response
      this.pendingCall = null;
      this.handleResponse(json);
    } finally {
      this.submitting = false;
    }
  }

  private handleResponse(res: any) {
    flog('handleResponse() invoked');
    const choice = res?.choices?.[0];
    const message = choice?.message || {};
    const toolCalls = message?.tool_calls || message?.toolCalls || [];
    let name: FlashToolName | undefined;
    let args: any = undefined;
    let id: string | undefined;
    const prefaceText: string = (typeof message?.content === 'string') ? message.content : (Array.isArray(message?.content) ? message.content.map((c: any) => c?.text || '').join(' ').trim() : '');

    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      const first = toolCalls[0];
      name = first?.function?.name as FlashToolName | undefined;
      id = first?.id;
      try {
        args = first?.function?.arguments ? JSON.parse(first.function.arguments) : {};
      } catch {
        args = {};
      }
    }
    flog('handleResponse(): parsed', { name, id, args, prefaceLen: prefaceText?.length || 0 });

    if (!name) {
      // Fallback: trigger an open-ended prompt when no function call is present
      if (this.onEvent) {
        const ev = { type: 'openQuestion' as const, showOpenEded: true, preface: prefaceText || undefined };
        flog('handleResponse(): no func call, emitting event', ev);
        this.onEvent(ev);
      }
      return;
    }

    if (id && name) {
      this.pendingCall = { id, name };
    }

    if (!this.onEvent) return;
    const preface = prefaceText || undefined;
    flog('handleResponse(): extracted preface', preface);
    switch (name) {
      case 'askOpenEndedQuestion':
        {
          const ev = { type: 'openQuestion' as const, showOpenEded: Boolean(args?.showOpenEded), preface };
          flog('emit event', ev);
          this.onEvent(ev);
        }
        break;
      case 'askMultipleChoiceQuestion':
        {
          const ev = { type: 'multipleChoice' as const, choices: args?.choices || [], topic: args?.topic || '', preface };
          flog('emit event', ev);
          this.onEvent(ev);
        }
        break;
      case 'askTrueFalseQuestion':
        {
          const ev = { type: 'trueFalse' as const, showTrueFalse: Boolean(args?.showTrueFalse), preface };
          flog('emit event', ev);
          this.onEvent(ev);
        }
        break;
      case 'giveDetailedLesson':
        {
          const ev = {
            type: 'detailedLesson' as const,
            concept: args?.concept || '',
            userLevel: args?.userLevel,
            examples: args?.examples,
            connectionToPriorKnowledge: args?.connectionToPriorKnowledge,
            preface,
          };
          flog('emit event', ev);
          this.onEvent(ev);
        }
        break;
      default:
        // Ignore unknown
        break;
    }
    // Persist the assistant message (including tool_calls) for proper linking
    try {
      const choice = res?.choices?.[0];
      const msg = choice?.message || { role: 'assistant', content: preface || '' };
      this.messages.push(msg);
    } catch {
      this.messages.push({ role: 'assistant', content: preface || '' });
    }
  }
}
