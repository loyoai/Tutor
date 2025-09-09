// Deprecated: this file now delegates to the working GeminiLiveAudioService
// to avoid duplicate/experimental logic paths.
import { GeminiLiveAudioService } from './geminiLiveAudioService';

export class RealtimeAudioPlayer {
  private inner: GeminiLiveAudioService;

  constructor() {
    this.inner = new GeminiLiveAudioService();
  }

  async connect(): Promise<void> { return this.inner.connect(); }
  async warmUpSession(): Promise<void> { return this.inner.warmUpSession(); }
  async preWarmForQuestion(): Promise<void> { return this.inner.preWarmForQuestion(); }
  speak(text: string): Promise<void> { return this.inner.speak(text); }
  disconnect(): void { this.inner.disconnect(); }
}
