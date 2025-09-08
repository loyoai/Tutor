import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Header } from './components/Header';
import { TopicInput } from './components/TopicInput';
import { SvgDisplay } from './components/SvgDisplay';
import { RawOutputDisplay } from './components/RawOutputDisplay';
import { generateSvgForTopicStream } from './services/geminiService';

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
            // If icon data is missing (e.g., failed fetch), render a comment
            return `<!-- Lucide icon "${name}" failed to load -->`;
        }

        const sizeNum = parseFloat(size);
        const scale = sizeNum / 24; // Lucide icons are designed on a 24x24 grid

        // Center the icon at (x, y) and scale it appropriately
        const transform = `transform="translate(${x}, ${y}) scale(${scale}) translate(-12, -12)"`;

        return `<g ${transform} stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${iconData}</g>`;
    });
};


const App: React.FC = () => {
  const [topic, setTopic] = useState<string>('');
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [rawSvgContent, setRawSvgContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [limitThinking, setLimitThinking] = useState<boolean>(false);
  const [timer, setTimer] = useState<number>(0);
  const iconCache = useRef<Record<string, string>>({});
  const timerIntervalRef = useRef<number | null>(null);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, []);

  const handleGenerateSvg = useCallback(async () => {
    if (!topic.trim()) {
      setError('Please enter a topic.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSvgContent(null);
    setRawSvgContent('');
    setTimer(0);

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = window.setInterval(() => {
      setTimer(prev => prev + 1);
    }, 1000);
    
    let accumulatedRawContent = '';
    let svgStartIndex = -1;

    try {
      await generateSvgForTopicStream(topic, limitThinking, async (chunk) => {
        // Stop timer on first chunk received
        if (accumulatedRawContent.length === 0 && chunk.length > 0) {
            if (timerIntervalRef.current) {
                clearInterval(timerIntervalRef.current);
                timerIntervalRef.current = null;
            }
        }
        
        accumulatedRawContent += chunk;
        setRawSvgContent(accumulatedRawContent);

        // Only start rendering the SVG once the <svg> tag is found
        if (svgStartIndex === -1) {
            svgStartIndex = accumulatedRawContent.indexOf('<svg');
        }

        if (svgStartIndex !== -1) {
            const currentSvgContent = accumulatedRawContent.substring(svgStartIndex);
            const processedSvg = await processSvgWithDynamicIcons(currentSvgContent, iconCache);
            const cleanedContent = processedSvg
                .replace(/width="960"/, 'width="100%"')
                .replace(/height="600"/, 'height="100%"');
            setSvgContent(cleanedContent);
        }
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate SVG. ${errorMessage}`);
      console.error(err);
    } finally {
        if (timerIntervalRef.current) {
            clearInterval(timerIntervalRef.current);
            timerIntervalRef.current = null;
        }

        const finalSvgStartIndex = accumulatedRawContent.indexOf('<svg');
        if (finalSvgStartIndex !== -1) {
            let finalSvg = accumulatedRawContent.substring(finalSvgStartIndex);
            // Clean up potential trailing markdown code fences
            finalSvg = finalSvg.replace(/```\s*$/, '').trim();

            if (finalSvg) {
                try {
                    const processedSvg = await processSvgWithDynamicIcons(finalSvg, iconCache);
                    const cleanedContent = processedSvg
                        .replace(/width="960"/, 'width="100%"')
                        .replace(/height="600"/, 'height="100%"');
                    setSvgContent(cleanedContent);
                } catch (err) {
                    console.error("Failed to process icons on final pass:", err);
                    setError("Failed to load icons for the SVG. Displaying raw SVG.");
                    setSvgContent(finalSvg); 
                }
            }
        } else if (accumulatedRawContent && !error) {
            // Handle cases where the model responded but didn't provide a valid SVG.
            setError("The model did not return a valid SVG. Please try a different topic or phrasing.");
        }
        setIsLoading(false);
    }
  }, [topic, limitThinking]);

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
          svgContent={svgContent}
          isLoading={isLoading}
          error={error}
          timer={timer}
        />
        <RawOutputDisplay rawContent={rawSvgContent} />
        <footer className="text-center mt-auto py-4">
            <p className="text-gray-500 text-sm">Powered by Gemini 2.5 Pro</p>
        </footer>
      </div>
    </div>
  );
};

export default App;