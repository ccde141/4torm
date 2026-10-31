import { useEffect, useRef, useState } from 'react';
import { observePreviewVisibility } from './preview-visibility';

/** The figure stays in layout while its image node is released outside the preview allowance. */
export function usePreviewVisibility<T extends HTMLElement = HTMLElement>(priority = 0) {
  const ref = useRef<T>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const target = ref.current;
    if (target) return observePreviewVisibility(target, setActive, { priority });
  }, [priority]);
  return { ref, active };
}
