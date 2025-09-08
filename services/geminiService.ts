import { GoogleGenAI } from "@google/genai";


const SYSTEM_PROMPT = `You are an expert SVG designer. Your sole purpose is to generate a single, complete, and valid SVG code block in response to a user's topic.

The SVG MUST adhere to the following strict requirements:
1.  **Dimensions**: Exactly 960 pixels wide and 600 pixels tall.
2.  **Content**: It must be a beautiful, minimal, and brief visual summary of the requested topic. Include a clear title and concise text.
3.  **Icons**: Do NOT draw custom illustrations or inline SVG icon paths for icons. Instead, you MUST use a special <lucide-icon /> tag to place icons, which the UI will render.
    - **Format**: \`<lucide-icon name="icon-name" x="center-x" y="center-y" size="pixel-size" color="hex-color" />\`
    - **Example**: To place a 48px purple zap icon centered at position (480, 300), use:
      \`\`\`xml
      <lucide-icon name="zap" x="480" y="300" size="48" color="#A78BFA" />
      \`\`\`
4.  **Layout**: Ensure all elements are well-structured with perfect spacing and alignment. There must be no overlapping text or graphical elements. Use composition principles for a balanced and readable layout.
5.  **Design**: The aesthetic should be modern, clean, and professional. Use a pleasing color palette.
6.  **Format**: Your entire output must be ONLY the raw SVG code. Start with "<svg ...>" and end with "</svg>".
7.  **Exclusions**: Do NOT include any other text, explanations, or markdown formatting like \`\`\`xml or \`\`\`.

Generate the SVG code directly.`;


/**
 * Generates an SVG for a given topic using the Gemini API and streams the response.
 * @param topic The user-provided topic.
 * @param onStream A callback function that receives chunks of the SVG content as they arrive.
 * @returns A promise that resolves when the stream is complete.
 */
export const generateSvgForTopicStream = async (
    topic: string,
    limitThinking: boolean,
    onStream: (chunk: string) => void
): Promise<void> => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY environment variable is not set.");
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const config: { systemInstruction: string; thinkingConfig?: object } = {
      systemInstruction: SYSTEM_PROMPT,
    };

    if (limitThinking) {
      config.thinkingConfig = { thinkingBudget: 8192 };
    }
    
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-2.5-pro',
      contents: topic,
      config: config,
    });

    for await (const chunk of responseStream) {
      onStream(chunk.text);
    }
    
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Could not connect to the generative AI service.");
  }
};