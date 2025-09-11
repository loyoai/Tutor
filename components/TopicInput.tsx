import React from 'react';

interface TopicInputProps {
  topic: string;
  setTopic: (topic: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  limitThinking: boolean;
  setLimitThinking: (limit: boolean) => void;
  buttonLabel?: string;
  showLimitThinking?: boolean;
}

export const TopicInput: React.FC<TopicInputProps> = ({ topic, setTopic, onSubmit, isLoading, limitThinking, setLimitThinking, buttonLabel, showLimitThinking = true }) => {
  
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isLoading) {
      event.preventDefault();
      onSubmit();
    }
  };
  
  return (
    <div className="w-full flex flex-col items-stretch gap-2">
      <div className="relative">
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to build?"
          rows={4}
          className="w-full pr-12 pl-4 py-4 min-h-[140px] bg-white border border-gray-200 rounded-3xl focus:ring-2 focus:ring-black focus:outline-none transition duration-200 text-base text-gray-900 placeholder-gray-500 shadow-sm resize-none"
          disabled={isLoading}
        />
        <button
          type="button"
          aria-label={buttonLabel || 'Submit'}
          onClick={onSubmit}
          disabled={isLoading}
          className="absolute right-4 bottom-4 h-10 w-10 rounded-full flex items-center justify-center text-gray-600 hover:text-gray-800 hover:bg-gray-100 disabled:text-gray-400"
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
            className="h-4 w-4 rounded border-gray-300 bg-white text-black focus:ring-black cursor-pointer"
          />
          <label htmlFor="limit-thinking" className="ml-2 text-sm text-gray-600 cursor-pointer select-none">
            Limit thinking budget (faster, potentially lower quality)
          </label>
        </div>
      )}
    </div>
  );
};
