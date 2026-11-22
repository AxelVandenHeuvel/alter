import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { imageFileToAttachment, MAX_ATTACHMENTS, type Attachment } from '../attachments';
import { ArrowUpIcon, CloseIcon, CropIcon, StopIcon } from './icons';

export function Composer({
  placeholder,
  running,
  lastMessage,
  onSend,
  onStop,
  onSelectArea,
}: {
  placeholder: string;
  running: boolean;
  /** The user's previous message, brought back with the up arrow in an empty box. */
  lastMessage: string | null;
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onStop: () => void;
  /** Let the user select part of the page and return its screenshot (null if cancelled). */
  onSelectArea: () => Promise<Attachment | null>;
}) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const full = attachments.length >= MAX_ATTACHMENTS;

  // Ready to type as soon as the panel opens, and whenever the floating panel is reopened or
  // expanded (its host on the page asks for focus; nothing else is done with that message).
  useEffect(() => {
    area.current?.focus();
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: unknown } | null)?.type === 'alter:focus') area.current?.focus();
    };
    addEventListener('message', onMessage);
    return () => removeEventListener('message', onMessage);
  }, []);

  // Grow with the content up to the CSS max-height.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const add = (attachment: Attachment) => setAttachments((current) => [...current, attachment].slice(0, MAX_ATTACHMENTS));

  const selectArea = async () => {
    if (selecting || full) return;
    setSelecting(true);
    setProblem(null);
    try {
      const attachment = await onSelectArea();
      if (attachment) add(attachment);
    } catch (error) {
      setProblem(`Couldn't take the screenshot: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSelecting(false);
      area.current?.focus();
    }
  };

  // Screenshots pasted from the clipboard (e.g. ⌘⇧⌃4 on a Mac) attach like selections.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    for (const image of images.slice(0, MAX_ATTACHMENTS - attachments.length)) {
      void imageFileToAttachment(image).then(add, () => setProblem("That image couldn't be read."));
    }
  };

  const send = async () => {
    const value = text.trim();
    if (!value || running) return;
    if (await onSend(value, attachments)) {
      setText('');
      setAttachments([]);
      setProblem(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    // ⌘↵ saves the preview (handled by the panel), so it never sends.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    } else if (event.key === 'ArrowUp' && text === '' && lastMessage) {
      event.preventDefault();
      setText(lastMessage);
    }
  };

  return (
    <div className="composer-wrap">
      {problem && <p className="composer-problem">{problem}</p>}
      <div className="composer">
        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((attachment) => (
              <div key={attachment.id} className="attachment" data-testid="attachment">
                <img src={attachment.dataUrl} alt={attachment.selection ? 'Selected area' : 'Pasted screenshot'} />
                <button
                  type="button"
                  className="attachment-remove"
                  aria-label="Remove screenshot"
                  onClick={() => setAttachments((current) => current.filter((a) => a.id !== attachment.id))}
                >
                  <CloseIcon size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button
            className={`icon-button select-area ${selecting ? 'active' : ''}`}
            type="button"
            onClick={() => void selectArea()}
            disabled={running || full}
            aria-label="Select an area of the page"
            title={full ? `Up to ${MAX_ATTACHMENTS} screenshots` : 'Select an area of the page'}
          >
            <CropIcon size={16} />
          </button>
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={selecting ? 'Select an area on the page…' : placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            aria-label="Describe a change"
          />
          {running ? (
            <button className="icon-button send stop" type="button" onClick={onStop} aria-label="Stop">
              <StopIcon size={14} />
            </button>
          ) : (
            <button className="icon-button send" type="button" onClick={() => void send()} disabled={!text.trim()} aria-label="Send">
              <ArrowUpIcon size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
