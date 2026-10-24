import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useSplitRatio } from "../../hooks/useSplitRatio";
import { clampSplit, DEFAULT_SPLIT } from "../../lib/project-view";

interface Props {
  first: ReactNode;
  second: ReactNode;
}

export default function SplitPane({ first, second }: Props) {
  const stacked = useMediaQuery("(max-width: 900px)");
  const [ratio, setRatio] = useSplitRatio();
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const containerPx = stacked ? size.h : size.w;
  const effective = clampSplit(ratio, containerPx);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const total = stacked ? rect.height : rect.width;
    if (total <= 0) return;
    const pos = stacked ? e.clientY - rect.top : e.clientX - rect.left;
    setRatio(clampSplit(pos / total, total));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  const pct = `${effective * 100}%`;

  return (
    <div
      ref={containerRef}
      className={`split-pane${stacked ? " stacked" : ""}${dragging ? " dragging" : ""}`}
    >
      <div className="split-pane-item" style={{ flex: `0 0 ${pct}` }}>
        {first}
      </div>
      <div
        className="split-divider"
        role="separator"
        aria-orientation={stacked ? "horizontal" : "vertical"}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => setRatio(DEFAULT_SPLIT)}
      />
      <div className="split-pane-item" style={{ flex: "1 1 0" }}>
        {second}
      </div>
    </div>
  );
}
