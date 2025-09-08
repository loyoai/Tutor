import { GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';

/**
 * Decodes a base64 string into a Uint8Array, then converts the resulting
 * 16-bit PCM audio data into a Float32Array for the Web Audio API.
 * @param base64String The base64 encoded audio data.
 * @returns A Float32Array suitable for an AudioBuffer.
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

export class RealtimeAudioPlayer {
    private ai: GoogleGenAI;
    private session?: Session;
    private audioContext?: AudioContext;
    private audioQueue: { text: string, resolve: () => void, reject: (reason?: any) => void }[] = [];
    private isProcessingQueue = false;
    private audioChunks: string[] = [];
    
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
            systemInstruction: {
                parts: [{ text: `Repeat everything I say exactly as is` }]
            },
        };

        try {
            this.session = await this.ai.live.connect({
                model: 'gemini-2.5-flash-preview-native-audio-dialog',
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
            }
        }

        if (message.serverContent?.turnComplete) {
            this.playAccumulatedAudio();
        }
    }

    private playAccumulatedAudio(): void {
        if (this.audioChunks.length === 0 || !this.audioContext) {
            this.finishCurrentQueueItem();
            return;
        }

        const fullBase64 = this.audioChunks.join('');
        this.audioChunks = []; // Clear for next turn

        const audioData = pcm16bitToFloat32(fullBase64);
        if (audioData.length === 0) {
            this.finishCurrentQueueItem();
            return;
        }
        
        const sampleRate = 24000; // Expected from gemini-2.5-flash-preview-native-audio-dialog
        const buffer = this.audioContext.createBuffer(1, audioData.length, sampleRate);
        buffer.getChannelData(0).set(audioData);

        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioContext.destination);
        source.onended = () => {
            this.finishCurrentQueueItem();
        };
        source.start(0);
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
        this.session?.close();
        this.audioContext?.close().catch(console.error); // Close context and ignore errors if already closed
        this.session = undefined;
        this.audioContext = undefined;
        // Reject any pending promises in the queue
        this.audioQueue.forEach(item => item.reject(new Error("Audio player disconnected.")));
        this.audioQueue = [];
        this.isProcessingQueue = false;
    }
}