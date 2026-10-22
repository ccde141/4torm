import { useLayoutEffect, useRef } from 'react';
import { ConsoleIcon } from './ConsoleIcon';
import type { ConsoleSection } from './workshop-console-model';
import './seat-detail-navigation.css';

interface SeatDetailNavigationProps {
  sections: Array<[ConsoleSection, string]>;
  active: ConsoleSection;
  onSelect(section: ConsoleSection): void;
  label: string;
}

export function SeatDetailNavigation({ sections, active, onSelect, label }: SeatDetailNavigationProps) {
  const navRef = useRef<HTMLElement>(null);
  const highlightRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const highlight = highlightRef.current;
    const button = nav?.querySelector<HTMLButtonElement>(`[data-cy-section="${active}"]`);
    if (!nav || !highlight || !button) return;
    // The marker follows the actual button geometry in both navigation layouts.
    const measure = () => {
      highlight.style.transform = `translate(${button.offsetLeft}px, ${button.offsetTop}px)`;
      highlight.style.width = `${button.offsetWidth}px`;
      highlight.style.height = `${button.offsetHeight}px`;
      highlight.dataset.ready = 'true';
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(button);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [active, sections]);

  return <nav ref={navRef} className="cy-seat-nav" aria-label={label}>
    <span ref={highlightRef} className="cy-seat-nav__highlight" aria-hidden="true" />
    {sections.map(([key, title]) => <button key={key} type="button"
      className="cy-seat-nav__button" data-cy-section={key}
      aria-current={active === key ? 'page' : undefined} onClick={() => onSelect(key)}>
      <ConsoleIcon name={key} />{title}
    </button>)}
  </nav>;
}
