import React from 'react';

interface TopicInputProps {
  /** Current input value; prompt or RAW LLM text depending on mode. */
  topic: string;
  /** Updates the input value. */
  setTopic: (topic: string) => void;
  /** Submit handler for the current mode. */
  onSubmit: () => void;
  /** Disable input/submit when true. */
  isLoading: boolean;
  /** Controls Gemini thinking budget (prompt mode only). */
  limitThinking: boolean;
  /** Updates the thinking limit (prompt mode only). */
  setLimitThinking: (limit: boolean) => void;
  /** Optional submit button label. */
  buttonLabel?: string;
  /** Whether to show the thinking limit toggle. */
  showLimitThinking?: boolean;
  /** Input mode: 'prompt' to call Gemini, 'raw' to process text directly. */
  mode: 'prompt' | 'raw';
  /** Update the input mode. */
  setMode: (mode: 'prompt' | 'raw') => void;
}

export const TopicInput: React.FC<TopicInputProps> = ({ topic, setTopic, onSubmit, isLoading, limitThinking, setLimitThinking, buttonLabel, showLimitThinking = true, mode, setMode }) => {
  
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isLoading) {
      event.preventDefault();
      onSubmit();
    }
  };
  
  const placeholder = mode === 'prompt'
    ? 'What do you want to build?'
    : 'Paste RAW LLM text here (use ---PART_SEPARATOR--- between parts)';
  
  return (
    <div className="w-full flex flex-col items-stretch gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="inline-flex rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm dark:bg-gray-900 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setMode('prompt')}
            disabled={isLoading}
            className={`px-3 py-1.5 text-sm ${mode === 'prompt' ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
            aria-pressed={mode === 'prompt'}
          >
            Prompt
          </button>
          <button
            type="button"
            onClick={() => setMode('raw')}
            disabled={isLoading}
            className={`px-3 py-1.5 text-sm ${mode === 'raw' ? 'bg-gray-900 text-white dark:bg-white dark:text-black' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'}`}
            aria-pressed={mode === 'raw'}
          >
            RAW LLM
          </button>
        </div>
      </div>
      <div className="relative">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={4}
          className="w-full pr-12 pl-4 py-4 min-h-[140px] bg-white border border-gray-200 rounded-3xl focus:ring-2 focus:ring-black focus:outline-none transition duration-200 text-base text-gray-900 placeholder-gray-500 shadow-sm resize-none dark:bg-gray-900 dark:border-gray-700 dark:text-gray-100 dark:placeholder-gray-400 dark:focus:ring-white"
          disabled={isLoading}
        />
        <button
          type="button"
          aria-label={buttonLabel || 'Submit'}
          onClick={onSubmit}
          disabled={isLoading}
          className="absolute right-4 bottom-4 h-10 w-10 rounded-full flex items-center justify-center text-gray-600 hover:text-gray-800 hover:bg-gray-100 disabled:text-gray-400 dark:text-gray-300 dark:hover:text-white dark:hover:bg-gray-800"
        >
          {isLoading ? (
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            // Mic icon
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
              <path fillRule="evenodd" d="M5 11a1 1 0 112 0 5 5 0 0010 0 1 1 0 112 0 7 7 0 01-6 6.93V21a1 1 0 11-2 0v-3.07A7 7 0 015 11z" clipRule="evenodd" />
            </svg>
          )}
        </button>
      </div>
      {showLimitThinking && (
        <div className="flex items-center">
          <input
            type="checkbox"
            id="limit-thinking"
            checked={limitThinking}
            onChange={(e) => setLimitThinking(e.target.checked)}
            disabled={isLoading}
            className="h-4 w-4 rounded border-gray-300 bg-white text-black focus:ring-black cursor-pointer dark:bg-gray-900 dark:border-gray-600 dark:text-white dark:focus:ring-white"
          />
          <label htmlFor="limit-thinking" className="ml-2 text-sm text-gray-600 cursor-pointer select-none dark:text-gray-400">
            Limit thinking budget (faster, potentially lower quality)
          </label>
        </div>
      )}
    </div>
  );
};
