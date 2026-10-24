import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { useSplitRatio } from "../../hooks/useSplitRatio";
import {
  clampSplit,
  DEFAULT_SPLIT,
  DIVIDER_PX,
  MIN_PANE_PX,
  MIN_STACKED_PANE_PX,
  shouldStack,
} from "../../lib/project-view";

interface Props {
  first: ReactNode;
  second: ReactNode;
}

export default function SplitPane({ first, second }: Props) {
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

  const stacked = shouldStack(size.w);
  const minPanePx = stacked ? MIN_STACKED_PANE_PX : MIN_PANE_PX;
  const containerPx = stacked ? size.h : size.w;
  const effective = clampSplit(ratio, containerPx - DIVIDER_PX, minPanePx);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const usable = (stacked ? rect.height : rect.width) - DIVIDER_PX;
    if (usable <= 0) return;
    const pos =
      (stacked ? e.clientY - rect.top : e.clientX - rect.left) - DIVIDER_PX / 2;
    setRatio(clampSplit(pos / usable, usable, minPanePx));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

  const firstBasis = `calc((100% - ${DIVIDER_PX}px) * ${effective})`;

  return (
    <div
      ref={containerRef}
      className={`split-pane${stacked ? " stacked" : ""}${dragging ? " dragging" : ""}`}
    >
      <div className="split-pane-item" style={{ flex: `0 0 ${firstBasis}` }}>
        {first}
      </div>
      <div
        className="split-divider"
        style={{ flex: `0 0 ${DIVIDER_PX}px` }}
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
