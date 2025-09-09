import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { TopicInput } from './components/TopicInput';
import { SvgDisplay } from './components/SvgDisplay';
import { RawOutputDisplay } from './components/RawOutputDisplay';
import { generateSvgForTopicStream } from './services/geminiService';
import { GeminiLiveAudioService } from './services/geminiLiveAudioService';

const PART_SEPARATOR = '---PART_SEPARATOR---';

// Debug logging helpers for playback flow
const APP_DEBUG = true;
const ats = () => new Date().toISOString();
const alog = (...args: any[]) => { if (APP_DEBUG) console.log('[App]', ats(), ...args); };
const awarn = (...args: any[]) => { if (APP_DEBUG) console.warn('[App]', ats(), ...args); };
const aerr = (...args: any[]) => { if (APP_DEBUG) console.error('[App]', ats(), ...args); };

/**
 * Fetches icon data, caches it, and replaces <lucide-icon> tags with SVG content.
 * @param svgString The raw SVG string from the AI.
 * @param cache A React ref object to cache fetched icon data.
 * @returns A promise that resolves to the processed SVG string.
 */
const processSvgWithDynamicIcons = async (
    svgString: string,
    cache: React.MutableRefObject<Record<string, string>>
): Promise<string> => {
    // Regex to find all lucide-icon tags and extract their names
    const iconNameRegex = /<lucide-icon\s+name="([^"]+)"[^>]*\/?>/g;
    const matches = [...svgString.matchAll(iconNameRegex)];
    const uniqueIconNames = [...new Set(matches.map(match => match[1]))];

    // Determine which icons we haven't fetched yet
    const iconsToFetch = uniqueIconNames.filter(name => !cache.current[name]);

    if (iconsToFetch.length > 0) {
        const fetchPromises = iconsToFetch.map(async name => {
            try {
                const response = await fetch(`https://unpkg.com/lucide-static@latest/icons/${name}.svg`);
                if (!response.ok) throw new Error(`Icon "${name}" could not be fetched.`);
                const svgText = await response.text();
                // Extract the inner content (<path>, <circle>, etc.) from the full SVG file
                const innerContent = svgText.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1] || '';
                return { name, innerContent };
            } catch (error) {
                console.warn(`Failed to load Lucide icon "${name}":`, error);
                return { name, innerContent: null }; // Gracefully fail for individual icons
            }
        });

        const fetchedIcons = await Promise.all(fetchPromises);

        // Add successfully fetched icons to the cache
        for (const { name, innerContent } of fetchedIcons) {
            if (innerContent) {
                cache.current[name] = innerContent;
            }
        }
    }

    // Regex to find full lucide-icon tags to replace them with SVG <g> elements
    const fullIconRegex = /<lucide-icon\s+name="([^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s+size="([^"]+)"\s+color="([^"]+)"\s*\/>/g;

    return svgString.replace(fullIconRegex, (match, name, x, y, size, color) => {
        const iconData = cache.current[name];
        if (!iconData) {
            return `<!-- Lucide icon "${name}" failed to load -->`;
        }
        const sizeNum = parseFloat(size);
        const scale = sizeNum / 24;
        const transform = `transform="translate(${x}, ${y}) scale(${scale}) translate(-12, -12)"`;
        return `<g ${transform} stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${iconData}</g>`;
    });
};


const App: React.FC = () => {
  const [topic, setTopic] = useState<string>('');
  const [tutorialParts, setTutorialParts] = useState<string[]>([]);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [processedSvgContent, setProcessedSvgContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [limitThinking, setLimitThinking] = useState<boolean>(false);
  const [isStreamingContent, setIsStreamingContent] = useState<boolean>(false);
  const iconCache = useRef<Record<string, string>>({});
  const audioPlayer = useRef<GeminiLiveAudioService | null>(null);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
        isMounted.current = false;
        audioPlayer.current?.disconnect();
    };
  }, []);

  const handleGenerateSvg = useCallback(async () => {
    if (!topic.trim()) {
      setError('Please enter a topic.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTutorialParts([]);
    setPlaybackIndex(0);
    setIsSpeaking(false);
    setProcessedSvgContent('');
    alog('Generate clicked', { topicLen: topic.length, limitThinking });
    
    audioPlayer.current?.disconnect();
    audioPlayer.current = new GeminiLiveAudioService();
    
    // Pre-warm the audio service while Gemini is thinking
    try {
        alog('Pre-warming audio service...');
        await audioPlayer.current.preWarmForQuestion();
        alog('Pre-warm done');
    } catch (err) {
        awarn('Pre-warming audio service failed:', err);
    }
    
    try {
        alog('Connecting live audio...');
        await audioPlayer.current.connect();
        alog('Connected live audio');
    } catch (err) {
        setError("Failed to connect to the audio service. Please check your API key and network connection.");
        setIsLoading(false);
        return;
    }

    let accumulatedRawContent = '';
    setIsStreamingContent(true);
    
    try {
      await generateSvgForTopicStream(topic, limitThinking, (chunk) => {
        accumulatedRawContent += chunk;
        const parts = accumulatedRawContent.split(PART_SEPARATOR).map(p => p.trim()).filter(Boolean);
        alog('stream chunk', { chunkLen: chunk.length, partsCount: parts.length });
        setTutorialParts(parts);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate SVG. ${errorMessage}`);
      aerr('generateSvgForTopicStream error', err);
    } finally {
        setIsLoading(false);
        setIsStreamingContent(false);
        if (accumulatedRawContent && tutorialParts.length === 0 && !error) {
             const parts = accumulatedRawContent.split(PART_SEPARATOR).map(p => p.trim()).filter(Boolean);
             if (parts.length > 0) {
                alog('finalize parts after stream', { parts: parts.length });
                setTutorialParts(parts);
             } else {
                setError("The model did not return a valid tutorial format. Please try again.");
             }
        }
    }
  }, [topic, limitThinking]);

  const accumulatedSvg = useMemo(() => {
    const svgSnippets: string[] = [];
    // Accumulate all SVG parts up to the current playback index
    for (let i = 0; i < playbackIndex && i < tutorialParts.length; i++) {
        const part = tutorialParts[i];
        if (part.trim().startsWith('<')) {
            svgSnippets.push(part);
        }
    }
    
    let combined = '';
    if (svgSnippets.length > 0) {
        combined = svgSnippets[0];
        for (let i = 1; i < svgSnippets.length; i++) {
            combined = combined.replace(/<\/svg>\s*$/, `${svgSnippets[i]}</svg>`);
        }
    }

    return combined;
  }, [tutorialParts, playbackIndex]);

  // Main effect to drive the automated tutorial playback
  useEffect(() => {
    // Start processing as soon as we have parts, don't wait for streaming to complete
    if (error || isSpeaking || playbackIndex >= tutorialParts.length) {
        if (APP_DEBUG) {
            alog('playback guard', {
                error: !!error,
                isSpeaking,
                playbackIndex,
                parts: tutorialParts.length,
                isStreamingContent
            });
        }
        return;
    }
    
    // If we're still streaming and don't have the next part yet, wait
    if (isStreamingContent && playbackIndex >= tutorialParts.length) {
        return;
    }

    const currentPart = tutorialParts[playbackIndex];
    if (!currentPart) return;
    
    const isSvgPart = currentPart.trim().startsWith('<');
    // Do not speak a text part until it's sealed by the next PART_SEPARATOR
    // i.e., until the next part exists or streaming is finished.
    if (!isSvgPart) {
        const isSealed = (playbackIndex < tutorialParts.length - 1) || !isStreamingContent;
        if (!isSealed) {
            alog('waiting for sealed text part', { index: playbackIndex, parts: tutorialParts.length });
            return;
        }
    }
    alog('process part', { index: playbackIndex, isSvgPart, preview: currentPart.slice(0, 80) });

    const processPart = async () => {
        if (!isMounted.current) return;

        if (isSvgPart) {
            alog('advance on SVG part', { index: playbackIndex });
            setPlaybackIndex(prev => prev + 1);
        } else {
            setIsSpeaking(true);
            try {
                alog('speak start', { index: playbackIndex, len: currentPart.length });
                await audioPlayer.current?.speak(currentPart);
                alog('speak done', { index: playbackIndex });
            } catch (e) {
                aerr('Error speaking text', e);
                // Optionally set an error state here or just continue
            } finally {
                if (isMounted.current) {
                    setIsSpeaking(false);
                    setPlaybackIndex(prev => prev + 1);
                    alog('advance after speak', { nextIndex: playbackIndex + 1 });
                }
            }
        }
    };
    
    processPart();

  }, [tutorialParts, playbackIndex, error, isSpeaking, isStreamingContent]);

  useEffect(() => {
    if (accumulatedSvg) {
        alog('process SVG combine', { playbackIndex, parts: tutorialParts.length });
        processSvgWithDynamicIcons(accumulatedSvg, iconCache).then(processed => {
            const cleaned = processed
                .replace(/width="960"/, 'width="100%"')
                .replace(/height="600"/, 'height="100%"');
            setProcessedSvgContent(cleaned);
            alog('svg processed');
        });
    } else {
        setProcessedSvgContent('');
    }
  }, [accumulatedSvg]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
      <div className="w-full max-w-5xl flex flex-col items-center gap-8">
        <Header />
        <TopicInput
          topic={topic}
          setTopic={setTopic}
          onSubmit={handleGenerateSvg}
          isLoading={isLoading}
          limitThinking={limitThinking}
          setLimitThinking={setLimitThinking}
        />
        <SvgDisplay
          svgContent={processedSvgContent}
          isLoading={isLoading}
          error={error}
          hasStarted={tutorialParts.length > 0}
          isSpeaking={isSpeaking}
        />
        <RawOutputDisplay tutorialParts={tutorialParts} />
        <footer className="text-center mt-auto py-4">
            <p className="text-gray-500 text-sm">Powered by Gemini 2.5 Flash</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
