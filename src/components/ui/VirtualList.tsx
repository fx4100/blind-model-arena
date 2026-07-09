import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';

interface VirtualListProps<T> {
  items: T[];
  /** Total row height including any gap between items */
  itemHeight: number;
  /** Number of items to render above/below the visible window */
  overscan?: number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
}

/**
 * Lightweight virtualized list — only renders items within the visible
 * scrollport plus `overscan` rows above and below.  Use when you have
 * more than ~50 items to avoid thousands of DOM nodes.
 */
export function VirtualList<T>({
  items,
  itemHeight,
  overscan = 5,
  renderItem,
  className = '',
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);

  // Observe container resize so we always know the visible height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setContainerHeight(entry.contentRect.height);
    });
    ro.observe(el);
    // Initial read in case ResizeObserver fires async
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  const totalHeight = items.length * itemHeight;

  // Visible range with overscan
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan,
  );

  const visible = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className={`overflow-y-auto ${className}`}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        {visible.map((item, i) => {
          const idx = startIndex + i;
          return (
            <div
              key={idx}
              style={{
                position: 'absolute',
                top: idx * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              {renderItem(item, idx)}
            </div>
          );
        })}
      </div>
    </div>
  );
}