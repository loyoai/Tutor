import {
  GoogleGenAI,
  LiveServerMessage,
  MediaResolution,
  Modality,
  Session,
} from '@google/genai';

/**
 * Decodes a base64 string into a Uint8Array, then converts the resulting
 * 16-bit PCM audio data into a Float32Array for the Web Audio API.
 */
function pcm16bitToFloat32(base64String: string): Float32Array {
    try {
        const binaryString = atob(base64String);
        const len = binaryString.length;
        const buffer = new ArrayBuffer(len);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < len; i++) {
            view[i] = binaryString.charCodeAt(i);
        }
        
        // The buffer contains 16-bit signed integers.
        const int16Array = new Int16Array(buffer);
        const float32Array = new Float32Array(int16Array.length);
        
        // Convert each 16-bit sample to a float between -1.0 and 1.0.
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }
        
        return float32Array;
    } catch (e) {
        console.error("Error decoding audio data:", e);
        return new Float32Array(0);
    }
}

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
}

function convertToWav(rawData: string[], mimeType: string): Buffer {
  const options = parseMimeType(mimeType);
  const dataLength = rawData.reduce((a, b) => a + b.length, 0);
  const wavHeader = createWavHeader(dataLength, options);
  const buffer = Buffer.concat(rawData.map(data => Buffer.from(data, 'base64')));

  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType: string): WavConversionOptions {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options: Partial<WavConversionOptions> = {
    numChannels: 1,
    bitsPerSample: 16,
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options as WavConversionOptions;
}

function createWavHeader(dataLength: number, options: WavConversionOptions): Buffer {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0);                      // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
  buffer.write('WAVE', 8);                      // Format
  buffer.write('fmt ', 12);                     // Subchunk1ID
  buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);        // NumChannels
  buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
  buffer.writeUInt32LE(byteRate, 28);           // ByteRate
  buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
  buffer.write('data', 36);                     // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

  return buffer;
}

interface AudioChunk {
  data: string;
  mimeType: string;
  chunkIndex: number;
}

interface QueuedSpeechRequest {
  text: string;
  resolve: () => void;
  reject: (reason?: any) => void;
  audioChunks: AudioChunk[];
  isPlaying: boolean;
  playedChunkCount: number;
  isComplete: boolean;
}

export class GeminiLiveAudioService {
    private ai: GoogleGenAI;
    private session?: Session;
    private audioContext?: AudioContext;
    private responseQueue: LiveServerMessage[] = [];
    private speechQueue: QueuedSpeechRequest[] = [];
    private isProcessingQueue = false;
    private isSessionWarmedUp = false;
    private chunkCounter = 0;
    
    constructor() {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable is not set.");
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }

    public async connect(): Promise<void> {
        if (this.session) {
            console.warn("Session already connected.");
            return;
        }

        // Initialize audio context for browser environment
        if (typeof window !== 'undefined') {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const config = {
            responseModalities: [Modality.AUDIO],
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            speechConfig: {
                languageCode: 'en-US',
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: 'Zephyr',
                    }
                }
            },
            contextWindowCompression: {
                triggerTokens: '25600',
                slidingWindow: { targetTokens: '12800' },
            },
            systemInstruction: {
                parts: [{
                    text: `You are a transcriber who will repeat everything I say exactly as is fully. Do not shorten or condense. Say it fully as is. i.e. user say: "What is design thinking?" you reply: "What is design thinking?"`,
                }]
            },
        };

        try {
            this.session = await this.ai.live.connect({
                model: 'models/gemini-2.5-flash-live-preview',
                callbacks: {
                    onopen: () => {
                        console.debug('Gemini Live session opened');
                        this.isSessionWarmedUp = true;
                    },
                    onmessage: this.handleMessage.bind(this),
                    onerror: (e: ErrorEvent) => console.error('Session Error:', e.message),
                    onclose: (e: CloseEvent) => {
                        console.log('Session Closed:', e.reason);
                        this.isSessionWarmedUp = false;
                    },
                },
                config
            });
        } catch (error) {
            console.error("Failed to connect to Gemini Live audio service:", error);
            throw error;
        }
    }

    private handleMessage(message: LiveServerMessage): void {
        this.responseQueue.push(message);
        this.processMessage(message);
    }

    private processMessage(message: LiveServerMessage): void {
        if (!this.speechQueue.length) return;

        const currentRequest = this.speechQueue[0];
        
        if (message.serverContent?.modelTurn?.parts) {
            const part = message.serverContent.modelTurn.parts[0];
            
            if (part?.inlineData?.data) {
                // Add audio chunk to queue
                const audioChunk: AudioChunk = {
                    data: part.inlineData.data,
                    mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                    chunkIndex: this.chunkCounter++
                };
                
                currentRequest.audioChunks.push(audioChunk);
                
                // Start playing if not already playing
                if (!currentRequest.isPlaying) {
                    this.startPlayingChunks(currentRequest);
                }
            }
        }

        if (message.serverContent?.turnComplete) {
            currentRequest.isComplete = true;
        }
    }

    private startPlayingChunks(request: QueuedSpeechRequest): void {
        request.isPlaying = true;
        this.playNextChunk(request);
    }

    private playNextChunk(request: QueuedSpeechRequest): void {
        if (!this.audioContext) {
            console.warn("Audio context not available");
            this.finishCurrentSpeechRequest();
            return;
        }

        // Check if we have more chunks to play
        if (request.playedChunkCount >= request.audioChunks.length) {
            // No more chunks, check if turn is complete
            if (request.isComplete) {
                this.finishCurrentSpeechRequest();
            }
            return;
        }

        const chunk = request.audioChunks[request.playedChunkCount];
        
        try {
            const audioData = pcm16bitToFloat32(chunk.data);
            if (audioData.length === 0) {
                request.playedChunkCount++;
                this.playNextChunk(request);
                return;
            }
            
            const sampleRate = 24000; // Expected from gemini-2.5-flash-live-preview
            const buffer = this.audioContext.createBuffer(1, audioData.length, sampleRate);
            buffer.getChannelData(0).set(audioData);

            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            
            source.onended = () => {
                request.playedChunkCount++;
                // Small delay before playing next chunk to avoid overlap
                setTimeout(() => {
                    this.playNextChunk(request);
                }, 10);
            };
            
            source.start(0);
        } catch (error) {
            console.error("Error playing audio chunk:", error);
            request.playedChunkCount++;
            this.playNextChunk(request);
        }
    }


    private finishCurrentSpeechRequest(): void {
        const currentRequest = this.speechQueue.shift();
        if (currentRequest) {
            currentRequest.resolve();
        }
        this.isProcessingQueue = false;
        this.processQueue();
    }

    public async warmUpSession(): Promise<void> {
        if (!this.isSessionWarmedUp && !this.session) {
            await this.connect();
        }
    }

    public speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!text || text.trim() === '') {
                return resolve();
            }
            
            const request: QueuedSpeechRequest = {
                text,
                resolve,
                reject,
                audioChunks: [],
                isPlaying: false,
                playedChunkCount: 0,
                isComplete: false
            };
            
            this.speechQueue.push(request);
            this.processQueue();
        });
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessingQueue || this.speechQueue.length === 0) {
            return;
        }
        
        if (!this.session) {
            await this.connect();
        }
        
        if (!this.session) {
            const request = this.speechQueue.shift();
            if (request) {
                request.reject(new Error("Session not connected."));
            }
            return;
        }
        
        this.isProcessingQueue = true;
        const request = this.speechQueue[0];
        
        try {
            this.session.sendClientContent({
                turns: [request.text]
            });
        } catch (error) {
            console.error("Error sending content to session:", error);
            const failedRequest = this.speechQueue.shift();
            if (failedRequest) {
                failedRequest.reject(error);
            }
            this.isProcessingQueue = false;
            this.processQueue();
        }
    }

    public disconnect(): void {
        this.session?.close();
        this.audioContext?.close().catch(console.error);
        this.session = undefined;
        this.audioContext = undefined;
        this.isSessionWarmedUp = false;
        
        // Reject any pending promises in the queue
        this.speechQueue.forEach(request => 
            request.reject(new Error("Audio service disconnected."))
        );
        this.speechQueue = [];
        this.responseQueue = [];
        this.isProcessingQueue = false;
        this.chunkCounter = 0;
    }

    // Utility method for pre-warming when user starts typing/thinking
    public async preWarmForQuestion(): Promise<void> {
        if (!this.isSessionWarmedUp) {
            console.log("Pre-warming Gemini Live session...");
            await this.warmUpSession();
        }
    }
}
