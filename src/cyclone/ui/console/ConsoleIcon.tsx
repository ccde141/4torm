import type { ConsoleSection } from './workshop-console-model';

const paths: Record<string, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  structure: 'M9 3h6v6H9zM3 15h6v6H3zM15 15h6v6h-6zM12 9v3M6 15v-3h12v3',
  bulletin: 'M3 4h18v14H3zM7 18v3M17 18v3M7 8h4v6H7zM14 8h3M14 11h3M14 14h3',
  recent: 'M12 8v5l3 2M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Z',
  stats: 'M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7',
  config: 'm14 6 4-3 3 3-3 4-4-1-9 12-3-3 11-9Z',
  memory: 'M5 3h14v18H5zM8 7h8M8 11h8M8 15h5',
  inherited: 'M7 3v4M12 3v4M17 3v4M7 17v4M12 17v4M17 17v4M3 7h4M3 12h4M3 17h4M17 7h4M17 12h4M17 17h4M7 7h10v10H7z',
  collaboration: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM16 3a4 4 0 0 1 0 8',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z',
  plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
  folder: 'M3 6h7l2 3h9v11H3z', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
};

export function ConsoleIcon({ name }: { name: ConsoleSection | keyof typeof paths }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.overview} /></svg>;
}
