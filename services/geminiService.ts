
import { GoogleGenAI, Type } from "@google/genai";

// Use process.env.API_KEY directly as per SDK guidelines.
export const getGeminiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * Analyzes a screenshot to extract and answer questions, considering job role and context file.
 */
export async function analyzeScreenContent(
  base64Image: string, 
  modeInstruction: string,
  contextFileContent: string
): Promise<{ question: string; answer: string } | null> {
  const ai = getGeminiClient();
  
  const systemPrompt = `
    System Instruction: ${modeInstruction}
    
    Additional Context / Knowledge Base:
    ${contextFileContent ? `(Use the following file content to ground your answers)\n${contextFileContent.slice(0, 30000)}` : 'No additional context provided.'}
    
    Task:
    Extract any question or problem visible in this image. 
    Provide a clear, concise answer. 
    Tailor the answer to the instruction and context provided above.
    Return in JSON format.
    
    IMPORTANT: ALL RESPONSES MUST BE IN ENGLISH.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
          { text: systemPrompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            answer: { type: Type.STRING }
          },
          required: ["question", "answer"],
          propertyOrdering: ["question", "answer"]
        }
      }
    });

    const text = response.text;
    if (!text) return null;
    return JSON.parse(text);
  } catch (error) {
    console.error("Screen analysis error:", error);
    return null;
  }
}

/**
 * Processes a typed question using conversational history and mode context.
 */
export async function processTypedQuestion(
  question: string,
  history: string[],
  modeInstruction: string,
  contextFileContent: string
): Promise<string | null> {
  const ai = getGeminiClient();
  const contextHistory = history.slice(-5).join('\n'); // Last few conversation snippets

  const prompt = `
    Mode: ${modeInstruction}
    
    Converastion History:
    ${contextHistory || 'None'}
    
    Knowledge Base:
    ${contextFileContent ? contextFileContent.slice(0, 10000) : 'None'}
    
    User Query: ${question}
    
    Task: Answer the query concisely based on the history and knowledge base provided. 
    Focus on being direct and extremely helpful.
    
    IMPORTANT: ANSWER EXCLUSIVELY IN ENGLISH.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt
    });
    return response.text || "I'm unable to answer that at the moment.";
  } catch (error) {
    console.error("Text query error:", error);
    return null;
  }
}

/**
 * Encodes audio bytes for Gemini Live API.
 */
export function encodeAudio(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes base64 audio for browser AudioContext.
 */
export function decodeAudio(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes raw PCM audio data for browser AudioContext.
 */
export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}
