import {
  GoogleGenAI,
  LiveServerMessage,
  MediaResolution,
  Modality,
  Session,
} from '@google/genai';

// Debug logging helpers for live audio pipeline
const LIVE_DEBUG = false;
const ts = () => new Date().toISOString();
const log = (...args: any[]) => { if (LIVE_DEBUG) console.log('[LiveAudio]', ts(), ...args); };
const warn = (...args: any[]) => { if (LIVE_DEBUG) console.warn('[LiveAudio]', ts(), ...args); };
const errorLog = (...args: any[]) => { if (LIVE_DEBUG) console.error('[LiveAudio]', ts(), ...args); };

/**
 * Decodes a base64 string into a Uint8Array, then converts the resulting
 * 16-bit PCM audio data into a Float32Array for the Web Audio API.
 */
function pcm16bitToFloat32(base64String: string): Float32Array {
    try {
        const inLen = base64String?.length ?? 0;
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
        
        log('pcm16->f32 decoded', { base64Len: inLen, bytes: len, samples: float32Array.length });
        return float32Array;
    } catch (e) {
        errorLog('Error decoding audio data:', e);
        return new Float32Array(0);
    }
}

function parseMimeType(mimeType: string): { sampleRate?: number; numChannels?: number; bitsPerSample?: number } {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options: any = {
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

  return options;
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
  scheduledChunkCount: number; // how many chunks have been scheduled
  endedChunkCount: number;     // how many scheduled chunks finished
  isComplete: boolean;
  nextStartAt?: number;        // absolute AudioContext time for next chunk
  finishTimer?: number;        // timeout id for idle-finish checks
  lastChunkTs?: number;        // ms timestamp of last received audio chunk
  onStart?: () => void;        // callback when first audio chunk schedules
  hasStarted?: boolean;        // internal flag to ensure onStart fires once
}

export class GeminiLiveAudioService {
    private ai: GoogleGenAI;
    private session?: Session;
    private audioContext?: AudioContext;
    private outputNode?: AudioNode;
    // removed responseQueue; we process messages directly
    private speechQueue: QueuedSpeechRequest[] = [];
    private isProcessingQueue = false;
    private isSessionWarmedUp = false;
    private chunkCounter = 0;
    // Gapless scheduling state
    private playbackCursor = 0; // next scheduled start time in AudioContext time
    private readonly scheduleAheadSec = 0.5; // how far ahead to keep the buffer filled
    private readonly idleFinishMs = 200; // shorter grace after last chunk for snappier handoff
    
    constructor() {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable is not set.");
        }
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        log('Service constructed');
    }

    // Finish when: turnComplete received AND no new chunks arrive for a short window AND
    // all scheduled chunks have ended. This avoids cutting off late-arriving chunks.
    private ensureFinishAfterIdle(request: QueuedSpeechRequest): void {
        const idleMs = this.idleFinishMs;
        if (request.finishTimer) {
            clearTimeout(request.finishTimer);
        }
        request.finishTimer = window.setTimeout(() => {
            // Try to schedule any new chunks that may have arrived
            this.scheduleNewChunks(request);

            const now = Date.now();
            const lastTs = request.lastChunkTs ?? 0;
            const idleLongEnough = now - lastTs >= idleMs;
            const allScheduled = request.scheduledChunkCount >= request.audioChunks.length;
            const allEnded = request.endedChunkCount >= request.scheduledChunkCount && request.scheduledChunkCount > 0;
            const totalReceived = request.audioChunks.length;
            const haveEnoughChunks = totalReceived > 0;

            log('finish-check', {
              idleMs,
              now,
              lastTs,
              idleLongEnough,
              totalReceived,
              scheduled: request.scheduledChunkCount,
              ended: request.endedChunkCount,
              allScheduled,
              allEnded,
              haveEnoughChunks,
              textPreview: request.text?.slice(0, 100) || ''
            });

            // Re-check again if anything is still outstanding or new chunks are still arriving
            if (!(request.isComplete && idleLongEnough && allScheduled && allEnded && haveEnoughChunks)) {
                this.ensureFinishAfterIdle(request);
                return;
            }
            this.finishCurrentSpeechRequest();
        }, idleMs);
    }

    public async connect(): Promise<void> {
        if (this.session) {
            console.warn("Session already connected.");
            return;
        }

        // Initialize audio context for browser environment
        if (typeof window !== 'undefined') {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            log('AudioContext created', { sampleRate: this.audioContext.sampleRate });

            // Build a light output chain to improve clarity and reduce rumble
            // source -> highpass -> compressor -> gain -> destination
            const ctx = this.audioContext;
            const highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 90; // cut sub‑bass/rumble
            highpass.Q.value = 0.707;

            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 30;
            compressor.ratio.value = 6;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;

            const gain = ctx.createGain();
            gain.gain.value = 0.9; // slight headroom

            highpass.connect(compressor);
            compressor.connect(gain);
            gain.connect(ctx.destination);
            this.outputNode = highpass; // connect sources to this node
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
            log('Connecting live session ...');
            this.session = await this.ai.live.connect({
                model: 'gemini-live-2.5-flash-preview',
                callbacks: {
                    onopen: () => {
                        log('Session opened');
                        this.isSessionWarmedUp = true;
                    },
                    onmessage: this.handleMessage.bind(this),
                    onerror: (e: ErrorEvent) => errorLog('Session Error:', e.message),
                    onclose: (e: CloseEvent) => {
                        log('Session closed', { reason: e.reason });
                        this.isSessionWarmedUp = false;
                    },
                },
                config
            });
            log('Live connect OK');
        } catch (error) {
            errorLog('Failed to connect to live audio service:', error);
            throw error;
        }
    }

    private handleMessage(message: LiveServerMessage): void {
        log('onmessage', {
          hasServerContent: !!message.serverContent,
          turnComplete: !!message.serverContent?.turnComplete,
          parts: message.serverContent?.modelTurn?.parts?.length || 0
        });
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
                currentRequest.lastChunkTs = Date.now();
                log('chunk-received', {
                  idx: audioChunk.chunkIndex,
                  mime: audioChunk.mimeType,
                  base64Len: audioChunk.data.length,
                  totalReceived: currentRequest.audioChunks.length,
                  scheduled: currentRequest.scheduledChunkCount,
                  ended: currentRequest.endedChunkCount
                });
                
                // Start or schedule this chunk immediately
                if (!currentRequest.isPlaying) {
                    log('startPlayingChunks trigger');
                    this.startPlayingChunks(currentRequest);
                }
                this.scheduleNewChunks(currentRequest);

                // If a finish timer was pending, push it out since new data arrived
                if (currentRequest.finishTimer) {
                    clearTimeout(currentRequest.finishTimer);
                    currentRequest.finishTimer = undefined;
                }
            }
        }

        if (message.serverContent?.turnComplete) {
            currentRequest.isComplete = true;
            log('turnComplete received', {
              totalReceived: currentRequest.audioChunks.length,
              scheduled: currentRequest.scheduledChunkCount,
              ended: currentRequest.endedChunkCount
            });
            // Defer finish slightly to allow any last chunks to arrive
            this.ensureFinishAfterIdle(currentRequest);
        }
    }

    private startPlayingChunks(request: QueuedSpeechRequest): void {
        request.isPlaying = true;
        request.scheduledChunkCount = 0;
        request.endedChunkCount = 0;
        request.hasStarted = false;
        if (this.audioContext) {
            // Prime cursor slightly in the future to avoid immediate underrun
            const now = this.audioContext.currentTime;
            request.nextStartAt = now + 0.08;
            // Ensure context is running to avoid start latency on some browsers
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(() => {});
            }
        }
        log('startPlayingChunks', { nextStartAt: request.nextStartAt });
        this.scheduleNewChunks(request);
    }

    // Schedule any unscheduled chunks in the request
    private scheduleNewChunks(request: QueuedSpeechRequest): void {
        if (!this.audioContext) {
            warn('Audio context not available');
            this.finishCurrentSpeechRequest();
            return;
        }

        const ctx = this.audioContext;
        while (request.scheduledChunkCount < request.audioChunks.length) {
            const chunk = request.audioChunks[request.scheduledChunkCount];
            try {
                const audioData = pcm16bitToFloat32(chunk.data);
                if (audioData.length === 0) {
                    warn('empty audio data; skipping', { index: request.scheduledChunkCount });
                    request.scheduledChunkCount++;
                    continue;
                }

                let sampleRate = 24000;
                try {
                    const parsed = parseMimeType(chunk.mimeType || 'audio/pcm;rate=24000');
                    sampleRate = parsed.sampleRate || 24000;
                } catch {}
                const buffer = ctx.createBuffer(1, audioData.length, sampleRate);
                buffer.getChannelData(0).set(audioData);

                const source = ctx.createBufferSource();
                source.buffer = buffer;
                (this.outputNode || ctx.destination) && source.connect(this.outputNode || ctx.destination);

                const startAt = Math.max(request.nextStartAt ?? ctx.currentTime + 0.01, ctx.currentTime + 0.005);
                // Fire onStart exactly once when the first chunk schedules
                if (!request.hasStarted) {
                    request.hasStarted = true;
                    try { request.onStart && request.onStart(); } catch {}
                }
                source.start(startAt);
                request.nextStartAt = startAt + buffer.duration;
                log('chunk-scheduled', {
                  index: request.scheduledChunkCount,
                  sampleRate,
                  duration: buffer.duration,
                  startAt,
                  nextStartAt: request.nextStartAt,
                  totalReceived: request.audioChunks.length
                });

                source.onended = () => {
                    request.endedChunkCount++;
                    log('chunk-ended', { ended: request.endedChunkCount, scheduled: request.scheduledChunkCount });
                    // When a chunk ends, see if we can finish (after idle grace)
                    if (request.isComplete) this.ensureFinishAfterIdle(request);
                };
                (source as any).onerror = (e: any) => {
                    errorLog('AudioBufferSourceNode error:', e);
                    request.endedChunkCount++;
                    if (request.isComplete) this.ensureFinishAfterIdle(request);
                };

                request.scheduledChunkCount++;
            } catch (error) {
                errorLog('Error scheduling audio chunk:', error);
                request.scheduledChunkCount++;
            }
        }
    }


    private finishCurrentSpeechRequest(): void {
        const currentRequest = this.speechQueue.shift();
        if (currentRequest) {
            currentRequest.resolve();
        }
        log('finishCurrentSpeechRequest', { queueLen: this.speechQueue.length });
        this.isProcessingQueue = false;
        this.processQueue();
    }

    public async warmUpSession(): Promise<void> {
        if (!this.isSessionWarmedUp && !this.session) {
            await this.connect();
        }
    }

    public speak(text: string, opts?: { onAudioStart?: () => void }): Promise<void> {
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
                scheduledChunkCount: 0,
                endedChunkCount: 0,
                isComplete: false,
                onStart: opts?.onAudioStart
            };
            
            log('enqueue speak', {
              textLen: text.length,
              words: text.trim().split(/\s+/).length,
              queueLenBefore: this.speechQueue.length,
              preview: text.slice(0, 100)
            });
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
            log('sendClientContent', { textLen: request.text.length, preview: request.text.slice(0, 100) });
            this.session.sendClientContent({
                turns: [
                    {
                        role: 'user',
                        parts: [{ text: request.text }],
                    },
                ],
                turnComplete: true,
            });
        } catch (error) {
            errorLog('Error sending content to session:', error);
            const failedRequest = this.speechQueue.shift();
            if (failedRequest) {
                failedRequest.reject(error);
            }
            this.isProcessingQueue = false;
            this.processQueue();
        }
    }

    public disconnect(): void {
        log('disconnect called');
        this.session?.close();
        this.audioContext?.close().catch(console.error);
        this.session = undefined;
        this.audioContext = undefined;
        this.outputNode = undefined;
        this.isSessionWarmedUp = false;
        this.playbackCursor = 0;
        
        // Reject any pending promises in the queue
        this.speechQueue.forEach(request => 
            request.reject(new Error("Audio service disconnected."))
        );
        this.speechQueue = [];
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
