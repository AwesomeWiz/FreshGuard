"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TelemetrySample } from "@/lib/api-types";

type TelemetryChartProps = { items: TelemetrySample[]; maxTemperatureC: number };
const HEIGHT = 300;
const PADDING = { top: 20, right: 28, bottom: 40, left: 42 };

function formatTime(value: string | number): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC",
  }).format(new Date(value));
}

export function TelemetryChart({ items, maxTemperatureC }: TelemetryChartProps) {
  const [selectedAt, setSelectedAt] = useState<string | null>(null);
  const [width, setWidth] = useState(960);
  const chartRef = useRef<HTMLDivElement>(null);
  const hintId = useId();

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (items.length === 0) return <p className="empty-copy">No recent telemetry available.</p>;

  const temperatures = items.map((item) => item.temperatureC);
  const times = items.map((item) => new Date(item.observedAt).getTime());
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const yMin = Math.floor(Math.min(...temperatures, maxTemperatureC) - 1);
  const yMax = Math.ceil(Math.max(...temperatures, maxTemperatureC) + 1);
  const innerWidth = width - PADDING.left - PADDING.right;
  const innerHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const xForTime = (time: number) => firstTime === lastTime
    ? PADDING.left + innerWidth / 2
    : PADDING.left + ((time - firstTime) / (lastTime - firstTime)) * innerWidth;
  const yFor = (temperature: number) => PADDING.top + ((yMax - temperature) / (yMax - yMin)) * innerHeight;
  const points = items.map((item, index) => `${xForTime(times[index])},${yFor(item.temperatureC)}`).join(" ");
  // Follow the newest reading unless the operator is inspecting one still in the window.
  const selectedIndex = items.findIndex((item) => item.observedAt === selectedAt);
  const activeIndex = selectedIndex < 0 ? items.length - 1 : selectedIndex;
  const activeSample = items[activeIndex];
  const tickCount = firstTime === lastTime ? 1 : width < 500 ? 3 : 6;
  const timeTicks = Array.from({ length: tickCount }, (_, index) => firstTime + (lastTime - firstTime) * index / Math.max(1, tickCount - 1));
  const activeDescription = `${formatTime(activeSample.observedAt)} UTC, ${activeSample.temperatureC.toFixed(1)} degrees Celsius, door ${activeSample.doorState ?? "UNKNOWN"}, power ${activeSample.powerState ?? "UNKNOWN"}`;

  return (
    <div className="telemetry-chart-wrap" ref={chartRef}>
      <div className="chart-legend"><span><i className="chart-line-key" aria-hidden="true" />Temperature</span><span><i className="threshold-key" aria-hidden="true" />Maximum {maxTemperatureC}°C</span></div>
      <div
        className="chart-interaction"
        role="slider"
        tabIndex={0}
        aria-label="Inspect temperature readings"
        aria-describedby={hintId}
        aria-valuemin={0}
        aria-valuemax={items.length - 1}
        aria-valuenow={activeIndex}
        aria-valuetext={activeDescription}
        onKeyDown={(event) => {
          let nextIndex = activeIndex;
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextIndex--;
          else if (event.key === "ArrowRight" || event.key === "ArrowUp") nextIndex++;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = items.length - 1;
          else return;
          event.preventDefault();
          setSelectedAt(items[Math.max(0, Math.min(items.length - 1, nextIndex))].observedAt);
        }}
      >
        <svg className="telemetry-chart" viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => {
            const value = yMax - (index / 4) * (yMax - yMin);
            const y = yFor(value);
            return <g key={index}><line className="chart-grid-line" x1={PADDING.left} x2={width - PADDING.right} y1={y} y2={y} /><text className="chart-axis-label" x={PADDING.left - 10} y={y + 4} textAnchor="end">{value.toFixed(1)}°</text></g>;
          })}
          <polygon className="chart-temperature-area" points={`${xForTime(times[0])},${HEIGHT - PADDING.bottom} ${points} ${xForTime(times[items.length - 1])},${HEIGHT - PADDING.bottom}`} />
          <line className="chart-threshold-line" x1={PADDING.left} x2={width - PADDING.right} y1={yFor(maxTemperatureC)} y2={yFor(maxTemperatureC)} />
          <polyline className="chart-temperature-line" points={points} />
          <line className="chart-crosshair" x1={xForTime(times[activeIndex])} x2={xForTime(times[activeIndex])} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} />
          {items.map((item, index) => (
            <g key={`${item.observedAt}-${index}`} className="chart-point-group" onMouseEnter={() => setSelectedAt(item.observedAt)} onClick={() => setSelectedAt(item.observedAt)}>
              <circle className="chart-point-hit-area" cx={xForTime(times[index])} cy={yFor(item.temperatureC)} r="12" />
              {index === activeIndex ? <circle className="chart-point" cx={xForTime(times[index])} cy={yFor(item.temperatureC)} r="4" /> : null}
            </g>
          ))}
          {timeTicks.map((time, index) => <text key={index} className="chart-x-label" x={xForTime(time)} y={HEIGHT - 12} textAnchor={tickCount === 1 ? "middle" : index === 0 ? "start" : index === tickCount - 1 ? "end" : "middle"}>{formatTime(time)}</text>)}
        </svg>
      </div>
      <div className="chart-readout">
        <strong>{activeSample.temperatureC.toFixed(1)}°C</strong>
        <span>{formatTime(activeSample.observedAt)} UTC</span>
        <span>Door {activeSample.doorState ?? "UNKNOWN"}</span>
        <span>Power {activeSample.powerState ?? "UNKNOWN"}</span>
        <span id={hintId} className="chart-hint">Hover or tap a reading · Arrow keys to inspect</span>
      </div>
    </div>
  );
}
