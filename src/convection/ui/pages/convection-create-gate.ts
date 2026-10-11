/** Prevent repeated clicks from creating multiple meetings for one intent. */
export function createConvectionCreateGate() {
  let active = false;
  return {
    get active() { return active; },
    async run(work: () => Promise<void>): Promise<boolean> {
      if (active) return false;
      active = true;
      try { await work(); return true; }
      finally { active = false; }
    },
  };
}
