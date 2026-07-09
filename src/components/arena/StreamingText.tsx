import { useEffect, useRef, useState } from 'react';

interface StreamingTextProps {
  /** Generator that yields content chunks */
  stream: AsyncGenerator<{ content: string; done: boolean }>;
  /** Called when streaming completes */
  onDone?: (fullText: string) => void;
  /** Buffer interval in ms — chunks are batched and rendered at this cadence */
  bufferMs?: number;
}

export function StreamingText({ stream, onDone, bufferMs = 80 }: StreamingTextProps) {
  const [displayedText, setDisplayedText] = useState('');
  const [isStreaming, setIsStreaming] = useState(true);
  const bufferRef = useRef('');
  const fullTextRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setIsStreaming(true);
    setDisplayedText('');
    bufferRef.current = '';
    fullTextRef.current = '';

    // Flush buffer at regular intervals
    timerRef.current = setInterval(() => {
      if (bufferRef.current && mountedRef.current) {
        fullTextRef.current += bufferRef.current;
        setDisplayedText(fullTextRef.current);
        bufferRef.current = '';
      }
    }, bufferMs);

    // Consume the stream
    (async () => {
      try {
        for await (const chunk of stream) {
          if (!mountedRef.current) break;
          if (chunk.content) {
            bufferRef.current += chunk.content;
          }
          if (chunk.done) break;
        }
      } catch (err) {
        if (mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Stream error';
          setDisplayedText((prev) => prev + `\n\n[Error: ${message}]`);
        }
      } finally {
        // Final flush
        if (mountedRef.current) {
          if (bufferRef.current) {
            fullTextRef.current += bufferRef.current;
          }
          setDisplayedText(fullTextRef.current);
          setIsStreaming(false);
          onDone?.(fullTextRef.current);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!displayedText && isStreaming) {
    return (
      <div className="flex items-center gap-2 text-foreground/40 text-sm font-mono uppercase tracking-wider">
        <span className="inline-block w-1.5 h-1.5 bg-primary animate-pulse" />
        Waiting for response…
      </div>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">
      {displayedText}
      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 bg-primary ml-0.5 align-middle" />
      )}
    </div>
  );
}