import React from 'react';

interface TopicInputProps {
  topic: string;
  setTopic: (topic: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  limitThinking: boolean;
  setLimitThinking: (limit: boolean) => void;
}

export const TopicInput: React.FC<TopicInputProps> = ({ topic, setTopic, onSubmit, isLoading, limitThinking, setLimitThinking }) => {
  
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !isLoading) {
      onSubmit();
    }
  };
  
  return (
    <div className="w-full max-w-xl flex flex-col items-center gap-4">
      <div className="w-full flex flex-col sm:flex-row items-center gap-3">
        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g., The process of photosynthesis"
          className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-md focus:ring-2 focus:ring-purple-500 focus:outline-none transition duration-200 text-lg placeholder-gray-500"
          disabled={isLoading}
        />
        <button
          onClick={onSubmit}
          disabled={isLoading}
          className="w-full sm:w-auto flex items-center justify-center px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-900 disabled:cursor-not-allowed disabled:text-gray-400 text-white font-semibold rounded-md transition duration-200 text-lg whitespace-nowrap"
        >
          {isLoading ? (
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Generating...
            </>
          ) : (
            'Generate SVG'
          )}
        </button>
      </div>
      <div className="flex items-center self-start sm:self-center">
        <input
            type="checkbox"
            id="limit-thinking"
            checked={limitThinking}
            onChange={(e) => setLimitThinking(e.target.checked)}
            disabled={isLoading}
            className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-purple-600 focus:ring-purple-500 cursor-pointer"
        />
        <label htmlFor="limit-thinking" className="ml-2 text-sm text-gray-400 cursor-pointer select-none">
            Limit thinking budget (faster, potentially lower quality)
        </label>
      </div>
    </div>
  );
};