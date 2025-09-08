
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Header } from './components/Header';
import { TopicInput } from './components/TopicInput';
import { SvgDisplay } from './components/SvgDisplay';
import { RawOutputDisplay } from './components/RawOutputDisplay';
import { generateSvgForTopicStream } from './services/geminiService';

const PART_SEPARATOR = '---PART_SEPARATOR---';

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
  const [currentStep, setCurrentStep] = useState(0);
  const [processedSvgContent, setProcessedSvgContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [limitThinking, setLimitThinking] = useState<boolean>(false);
  const iconCache = useRef<Record<string, string>>({});

  const handleGenerateSvg = useCallback(async () => {
    if (!topic.trim()) {
      setError('Please enter a topic.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setTutorialParts([]);
    setCurrentStep(0);
    setProcessedSvgContent('');
    
    let accumulatedRawContent = '';

    try {
      await generateSvgForTopicStream(topic, limitThinking, (chunk) => {
        accumulatedRawContent += chunk;
        const parts = accumulatedRawContent.split(PART_SEPARATOR).map(p => p.trim()).filter(Boolean);
        setTutorialParts(parts);
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate SVG. ${errorMessage}`);
      console.error(err);
    } finally {
        setIsLoading(false);
        if (accumulatedRawContent && tutorialParts.length === 0 && !error) {
             const parts = accumulatedRawContent.split(PART_SEPARATOR).map(p => p.trim()).filter(Boolean);
             if (parts.length > 0) {
                setTutorialParts(parts);
             } else {
                setError("The model did not return a valid tutorial format. Please try again.");
             }
        }
    }
  }, [topic, limitThinking]);

  const { currentExplanation, accumulatedSvg } = useMemo(() => {
    let explanation: string | null = null;
    const svgSnippets: string[] = [];

    for (let i = 0; i <= currentStep && i < tutorialParts.length; i++) {
        const part = tutorialParts[i];
        if (part.trim().startsWith('<')) {
            svgSnippets.push(part);
        } else {
            explanation = part;
        }
    }
    
    let combined = '';
    if (svgSnippets.length > 0) {
        combined = svgSnippets[0];
        for (let i = 1; i < svgSnippets.length; i++) {
            combined = combined.replace(/<\/svg>\s*$/, `${svgSnippets[i]}</svg>`);
        }
    }

    return { currentExplanation: explanation, accumulatedSvg: combined };
  }, [tutorialParts, currentStep]);

  useEffect(() => {
    if (accumulatedSvg) {
        processSvgWithDynamicIcons(accumulatedSvg, iconCache).then(processed => {
            const cleaned = processed
                .replace(/width="960"/, 'width="100%"')
                .replace(/height="600"/, 'height="100%"');
            setProcessedSvgContent(cleaned);
        });
    } else {
        setProcessedSvgContent('');
    }
  }, [accumulatedSvg]);
  
  const handleNext = () => {
      if (currentStep < tutorialParts.length - 1) {
          setCurrentStep(prev => prev + 1);
      }
  };

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
          explanation={currentExplanation}
          onNext={handleNext}
          isLastStep={currentStep >= tutorialParts.length - 1}
          hasStarted={tutorialParts.length > 0}
        />
        <RawOutputDisplay tutorialParts={tutorialParts} />
        <footer className="text-center mt-auto py-4">
            <p className="text-gray-500 text-sm">Powered by Gemini 2.5 Pro</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
