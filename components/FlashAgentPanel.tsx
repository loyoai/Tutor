import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlashEvent, FlashTutorService, FlashToolName } from '@/services/flashTutorService';
import { GeminiLiveAudioService } from '@/services/geminiLiveAudioService';

type LessonPayload = {
  concept: string;
  userLevel?: string;
  examples?: string[];
  connectionToPriorKnowledge?: string;
};

interface FlashAgentPanelProps {
  service: FlashTutorService;
  onStartLesson: (payload: LessonPayload) => void;
  lessonCompletedTick: number; // increment this when the right-side lesson completes
  initialGoal?: string; // when provided, auto-start with this goal
  tts: GeminiLiveAudioService; // shared TTS instance (single session)
}

export const FlashAgentPanel: React.FC<FlashAgentPanelProps> = ({ service, onStartLesson, lessonCompletedTick, initialGoal, tts }) => {
  const [goal, setGoal] = useState('');
  const [started, setStarted] = useState(false);
  const [currentEvent, setCurrentEvent] = useState<FlashEvent | null>(null);
  const [assistantLine, setAssistantLine] = useState<string>('');
  const [inputValue, setInputValue] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [pendingPreface, setPendingPreface] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);

  // Speak helper
  const speak = async (text: string) => {
    if (!text) return;
    try {
      await tts.preWarmForQuestion();
      await tts.connect();
      setIsSpeaking(true);
      await tts.speak(text, { onAudioStart: () => { setAssistantLine(text); setControlsVisible(true); } });
    } catch (_) {
      // Fallback to on-screen text if audio fails
      setAssistantLine(text);
      setControlsVisible(true);
    } finally {
      setIsSpeaking(false);
    }
  };

  const handleEvent = async (ev: FlashEvent) => {
    console.log('[FlashPanel] event', ev);
    setCurrentEvent(ev);
    // Compose an utterance for the transcript based on event type
    let textToShow = '';
    const preface = ev.preface && ev.preface.trim() ? ev.preface.trim() : '';
    if (ev.type === 'openQuestion') {
      // Always show a short line before the input
      textToShow = preface || (initialGoal && initialGoal.trim() ? `Let's begin. What comes to mind about ${initialGoal.trim()}?` : `Let's begin. What comes to mind?`);
    } else if (ev.type === 'multipleChoice') {
      const opts = (ev.choices || []).map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('  ');
      textToShow = `Choose the best answer about ${ev.topic}.  ${opts}`;
      if (preface) setPendingPreface(preface);
    } else if (ev.type === 'trueFalse') {
      // Always show a short line before the buttons
      textToShow = preface || (initialGoal && initialGoal.trim() ? `Quick check: true or false about ${initialGoal.trim()}?` : 'Quick check: true or false?');
    } else if (ev.type === 'detailedLesson') {
      textToShow = `Great. I will prepare a focused lesson on ${ev.concept}.`;
    }
    if (textToShow && ev.type !== 'detailedLesson') {
      // Do not show text yet; only when audio starts in speak()
      setAssistantLine('');
      setControlsVisible(false);
      const toSpeak = pendingPreface ? `${pendingPreface} ${textToShow}` : textToShow;
      if (pendingPreface) setPendingPreface(null);
      speak(toSpeak);
    } else if (!textToShow && ev.type !== 'detailedLesson') {
      // If we have a preface, speak it; otherwise just show controls
      const pre = pendingPreface;
      console.log('[FlashPanel] no question text; preface=', pre);
      if (pre && pre.trim()) {
        setAssistantLine('');
        setControlsVisible(false);
        setPendingPreface(null);
        speak(pre.trim());
      } else {
        console.log('[FlashPanel] showing controls without preface');
        setAssistantLine('');
        setControlsVisible(true);
      }
    }
    if (ev.type === 'detailedLesson') {
      if (textToShow) setPendingPreface(textToShow);
      onStartLesson({
        concept: ev.concept,
        userLevel: ev.userLevel,
        examples: ev.examples,
        connectionToPriorKnowledge: ev.connectionToPriorKnowledge,
      });
    }
  };

  const startSession = async () => {
    if (!goal.trim()) return;
    setStarted(true);
    setAssistantLine('');
    await service.start(goal, handleEvent);
  };

  // Auto-start when initialGoal arrives, but only once
  const hasAutoStarted = useRef(false);
  useEffect(() => {
    if (!hasAutoStarted.current && initialGoal && initialGoal.trim()) {
      hasAutoStarted.current = true;
      setGoal(initialGoal);
      (async () => {
        setStarted(true);
        setAssistantLine('');
        await service.start(initialGoal, handleEvent);
      })();
    }
  }, [initialGoal]);

  // After the right-side lesson completes, notify the model so it can continue
  useEffect(() => {
    if (!started) return;
    if (!currentEvent) return;
    if (currentEvent.type !== 'detailedLesson') return;
    // Notify completion
    (async () => {
      try {
        await service.submitToolResult('giveDetailedLesson', { status: 'completed' });
      } catch (_) {
        // In case of a hiccup, leave controls hidden and wait for next turn
      }
    })();
  }, [lessonCompletedTick]);

  const submitAnswer = async (fn: FlashToolName, response: unknown) => {
    // Clear previous text and do not echo user input
    setAssistantLine('');
    setControlsVisible(false);
    await service.submitToolResult(fn, response);
    setInputValue('');
    setSelectedOption(null);
  };

  // Render controls based on current event
  const controls = useMemo(() => {
    if (!started) return null;
    if (!currentEvent) return null;
    if (currentEvent.type === 'detailedLesson') {
      return (
        <div className="text-sm text-gray-600 dark:text-gray-400">Generating lesson… We’ll continue after it finishes.</div>
      );
    }
    if (!controlsVisible) return null;
    if (currentEvent.type === 'openQuestion') {
      return (
        <div className="mt-4">
          <textarea
            rows={3}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your thoughts…"
            className="w-full rounded-xl border border-gray-200 p-3 focus:outline-none focus:ring-2 focus:ring-black dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:ring-white"
          />
          <button
            onClick={() => submitAnswer('askOpenEndedQuestion', { answer: inputValue })}
            disabled={!inputValue.trim()}
            className="mt-2 px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            Submit
          </button>
        </div>
      );
    }
    if (currentEvent.type === 'multipleChoice') {
      return (
        <div className="mt-4">
          <div className="flex flex-col gap-2">
            {(currentEvent.choices || []).map((opt, i) => (
              <label key={i} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="mcq"
                  checked={selectedOption === opt}
                  onChange={() => { setSelectedOption(opt); submitAnswer('askMultipleChoiceQuestion', { selected: opt }); }}
                  className="h-4 w-4"
                />
                <span className="text-sm dark:text-gray-200">{opt}</span>
              </label>
            ))}
          </div>
        </div>
      );
    }
    if (currentEvent.type === 'trueFalse') {
      return (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => submitAnswer('askTrueFalseQuestion', { answer: true })}
            className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            True
          </button>
          <button
            onClick={() => submitAnswer('askTrueFalseQuestion', { answer: false })}
            className="px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            False
          </button>
        </div>
      );
    }
    
    return null;
  }, [started, currentEvent, inputValue, selectedOption, controlsVisible]);

  return (
    <div className="h-full flex flex-col">
      {/* Transcript area (no card styling per request) */}
      <div className="flex-1 overflow-y-auto">
        {started ? (
          <div>
            {assistantLine && (
              <div className="text-lg">{assistantLine}</div>
            )}
            {controls}
          </div>
        ) : null}
      </div>
    </div>
  );
};
