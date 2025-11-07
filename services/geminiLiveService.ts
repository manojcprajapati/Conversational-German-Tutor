import { GoogleGenAI, LiveServerMessage, Modality, Blob } from '@google/genai';
import { encode, decode, decodeAudioData } from './audioUtils';

// --- Live Service ---

export interface LiveCallbacks {
  onopen: () => void;
  onmessage: (message: LiveServerMessage) => Promise<void>;
  onerror: (e: ErrorEvent) => void;
  onclose: (e: CloseEvent) => void;
}

const BASE_LIVE_SYSTEM_INSTRUCTION = `You are a friendly German voice tutor for a beginner. Your goal is maximum responsiveness and keeping the conversation flowing.
- **Ultra-fast replies:** Respond as quickly as possible.
- **Simple German:** Use very simple A1-level words and short sentences.
- **Always ask a question:** Your response MUST end with a simple follow-up question to keep the conversation going.
- **Voice only:** This is a voice conversation. Do not use markdown or refer to text.
`;

class GeminiLiveService {
  private ai: GoogleGenAI;
  private sessionPromise: Promise<any> | null = null;
  private audioStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  private outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("The API_KEY environment variable is not set.");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  public async connect(callbacks: LiveCallbacks): Promise<void> {
    if (this.sessionPromise) {
        console.log("A session is already connecting or active.");
        return;
    }
    
    this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this.sessionPromise = this.ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      callbacks: {
        ...callbacks,
        onmessage: async (message) => {
            await this.handleAudioMessage(message);
            await callbacks.onmessage(message);
        },
        onclose: (e) => {
            this.cleanup();
            callbacks.onclose(e);
        },
        onerror: (e) => {
            this.cleanup();
            callbacks.onerror(e);
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
        systemInstruction: BASE_LIVE_SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingBudget: 0 }, 
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
    
    // Start streaming microphone audio
    this.startMicrophone();
  }

  private startMicrophone() {
    if (!this.audioStream) return;
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const source = this.audioContext.createMediaStreamSource(this.audioStream);
    this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
      const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
      const pcmBlob = this.createBlob(inputData);
      // Fix: Use the session promise to avoid stale closures.
      this.sessionPromise?.then((session) => {
        session.sendRealtimeInput({ media: pcmBlob });
      });
    };

    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(this.audioContext.destination);
  }

  private createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
  }

  private async handleAudioMessage(message: LiveServerMessage) {
    const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (base64Audio) {
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      const audioBuffer = await decodeAudioData(decode(base64Audio), this.outputAudioContext, 24000, 1);
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioContext.destination);
      source.addEventListener('ended', () => this.sources.delete(source));
      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.sources.add(source);
    }

    if (message.serverContent?.interrupted) {
      for (const source of this.sources.values()) {
        source.stop();
        this.sources.delete(source);
      }
      this.nextStartTime = 0;
    }
  }
  
  public close() {
    this.sessionPromise?.then(session => session.close());
    this.cleanup();
  }

  private cleanup() {
    this.audioStream?.getTracks().forEach(track => track.stop());
    this.audioStream = null;

    this.scriptProcessor?.disconnect();
    this.scriptProcessor = null;

    this.audioContext?.close();
    this.audioContext = null;

    this.sessionPromise = null;
    this.nextStartTime = 0;
    this.sources.forEach(s => s.disconnect());
    this.sources.clear();

    if (this.outputAudioContext.state === 'closed') {
        this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
  }
}

export const geminiLiveService = new GeminiLiveService(process.env.API_KEY as string);
