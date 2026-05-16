/**
 * SparkBarChart — a tiny, dependency-free SVG bar chart for embedded
 * mobile use (sparkline-shaped — wider than tall, no axes, no labels).
 *
 * Built from SVG primitives rather than reaching for a charting
 * library because the visual is simple (N bars, scaled-to-max) and the
 * wallet's deps stay minimal. Bars stretch horizontally to fill the
 * container via preserveAspectRatio="none"; vertical scaling is
 * normalized to the max value in the dataset.
 *
 * Single-purpose for slice 3: validator points-per-era over the
 * historical window. If a more general chart is wanted later, this
 * can grow — but slice 3 doesn't need axes, tooltips, or interaction.
 */

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
}

export function SparkBarChart({
  data,
  height = 80,
  barClassName = 'fill-xx-500',
  className,
  ariaLabel,
}: SparkBarChartProps) {
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

  const maxY = Math.max(...data.map((d) => d.points), 1);
  // ViewBox is arbitrary — preserveAspectRatio="none" stretches it to
  // fill the container's width × the configured height. Picking a
  // round number keeps the math readable.
  const vbWidth = 100;
  const barW = vbWidth / data.length;

  return (
    <svg
      viewBox={`0 0 ${vbWidth} ${height}`}
      className={clsx('w-full block', className)}
      preserveAspectRatio="none"
      style={{ height }}
      role="img"
      aria-label={ariaLabel}
    >
      {data.map((d, i) => {
        const h = (d.points / maxY) * height;
        return (
          <rect
            key={d.era}
            x={i * barW}
            y={height - h}
            // 85% width gives a small visual gap between bars without
            // making them too thin to see on mobile.
            width={Math.max(barW * 0.85, 0.1)}
            height={h}
            className={barClassName}
          />
        );
      })}
    </svg>
  );
}
