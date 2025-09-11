import React from 'react';

interface SvgDisplayProps {
  svgContent: string | null;
  isLoading: boolean;
  error: string | null;
  hasStarted: boolean;
  isSpeaking: boolean;
}

const LoadingState: React.FC = () => (
    <div className="flex flex-col items-center justify-center text-gray-400">
        <svg className="animate-spin h-10 w-10 text-purple-400 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-lg font-medium">Crafting your tutorial...</p>
    </div>
);

const InitialState: React.FC = () => (
    <div className="flex flex-col items-center justify-center text-gray-500">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <h3 className="text-xl font-semibold">Ready to visualize</h3>
        <p className="mt-1 text-center">Enter a topic above to generate a step-by-step SVG tutorial.</p>
    </div>
);

const ErrorState: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg p-6">
         <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-xl font-semibold">An Error Occurred</h3>
        <p className="mt-1 text-center text-red-300">{message}</p>
    </div>
);

export const SvgDisplay: React.FC<SvgDisplayProps> = ({ svgContent, isLoading, error, hasStarted, isSpeaking }) => {
  const renderSvgArea = () => {
    if (error) return <ErrorState message={error} />;
    if (isLoading && !hasStarted) return <LoadingState />;
    if (!hasStarted && !isLoading) return <InitialState />;
    if (svgContent) {
      return (
        <div className="w-full h-full [&_svg]:w-full [&_svg]:h-full [&_svg]:max-w-full [&_svg]:max-h-full" dangerouslySetInnerHTML={{ __html: svgContent }} />
      );
    }
    return <div className="w-full h-full bg-white"></div>; // Placeholder while loading/text-only steps
  };

  return (
    <div className="w-full h-full flex flex-col relative">
        <div className="w-full h-full flex items-center justify-center">
          {renderSvgArea()}
        </div>
        {isSpeaking && (
            <div className="absolute bottom-6 right-6 bg-purple-600 text-white rounded-full p-3 shadow-lg flex items-center justify-center animate-pulse" aria-label="Application is speaking" role="status">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.858 17.142a5 5 0 010-7.072m2.828 9.9a9 9 0 010-12.728M12 12h.01" />
                </svg>
            </div>
        )}
    </div>
  );
};
