import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createImageDraft, type ImageDraft } from '../../engine/chat/image-attachments';
import { useDroppedPathInput } from '../../lib/useDroppedPathInput';
import {
  DESKTOP_FILES_DROPPED, type DesktopFilesDroppedEvent, type DroppedFile,
} from '../desktop/DesktopDropLayer';

const isNotImage = (file: DroppedFile) => !file.type.startsWith('image/');

export function useMonsoonImages(input: string, setInput: Dispatch<SetStateAction<string>>,
  active: boolean, ownerKey: string) {
  const [drafts, setDrafts] = useState<ImageDraft[]>([]);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setError('');
    const added: ImageDraft[] = [];
    let count = drafts.length;
    for (const file of files) {
      try { added.push(await createImageDraft(file, count++)); }
      catch (cause) { setError((cause as Error).message); break; }
    }
    if (added.length) setDrafts(previous => [...previous, ...added]);
  }, [drafts.length]);

  useDroppedPathInput(setInput, inputRef, active, isNotImage);
  useEffect(() => { if (!input) inputRef.current?.style.removeProperty('height'); }, [input]);
  useEffect(() => { setDrafts([]); setError(''); }, [ownerKey]);
  useEffect(() => {
    if (!active) return;
    const onDrop = (event: Event) => {
      const files = (event as DesktopFilesDroppedEvent).detail.files
        .filter(file => file.type.startsWith('image/')).map(file => file.file);
      void addFiles(files);
    };
    window.addEventListener(DESKTOP_FILES_DROPPED, onDrop);
    return () => window.removeEventListener(DESKTOP_FILES_DROPPED, onDrop);
  }, [active, addFiles]);

  return { drafts, setDrafts, error, setError, inputRef, fileRef, addFiles };
}
