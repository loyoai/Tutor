import { GoogleGenAI, LiveServerMessage, MediaResolution, Modality, Session } from '@google/genai';

interface WavConversionOptions {
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
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

function createWavHeader(dataLength: number, options: WavConversionOptions): ArrayBuffer {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  // WAV header
  const encoder = new TextEncoder();
  const riff = encoder.encode('RIFF');
  const wave = encoder.encode('WAVE');
  const fmt = encoder.encode('fmt ');
  const data = encoder.encode('data');
  
  view.setUint8(0, riff[0]);
  view.setUint8(1, riff[1]);
  view.setUint8(2, riff[2]);
  view.setUint8(3, riff[3]);
  view.setUint32(4, 36 + dataLength, true);     // ChunkSize
  view.setUint8(8, wave[0]);
  view.setUint8(9, wave[1]);
  view.setUint8(10, wave[2]);
  view.setUint8(11, wave[3]);
  view.setUint8(12, fmt[0]);
  view.setUint8(13, fmt[1]);
  view.setUint8(14, fmt[2]);
  view.setUint8(15, fmt[3]);
  view.setUint32(16, 16, true);                 // Subchunk1Size (PCM)
  view.setUint16(20, 1, true);                  // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);        // NumChannels
  view.setUint32(24, sampleRate, true);         // SampleRate
  view.setUint32(28, byteRate, true);           // ByteRate
  view.setUint16(32, blockAlign, true);         // BlockAlign
  view.setUint16(34, bitsPerSample, true);      // BitsPerSample
  view.setUint8(36, data[0]);
  view.setUint8(37, data[1]);
  view.setUint8(38, data[2]);
  view.setUint8(39, data[3]);
  view.setUint32(40, dataLength, true);         // Subchunk2Size

  return buffer;
}

function convertToWav(rawData: string[], mimeType: string): ArrayBuffer {
  const options = parseMimeType(mimeType);
  const dataLength = rawData.reduce((a, b) => a + atob(b).length, 0);
  const wavHeader = createWavHeader(dataLength, options);
  
  const buffers = rawData.map(data => {
    const binaryString = atob(data);
    const buffer = new ArrayBuffer(binaryString.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binaryString.length; i++) {
      view[i] = binaryString.charCodeAt(i);
    }
    return buffer;
  });
  
  const totalLength = wavHeader.byteLength + buffers.reduce((a, b) => a + b.byteLength, 0);
  const result = new ArrayBuffer(totalLength);
  const resultView = new Uint8Array(result);
  
  resultView.set(new Uint8Array(wavHeader), 0);
  let offset = wavHeader.byteLength;
  
  for (const buffer of buffers) {
    resultView.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  
  return result;
}

function arrayBufferToFloat32Array(arrayBuffer: ArrayBuffer, sampleRate: number): Float32Array {
  // Skip WAV header (44 bytes) and convert to Float32Array
  const dataView = new DataView(arrayBuffer, 44);
  const samples = (arrayBuffer.byteLength - 44) / 2; // 16-bit samples
  const float32Array = new Float32Array(samples);
  
  for (let i = 0; i < samples; i++) {
    const sample = dataView.getInt16(i * 2, true); // little-endian
    float32Array[i] = sample / 32768.0;
  }
  
  return float32Array;
}

export class RealtimeAudioPlayer {
    private ai: GoogleGenAI;
    private session?: Session;
    private audioContext?: AudioContext;
    private audioQueue: { text: string, resolve: () => void, reject: (reason?: any) => void }[] = [];
    private isProcessingQueue = false;
    private audioChunks: string[] = [];
    private currentMimeType: string = 'audio/pcm;rate=24000';
    private currentAudioSources: AudioBufferSourceNode[] = [];
    private isStreamingAudio = false;
    private streamingTimeOffset = 0;
    private chunkBuffer: string[] = [];
    private minChunksBeforePlay = 3; // Minimum chunks to buffer before starting playback
    
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

        // Use a shared AudioContext.
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        const config = {
            responseModalities: [Modality.AUDIO],
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
            speechConfig: {
                languageCode: 'en-US',
                voiceConfig: {
                    prebuiltVoiceConfig: {
                        voiceName: 'Puck',
                    }
                }
            },
            contextWindowCompression: {
                triggerTokens: '25600',
                slidingWindow: { targetTokens: '12800' },
            },
            systemInstruction: {
                parts: [{ text: `Repeat everything I say exactly as is` }]
            },
        };

        try {
            this.session = await this.ai.live.connect({
                model: 'models/gemini-2.5-flash-live-preview',
                callbacks: {
                    onmessage: this.handleMessage.bind(this),
                    onerror: (e: ErrorEvent) => console.error('Session Error:', e.message),
                    onclose: (e: CloseEvent) => console.log('Session Closed:', e.reason),
                },
                config
            });
        } catch (error) {
            console.error("Failed to connect to real-time audio service:", error);
            throw error;
        }
    }

    private handleMessage(message: LiveServerMessage): void {
        if (message.serverContent?.modelTurn?.parts) {
            const part = message.serverContent.modelTurn.parts[0];
            if (part?.inlineData?.data) {
                this.audioChunks.push(part.inlineData.data);
                this.chunkBuffer.push(part.inlineData.data);
                
                // Update mime type from the response
                if (part.inlineData.mimeType) {
                    this.currentMimeType = part.inlineData.mimeType;
                }
                
                // Start streaming audio if we have enough chunks buffered
                if (!this.isStreamingAudio && this.chunkBuffer.length >= this.minChunksBeforePlay) {
                    this.startStreamingAudio();
                } else if (this.isStreamingAudio && this.chunkBuffer.length > 0) {
                    // Continue streaming with new chunks
                    this.playNextAudioChunk();
                }
            }
        }

        if (message.serverContent?.turnComplete) {
            this.finishStreaming();
        }
    }

    private startStreamingAudio(): void {
        if (!this.audioContext) return;
        
        this.isStreamingAudio = true;
        this.streamingTimeOffset = this.audioContext.currentTime;
        this.playNextAudioChunk();
    }
    
    private playNextAudioChunk(): void {
        if (this.chunkBuffer.length === 0 || !this.audioContext) return;
        
        try {
            // Take chunks from buffer to play
            const chunksToPlay = this.chunkBuffer.splice(0, Math.min(this.chunkBuffer.length, 2));
            
            if (chunksToPlay.length === 0) return;
            
            // Convert audio chunks to WAV format
            const wavBuffer = convertToWav(chunksToPlay, this.currentMimeType);
            
            // Parse the sample rate from mime type
            const options = parseMimeType(this.currentMimeType);
            const sampleRate = options.sampleRate || 24000;
            
            // Convert WAV buffer to Float32Array
            const audioData = arrayBufferToFloat32Array(wavBuffer, sampleRate);
            
            if (audioData.length === 0) return;
            
            const buffer = this.audioContext.createBuffer(1, audioData.length, sampleRate);
            buffer.getChannelData(0).set(audioData);

            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioContext.destination);
            
            // Schedule audio to play seamlessly
            const startTime = Math.max(this.audioContext.currentTime, this.streamingTimeOffset);
            source.start(startTime);
            
            // Update time offset for next chunk
            this.streamingTimeOffset = startTime + buffer.duration;
            
            // Track this source for cleanup
            this.currentAudioSources.push(source);
            
            source.onended = () => {
                const index = this.currentAudioSources.indexOf(source);
                if (index > -1) {
                    this.currentAudioSources.splice(index, 1);
                }
            };
            
        } catch (error) {
            console.error('Error playing streaming audio chunk:', error);
        }
    }
    
    private finishStreaming(): void {
        // Play any remaining chunks in buffer
        while (this.chunkBuffer.length > 0) {
            this.playNextAudioChunk();
        }
        
        // Wait for all audio to finish before resolving
        const checkAudioFinished = () => {
            if (this.currentAudioSources.length === 0) {
                this.cleanupCurrentStream();
            } else {
                setTimeout(checkAudioFinished, 100);
            }
        };
        
        // Give a small delay to ensure last chunks start playing
        setTimeout(checkAudioFinished, 200);
    }
    
    private cleanupCurrentStream(): void {
        this.isStreamingAudio = false;
        this.streamingTimeOffset = 0;
        this.chunkBuffer = [];
        this.audioChunks = [];
        this.currentAudioSources = [];
        this.finishCurrentQueueItem();
    }
    
    private playAccumulatedAudio(): void {
        // This method is kept for backward compatibility but shouldn't be used
        // in streaming mode. If called, just finish the current item.
        this.finishCurrentQueueItem();
    }
    
    private finishCurrentQueueItem() {
        const currentItem = this.audioQueue.shift();
        if (currentItem) {
            currentItem.resolve();
        }
        this.isProcessingQueue = false;
        this.processQueue();
    }

    public speak(text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.session) {
                return reject(new Error("Session not connected."));
            }
            if (!text || text.trim() === '') {
                return resolve();
            }
            this.audioQueue.push({ text, resolve, reject });
            this.processQueue();
        });
    }

    private processQueue(): void {
        if (this.isProcessingQueue || this.audioQueue.length === 0 || !this.session) {
            return;
        }
        this.isProcessingQueue = true;
        
        const { text } = this.audioQueue[0];
        
        this.session.sendClientContent({
            turns: [text]
        });
    }

    public disconnect(): void {
        // Stop all current audio sources
        this.currentAudioSources.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Ignore errors if already stopped
            }
        });
        this.currentAudioSources = [];
        
        // Reset streaming state
        this.isStreamingAudio = false;
        this.streamingTimeOffset = 0;
        this.chunkBuffer = [];
        this.audioChunks = [];
        
        this.session?.close();
        this.audioContext?.close().catch(console.error);
        this.session = undefined;
        this.audioContext = undefined;
        
        // Reject any pending promises in the queue
        this.audioQueue.forEach(item => item.reject(new Error("Audio player disconnected.")));
        this.audioQueue = [];
        this.isProcessingQueue = false;
    }
}