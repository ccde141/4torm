import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../../types';

const NEAR_BOTTOM_PX = 120;

export function useMonsoonScroll(messages: ChatMessage[], activeSessionId: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const lastTopRef = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const isNearBottom = useCallback(() => {
    const element = containerRef.current;
    return !element || element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
  }, []);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const element = containerRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    lastTopRef.current = element.scrollTop;
    followRef.current = true;
    setShowJump(false);
  }, []);
  const breakFollow = useCallback(() => { followRef.current = false; setShowJump(true); }, []);

  useEffect(() => bindScroll(containerRef.current, isNearBottom, breakFollow,
    followRef, lastTopRef, setShowJump), [isNearBottom, breakFollow, activeSessionId]);
  useEffect(() => { if (followRef.current) scrollToBottom('auto'); }, [messages, scrollToBottom]);
  useEffect(() => {
    if (!activeSessionId) return;
    followRef.current = true; setShowJump(false);
    const timer = setTimeout(() => scrollToBottom('auto'), 0);
    return () => clearTimeout(timer);
  }, [activeSessionId, scrollToBottom]);
  return { containerRef, endRef, followRef, showJump, scrollToBottom };
}

function bindScroll(
  element: HTMLDivElement | null,
  nearBottom: () => boolean,
  breakFollow: () => void,
  follow: React.RefObject<boolean>,
  lastTop: React.RefObject<number>,
  showJump: (value: boolean) => void,
) {
  if (!element) return;
  const wheel = (event: WheelEvent) => { if (event.deltaY < 0) breakFollow(); };
  let touchY = 0;
  const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? 0; };
  const touchMove = (event: TouchEvent) => {
    const y = event.touches[0]?.clientY ?? 0;
    if (y > touchY + 2) breakFollow();
    touchY = y;
  };
  const scroll = () => {
    const top = element.scrollTop; const near = nearBottom();
    if (top < lastTop.current - 2 && !near) follow.current = false;
    if (near) follow.current = true;
    showJump(!near); lastTop.current = top;
  };
  element.addEventListener('wheel', wheel, { passive: true });
  element.addEventListener('touchstart', touchStart, { passive: true });
  element.addEventListener('touchmove', touchMove, { passive: true });
  element.addEventListener('scroll', scroll, { passive: true });
  return () => {
    element.removeEventListener('wheel', wheel); element.removeEventListener('touchstart', touchStart);
    element.removeEventListener('touchmove', touchMove); element.removeEventListener('scroll', scroll);
  };
}
