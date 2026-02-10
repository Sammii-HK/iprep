'use client';

import { useCallback, useRef } from 'react';

interface UseLongPressOptions {
  /** Duration in ms before long press fires (default: 500) */
  duration?: number;
  /** Max pointer movement in px before cancelling (default: 10) */
  moveThreshold?: number;
  onLongPress: () => void;
}

interface UseLongPressReturn {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  /** True if a long press just fired -- use to prevent click/navigation on release */
  isLongPress: React.RefObject<boolean>;
}

export function useLongPress({
  duration = 500,
  moveThreshold = 10,
  onLongPress,
}: UseLongPressOptions): UseLongPressReturn {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const startPos = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isLongPress.current = false;
      startPos.current = { x: e.clientX, y: e.clientY };

      const target = e.currentTarget as HTMLElement;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (!startPos.current) return;
        const dx = moveEvent.clientX - startPos.current.x;
        const dy = moveEvent.clientY - startPos.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
          clear();
          target.removeEventListener('pointermove', handlePointerMove);
        }
      };

      target.addEventListener('pointermove', handlePointerMove);

      timerRef.current = setTimeout(() => {
        isLongPress.current = true;
        target.removeEventListener('pointermove', handlePointerMove);
        onLongPress();
      }, duration);
    },
    [duration, moveThreshold, onLongPress, clear],
  );

  const onPointerUp = useCallback(() => {
    clear();
  }, [clear]);

  const onPointerLeave = useCallback(() => {
    clear();
  }, [clear]);

  return { onPointerDown, onPointerUp, onPointerLeave, isLongPress };
}
