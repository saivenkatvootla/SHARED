
import { GoogleGenAI, Type } from "@google/genai";

export const getGeminiClient = () => {
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

/**
 * HIGH-SPEED SCREEN ANALYSIS
 * Extracts keywords and matches against RAG context.
 */
export async function analyzeScreenContent(
  base64Image: string, 
  modeGuidelines: string,
  modeFileContent: string,
  policyMemory: string[]
): Promise<{ question: string; answer: string; policyApplied: string } | null> {
  const ai = getGeminiClient();
  
  const systemPrompt = `
    TASK: FAST Technical Extraction.
    LANGUAGE: Strictly English.
    
    1. EXTRACT KEYWORDS from the image.
    2. CONSULT RAG CONTEXT: ${modeFileContent.slice(0, 15000)}
    3. APPLY USER GUIDELINES: ${modeGuidelines}
    4. APPLY MEMORY: ${policyMemory.slice(-5).join(' | ')}
    
    If the image contains a technical question, provide the answer from the context immediately.
    Be extremely concise. Use technical terminology.
    
    Response MUST be JSON.
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
            question: { type: Type.STRING, description: "The keywords/question found" },
            answer: { type: Type.STRING, description: "The fast technical answer" },
            policyApplied: { type: Type.STRING, description: "Specific project or guideline used" }
          },
          required: ["question", "answer", "policyApplied"]
        }
      }
    });

    return JSON.parse(response.text || '{}');
  } catch (error) {
    console.error("Screen Agent Error:", error);
    return null;
  }
}

/**
 * FAST TEXT QUERY
 */
export async function processTypedQuestion(
  question: string,
  history: string[],
  modeGuidelines: string,
  modeFileContent: string,
  policyMemory: string[]
): Promise<{ answer: string; policyApplied: string } | null> {
  const ai = getGeminiClient();
  const contextHistory = history.slice(-3).join('\n');

  const prompt = `
    Strictly English. Fast Answer Mode.
    GUIDELINES: ${modeGuidelines}
    RAG: ${modeFileContent.slice(0, 8000)}
    QUERY: ${question}
    HISTORY: ${contextHistory}
    
    Extract keywords and answer from RAG. Respond in JSON.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            policyApplied: { type: Type.STRING }
          },
          required: ["answer", "policyApplied"]
        }
      }
    });
    return JSON.parse(response.text || '{}');
  } catch (error) {
    return null;
  }
}

export function encodeAudio(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeAudio(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

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
    for (let i = 0; i < frameCount; i++) channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
  }
  return buffer;
}
