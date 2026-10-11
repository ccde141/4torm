import { useLayoutEffect, useRef, useState } from 'react';

interface NavItem<Id extends string> { id: Id; label: string }
interface Props<Id extends string> {
  items: readonly NavItem<Id>[];
  active: Id;
  label: string;
  onSelect: (id: Id) => void;
}

export default function AgentDetailNav<Id extends string>(props: Props<Id>) {
  const { items, active, label, onSelect } = props;
  const navRef = useRef<HTMLElement>(null);
  const [highlight, setHighlight] = useState<React.CSSProperties>();

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const button = [...nav.querySelectorAll<HTMLButtonElement>('[data-nav-id]')]
        .find(node => node.dataset.navId === active);
      if (!button) return;
      setHighlight({ transform: `translate(${button.offsetLeft}px, ${button.offsetTop}px)`,
        width: button.offsetWidth, height: button.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [active, items]);

  return <nav ref={navRef} className="agent-detail__nav" aria-label={label}>
    <span aria-hidden="true" className="agent-detail__nav-highlight" style={highlight} />
    {items.map(entry => <button key={entry.id} type="button" data-nav-id={entry.id}
      className={active === entry.id ? 'agent-detail__nav-item agent-detail__nav-item--active'
        : 'agent-detail__nav-item'}
      aria-current={active === entry.id ? 'page' : undefined}
      onClick={() => onSelect(entry.id)}>{entry.label}</button>)}
  </nav>;
}
