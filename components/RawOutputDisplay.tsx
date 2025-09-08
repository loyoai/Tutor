import React from 'react';

interface RawOutputDisplayProps {
  rawContent: string | null;
}

export const RawOutputDisplay: React.FC<RawOutputDisplayProps> = ({ rawContent }) => {
  if (!rawContent) {
    return null;
  }
  
  return (
    <div className="w-full max-w-5xl mt-2">
      <h3 className="text-base font-semibold text-gray-400 mb-2 px-1">Raw LLM Output</h3>
      <div className="bg-gray-950/50 border border-gray-700 rounded-lg max-h-60 overflow-auto">
        <pre className="p-4 whitespace-pre-wrap break-words font-mono text-sm text-gray-400">
          <code>
            {rawContent}
          </code>
        </pre>
      </div>
    </div>
  );
};
