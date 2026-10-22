import type { ReactNode } from 'react';

const paths = {
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  repeat: <><path d="m16 3 4 4-4 4M4 11V9a2 2 0 0 1 2-2h14M8 21l-4-4 4-4m12 0v2a2 2 0 0 1-2 2H4" /></>,
  message: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-9.5A8.5 8.5 0 0 1 10.5 4h2a8.5 8.5 0 0 1 8.5 7.5Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2" /></>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="17" r="2" /></>,
  history: <><path d="M3 11a9 9 0 1 1 2.6 6.4M3 4v7h7M12 7v5l3 2" /></>,
  tool: <><path d="m14 6 4 4M8 12l-5 5a2.1 2.1 0 0 0 3 3l5-5m1-3 6-9 3 3-9 6ZM6 3l5 5-3 3-5-5V3Z" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  archive: <><rect x="3" y="3" width="18" height="5" rx="1" /><path d="M5 8v12h14V8m-10 4h6" /></>,
  'arrow-left': <path d="M20 12H4m6-6-6 6 6 6" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></>,
} satisfies Record<string, ReactNode>;

export default function TideIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
