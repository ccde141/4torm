import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

const NEAR_BOTTOM_PX = 120;

interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function isChatNearBottom(metrics: ScrollMetrics): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < NEAR_BOTTOM_PX;
}

interface ListenerOpts {
  scrollRef: RefObject<HTMLDivElement | null>;
  followRef: RefObject<boolean>;
  lastScrollTopRef: RefObject<number>;
  setShowJumpButton: Dispatch<SetStateAction<boolean>>;
  enabled: boolean;
  scopeKey: string;
}

function useScrollListeners(opts: ListenerOpts): void {
  const { scrollRef, followRef, lastScrollTopRef, setShowJumpButton, enabled, scopeKey } = opts;
  useEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return;
    const breakFollow = () => { followRef.current = false; setShowJumpButton(true); };
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) breakFollow(); };
    let touchY = 0;
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0;
      if (y > touchY + 2) breakFollow();
      touchY = y;
    };
    const onScroll = () => {
      const near = isChatNearBottom(el);
      if (el.scrollTop < lastScrollTopRef.current - 2 && !near) followRef.current = false;
      if (near) followRef.current = true;
      setShowJumpButton(!near);
      lastScrollTopRef.current = el.scrollTop;
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('scroll', onScroll);
    };
  }, [enabled, followRef, lastScrollTopRef, scopeKey, scrollRef, setShowJumpButton]);
}

export function useSmartChatScroll(opts: {
  scopeKey: string;
  enabled: boolean;
  content: unknown;
  liveContent: unknown;
}) {
  const { scopeKey, enabled, content, liveContent } = opts;
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [showJumpButton, setShowJumpButton] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    lastScrollTopRef.current = el.scrollTop;
    followRef.current = true;
    setShowJumpButton(false);
  }, []);

  useScrollListeners({
    scrollRef, followRef, lastScrollTopRef, setShowJumpButton, enabled, scopeKey,
  });

  useEffect(() => {
    if (enabled && followRef.current) scrollToBottom('auto');
  }, [content, enabled, liveContent, scrollToBottom]);

  useEffect(() => {
    if (!enabled) return;
    followRef.current = true;
    setShowJumpButton(false);
    const timer = window.setTimeout(() => scrollToBottom('auto'), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, scopeKey, scrollToBottom]);

  return { scrollRef, showJumpButton, scrollToBottom };
}
