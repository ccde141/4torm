import { useEffect, useRef } from 'react';

/** Follow both viewport and streaming-content size without per-token React updates. */
export function useProcessFade(present: boolean, expanded: boolean, followLatest = false) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = viewport.current;
    const inner = content.current;
    if (!present || !element || !inner) return;
    let pinned = true;
    let lastTop = element.scrollTop;
    const update = () => {
      element.dataset.fadeTop = String(!expanded && element.scrollTop > 1);
      element.dataset.fadeBottom = String(!expanded && element.scrollHeight - element.clientHeight - element.scrollTop > 1);
    };
    const onScroll = () => {
      if (element.scrollTop < lastTop - 1) pinned = false;
      if (element.scrollHeight - element.clientHeight - element.scrollTop <= 16) pinned = true;
      lastTop = element.scrollTop;
      update();
    };
    const onResize = () => {
      if (followLatest && !expanded && pinned) element.scrollTop = element.scrollHeight;
      lastTop = element.scrollTop;
      update();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    observer.observe(inner);
    element.addEventListener('scroll', onScroll, { passive: true });
    onResize();
    return () => { observer.disconnect(); element.removeEventListener('scroll', onScroll); };
  }, [present, expanded, followLatest]);
  return { viewport, content };
}
