import { GoogleGenAI, Modality } from '@google/genai';
import { decode, decodeAudioData } from './audioUtils';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

class GeminiTtsService {
  private audioContext: AudioContext | null = null;
  private audioQueue: AudioBuffer[] = [];
  private isPlaying = false;
  private currentGenerationId = 0;
  private sources: AudioBufferSourceNode[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  }

  public ensureAudioContextResumed() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  private parseTextForSpeech(text: string): string {
    let cleanText = text;

    // 1. Aggressively remove IPA notations, which are often inside square brackets.
    // This is the most reliable way to prevent the TTS API from failing on unpronounceable characters.
    cleanText = cleanText.replace(/\[.*?\]/g, '');

    // 2. Clean up markdown formatting and section headers.
    cleanText = cleanText
      .replace(/\*\*Pronunciation:\*\*/g, '') // Remove the header completely
      .replace(/\*\*.*?\:\*\*/g, ', ')      // Replace other headers with a pause
      .replace(/[`*()\[\]{}]/g, '')         // Remove various markdown/bracket characters
      .replace(/(\r\n|\n|\r)/gm, ' ')      // Replace newlines with spaces
      .replace(/\s+/g, ' ')                // Collapse multiple spaces
      .trim();

    // 3. Final cleanup for artifacts from replacements
    if (cleanText.startsWith(',')) {
        cleanText = cleanText.substring(1).trim();
    }
    
    return cleanText;
  }

  public async speak(text: string, generationId: number, onError: (error: string) => void) {
    if (!text || !this.audioContext) return;

    // If the generation ID doesn't match, this is a stale request.
    if (generationId !== this.currentGenerationId) {
      return;
    }

    const cleanText = this.parseTextForSpeech(text);
    if (!cleanText || cleanText.length < 2) return;

    // Add a safety check for length to prevent potential API errors
    const MAX_TTS_CHARS = 4000;
    if (cleanText.length > MAX_TTS_CHARS) {
        onError(`Text is too long for audio generation (${cleanText.length} > ${MAX_TTS_CHARS}).`);
        return;
    }

    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: cleanText }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      if (base64Audio) {
        if (generationId !== this.currentGenerationId) {
            return; // Stale request, another one has started.
        }
        const audioBuffer = await decodeAudioData(decode(base64Audio), this.audioContext, 24000, 1);
        this.audioQueue.push(audioBuffer);
        if (!this.isPlaying) {
          this.playQueue();
        }
      } else {
        onError("API did not return audio data.");
      }
    } catch (e: any) {
      console.error("Error generating TTS audio:", e);
      const errorMessage = e.message ? `${e.message}` : "An unknown error occurred during audio generation.";
      onError(`Error generating TTS audio:\n${errorMessage}`);
    }
  }

  private playQueue() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }
    this.isPlaying = true;
    const audioBuffer = this.audioQueue.shift();
    if (audioBuffer && this.audioContext) {
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      this.sources.push(source);
      source.onended = () => {
        // Remove the source from the list
        this.sources = this.sources.filter(s => s !== source);
        this.playQueue();
      };
      source.start();
    }
  }

  public cancel(): number {
    this.audioQueue = [];
    this.sources.forEach(source => source.stop());
    this.sources = [];
    this.isPlaying = false;
    // Increment the generation ID to invalidate any pending async operations
    this.currentGenerationId++;
    return this.currentGenerationId;
  }
}

// Export a singleton instance
export const geminiTtsService = new GeminiTtsService();