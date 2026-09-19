"use client";

import { useState } from "react";

import type { TelemetrySample } from "@/lib/api-types";

type TelemetryChartProps = {
  items: TelemetrySample[];
  maxTemperatureC: number;
};

const WIDTH = 760;
const HEIGHT = 260;
const PADDING = { top: 18, right: 20, bottom: 42, left: 48 };

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

export function TelemetryChart({ items, maxTemperatureC }: TelemetryChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(items.length - 1);

  if (items.length === 0) {
    return <p className="empty-copy">No recent telemetry available.</p>;
  }

  const temperatures = items.map((item) => item.temperatureC);
  const yMin = Math.floor(Math.min(...temperatures, maxTemperatureC) - 1);
  const yMax = Math.ceil(Math.max(...temperatures, maxTemperatureC) + 1);
  const yRange = Math.max(yMax - yMin, 1);
  const innerWidth = WIDTH - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const xFor = (index: number) =>
    items.length === 1
      ? PADDING.left + innerWidth / 2
      : PADDING.left + (index / (items.length - 1)) * innerWidth;

  const yFor = (temperatureC: number) =>
    PADDING.top + ((yMax - temperatureC) / yRange) * innerHeight;

  const points = items.map((item, index) => `${xFor(index)},${yFor(item.temperatureC)}`).join(" ");
  const thresholdY = yFor(maxTemperatureC);
  const activeSample = activeIndex === null ? null : items[activeIndex];
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4;
    return {
      y: PADDING.top + ratio * innerHeight,
      value: yMax - ratio * yRange,
    };
  });

  return (
    <div className="telemetry-chart-wrap">
      <svg
        className="telemetry-chart"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Recent temperature history. Configured maximum ${maxTemperatureC} degrees Celsius.`}
      >
        {yTicks.map((tick) => (
          <g key={tick.value}>
            <line
              className="chart-grid-line"
              x1={PADDING.left}
              x2={WIDTH - PADDING.right}
              y1={tick.y}
              y2={tick.y}
            />
            <text className="chart-axis-label" x={PADDING.left - 10} y={tick.y + 4} textAnchor="end">
              {tick.value.toFixed(1)}°
            </text>
          </g>
        ))}

        <line
          className="chart-threshold-line"
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={thresholdY}
          y2={thresholdY}
        />
        <text
          className="chart-threshold-label"
          x={WIDTH - PADDING.right}
          y={thresholdY - 7}
          textAnchor="end"
        >
          Max {maxTemperatureC}°C
        </text>

        <polyline className="chart-temperature-line" points={points} />

        {items.map((item, index) => {
          const x = xFor(index);
          const y = yFor(item.temperatureC);
          const isActive = activeIndex === index;

          return (
            <g
              key={`${item.observedAt}-${index}`}
              className="chart-point-group"
              tabIndex={0}
              role="button"
              aria-label={`${formatTime(item.observedAt)} UTC, ${item.temperatureC.toFixed(1)} degrees Celsius`}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              onClick={() => setActiveIndex(index)}
            >
              <circle className="chart-point-hit-area" cx={x} cy={y} r="14" />
              <circle className={isActive ? "chart-point chart-point-active" : "chart-point"} cx={x} cy={y} r="5" />
              <text className="chart-x-label" x={x} y={HEIGHT - 14} textAnchor="middle">
                {formatTime(item.observedAt)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="chart-readout" aria-live="polite">
        {activeSample ? (
          <>
            <strong>{activeSample.temperatureC.toFixed(1)}°C</strong>
            <span>{formatTime(activeSample.observedAt)} UTC</span>
            <span>Door {activeSample.doorState ?? "UNKNOWN"}</span>
            <span>Power {activeSample.powerState ?? "UNKNOWN"}</span>
          </>
        ) : (
          <span>Hover or focus a reading for details.</span>
        )}
      </div>
    </div>
  );
}
