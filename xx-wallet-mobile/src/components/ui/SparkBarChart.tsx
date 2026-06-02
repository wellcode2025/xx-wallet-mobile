/**
 * SparkBarChart — a tiny, dependency-free SVG bar chart for embedded
 * mobile use. Bars stretch horizontally to fill the container via
 * preserveAspectRatio="none"; vertical scaling is normalized to the max
 * value in the dataset.
 *
 * Reads as real data, not decoration: an always-visible summary line
 * (average / high / low) sits above the bars, and because mobile has no
 * hover, the user can tap or drag across the chart to read any single
 * bar's exact value — the touched bar highlights and its era + value
 * show in the readout. Built from SVG primitives rather than a charting
 * library to keep the wallet's dependencies minimal.
 */

import { useRef, useState } from 'react';
import clsx from 'clsx';

interface SparkBarChartProps {
  /** Data points in render order (left → right). */
  data: { era: number; points: number }[];
  /** Rendered height in CSS pixels (width is responsive). */
  height?: number;
  /** Tailwind fill utility for the bars; defaults to brand teal. */
  barClassName?: string;
  className?: string;
  /** Aria label for screen readers. */
  ariaLabel?: string;
  /**
   * Format a value for the readout/summary (e.g. "1,234" or "5 XX").
   * Defaults to a thousands-separated integer.
   */
  formatValue?: (value: number) => string;
  /** Show the summary + tap-to-read readout line. Default true. */
  showReadout?: boolean;
}

export function SparkBarChart({
  data,
  height = 80,
  barClassName = 'fill-xx-500',
  className,
  ariaLabel,
  formatValue = (v) => Math.round(v).toLocaleString(),
  showReadout = true,
}: SparkBarChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);
  const [selected, setSelected] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center text-xs text-ink-400',
          className
        )}
        style={{ height }}
      >
        No data.
      </div>
    );
  }

  const values = data.map((d) => d.points);
  const maxY = Math.max(...values, 1);
  const minY = Math.min(...values);
  const avgY = values.reduce((s, v) => s + v, 0) / values.length;

  const vbWidth = 100;
  const barW = vbWidth / data.length;

  const selectFromClientX = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = (clientX - rect.left) / rect.width;
    const idx = Math.max(
      0,
      Math.min(data.length - 1, Math.floor(ratio * data.length))
    );
    setSelected(idx);
  };

  const sel = selected !== null ? data[selected] : null;

  return (
    <div className={className}>
      {showReadout && (
        <div className="flex items-baseline justify-between mb-1.5 text-xs">
          {sel ? (
            <span className="text-ink-400">
              Era <span className="text-ink-200">{sel.era}</span> ·{' '}
              <span className="text-ink-100 font-mono">
                {formatValue(sel.points)}
              </span>
            </span>
          ) : (
            <span className="text-ink-400">
              Avg{' '}
              <span className="text-ink-200 font-mono">{formatValue(avgY)}</span>{' '}
              · High{' '}
              <span className="text-ink-200 font-mono">{formatValue(maxY)}</span>{' '}
              · Low{' '}
              <span className="text-ink-200 font-mono">{formatValue(minY)}</span>
            </span>
          )}
          {sel && (
            <button
              onClick={() => setSelected(null)}
              className="text-ink-500 active:text-ink-300"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${vbWidth} ${height}`}
        className="w-full block touch-none"
        preserveAspectRatio="none"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          selectFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) selectFromClientX(e.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {data.map((d, i) => {
          const h = (d.points / maxY) * height;
          const isSel = i === selected;
          return (
            <rect
              key={d.era}
              x={i * barW}
              y={height - h}
              width={Math.max(barW * 0.85, 0.1)}
              height={h}
              className={clsx(
                isSel ? 'fill-xx-500' : barClassName,
                selected !== null && !isSel && 'opacity-40'
              )}
            />
          );
        })}
      </svg>
    </div>
  );
}
