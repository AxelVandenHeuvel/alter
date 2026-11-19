import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { EyeIcon, EyeOffIcon } from './icons';

/**
 * Press and hold to see the page without the preview, let go to see it again.
 * Works with the mouse, touch, and the keyboard (hold Space or Enter). An icon,
 * so it fits beside the card's Discard and Save buttons.
 */
export function CompareButton({ onCompare }: { onCompare: (showOriginal: boolean) => void }) {
  const [holding, setHolding] = useState(false);
  const held = useRef(false);
  const latest = useRef(onCompare);
  useEffect(() => {
    latest.current = onCompare;
  });

  const set = (on: boolean) => {
    if (held.current === on) return;
    held.current = on;
    setHolding(on);
    latest.current(on);
  };
  // Never leave the page stuck on the original if the card goes away mid-hold.
  useEffect(
    () => () => {
      if (held.current) latest.current(false);
    },
    [],
  );

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    set(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) set(true);
  };
  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') set(false);
  };

  return (
    <button
      className={`icon-button compare ${holding ? 'holding' : ''}`}
      type="button"
      aria-pressed={holding}
      aria-label={holding ? 'Showing before' : 'Hold to compare'}
      title="Hold to compare: press and hold to see the page without this change"
      onPointerDown={onPointerDown}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => set(false)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {holding ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
    </button>
  );
}
