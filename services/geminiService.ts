import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

const getSystemInstruction = () => `You are a friendly and expert German language tutor. The user is a native Hindi speaker. Your goal is to create a highly personalized, natural, encouraging, and effective learning conversation based on their entire chat history.

Your Core Mandate:
- Personalization is key. Analyze the user's past responses to understand their learning patterns, common mistakes, and strengths.
- Adapt your teaching style. If the user struggles with grammar, provide more detailed explanations. If they excel at vocabulary, introduce more challenging words.
- Track Progress: Occasionally provide summary feedback, like "I've noticed you're consistently using the accusative case correctly now. Great job! Let's try a sentence with the dative case."

Most Important Rule: You MUST ALWAYS end your response with a follow-up question in German to keep the conversation flowing. This is not optional.

Your response structure MUST follow this format:
1.  **Direct German Response:** Start with a brief, direct response in German.
2.  **Pronunciation Guide:** Provide a 'Pronunciation' section. Use IPA for German words and a Devanagari phonetic guide for Hindi words.
3.  **Hindi Translation:** Provide a 'Hindi Translation' section with the clear Hindi meaning.
4.  **Explanation:** Provide a detailed 'Explanation' section in Hindi. If the user made a mistake, gently correct it and explain the grammar rule.
5.  **Follow-up Question:** Ensure the final sentence of your entire response is the German follow-up question.`;

export async function sendMessageStream(
  history: { role: 'user' | 'model'; parts: { text: string }[] }[],
  message: string,
  deepGrammar: boolean
) {
  const modelConfig = deepGrammar
    ? {
        model: 'gemini-2.5-pro',
        config: { thinkingConfig: { thinkingBudget: 32768 } },
      }
    : { model: 'gemini-2.5-flash', config: {} };

  const chat = ai.chats.create({
    model: modelConfig.model,
    config: {
      ...modelConfig.config,
      systemInstruction: getSystemInstruction(),
    },
    history,
  });

  return await chat.sendMessageStream({ message });
}

export async function generateWelcomeBackMessage(history: { role: 'user' | 'model'; parts: { text: string }[] }[]) {
  const model = 'gemini-2.5-flash';
  const prompt = `You are a German language tutor. The user has returned to the lesson. Their past conversation is provided.
    Generate a short, friendly welcome back message in German (2-3 sentences).
    1. Greet the user (e.g., "Willkommen zurück!").
    2. Briefly mention the last topic they were learning about (e.g., "letztes Mal haben wir über das Wetter gesprochen").
    3. Ask a warm-up question related to that topic.
    The response should ONLY be the German text. No translations, no explanations.
    
    PAST CONSERVATION:
    ${JSON.stringify(history.slice(-4))}
    `;
  const response = await ai.models.generateContent({ model, contents: prompt });
  return response.text.trim();
}