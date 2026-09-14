import { useLayoutEffect, useState, type RefObject } from 'react';

/** Coordinates are local to the scrollable canvas, so scrolling cannot detach edges. */
export function TeamConnections({ canvas, revision }: { canvas: RefObject<HTMLDivElement | null>; revision: string }) {
  const [edges, setEdges] = useState<{ id: string; path: string; running: boolean; selected: boolean }[]>([]);
  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const update = () => {
      const origin = root.getBoundingClientRect();
      const main = root.querySelector('.session-team-main')?.getBoundingClientRect();
      if (!main) return;
      const x = main.x + main.width / 2 - origin.x;
      const y = main.bottom - origin.y;
      setEdges(Array.from(root.querySelectorAll<HTMLElement>('[data-member]')).map(node => {
        const box = node.getBoundingClientRect();
        const endX = box.x + box.width / 2 - origin.x;
        const endY = box.top - origin.y;
        return { id: node.dataset.member!, running: node.dataset.running === 'true', selected: node.getAttribute('aria-pressed') === 'true',
          path: `M ${x} ${y} C ${x} ${y + 40}, ${endX} ${endY - 40}, ${endX} ${endY}` };
      }));
    };
    const observer = new ResizeObserver(update);
    observer.observe(root);
    root.querySelectorAll('.session-team-node').forEach(node => observer.observe(node));
    update();
    return () => observer.disconnect();
  }, [canvas, revision]);
  return <svg className="session-team-connections" aria-hidden="true">
    {edges.map(edge => <g key={edge.id} className={`${edge.running ? 'is-flowing' : ''} ${edge.selected ? 'is-active-edge' : ''}`}>
      <path d={edge.path} /><path className="session-team-flow" d={edge.path} />
    </g>)}
  </svg>;
}
