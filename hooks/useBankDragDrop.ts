'use client';

import { useCallback, useRef, useState } from 'react';

// ----- Types -----

export interface DragItem {
  id: string;
  type: 'bank' | 'folder';
}

export interface DragOverlay {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
}

export interface DropTarget {
  id: string;
  type: 'bank' | 'folder';
}

export type DropResult =
  | { kind: 'bank-on-bank'; dragId: string; targetId: string }
  | { kind: 'bank-on-folder'; bankId: string; folderId: string }
  | { kind: 'reorder'; dragItem: DragItem; targetItem: DragItem }
  | null;

interface UseBankDragDropOptions {
  onDrop: (result: NonNullable<DropResult>) => void;
}

interface UseBankDragDropReturn {
  /** The item currently being dragged */
  dragItem: DragItem | null;
  /** Current pointer position for the drag overlay */
  overlay: DragOverlay | null;
  /** The current drop target being hovered */
  dropTarget: DropTarget | null;
  /** Start dragging an item -- attach to onPointerDown on drag handles */
  startDrag: (item: DragItem, e: React.PointerEvent) => void;
  /** Track pointer movement -- attach to the grid container */
  onPointerMove: (e: React.PointerEvent) => void;
  /** End the drag -- attach to the grid container onPointerUp */
  onPointerUp: (e: React.PointerEvent) => void;
  /** Cancel drag on pointer leave */
  onPointerLeave: (e: React.PointerEvent) => void;
  /** Register a card element as a potential drop target */
  registerTarget: (id: string, type: 'bank' | 'folder', el: HTMLElement | null) => void;
  /** Whether any drag is in progress */
  isDragging: boolean;
}

export function useBankDragDrop({ onDrop }: UseBankDragDropOptions): UseBankDragDropReturn {
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [overlay, setOverlay] = useState<DragOverlay | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Map of id -> { type, element }
  const targetsRef = useRef<Map<string, { type: 'bank' | 'folder'; el: HTMLElement }>>(new Map());
  const dragItemRef = useRef<DragItem | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const hasMoved = useRef(false);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const moveListenerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const upListenerRef = useRef<((e: PointerEvent) => void) | null>(null);

  const registerTarget = useCallback(
    (id: string, type: 'bank' | 'folder', el: HTMLElement | null) => {
      if (el) {
        targetsRef.current.set(id, { type, el });
      } else {
        targetsRef.current.delete(id);
      }
    },
    [],
  );

  const findDropTarget = useCallback(
    (clientX: number, clientY: number): DropTarget | null => {
      for (const [id, { type, el }] of targetsRef.current.entries()) {
        // Don't let an item be its own drop target
        if (dragItemRef.current && id === dragItemRef.current.id) continue;
        const rect = el.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return { id, type };
        }
      }
      return null;
    },
    [],
  );

  const cleanupGlobalListeners = useCallback(() => {
    if (moveListenerRef.current) {
      window.removeEventListener('pointermove', moveListenerRef.current);
      moveListenerRef.current = null;
    }
    if (upListenerRef.current) {
      window.removeEventListener('pointerup', upListenerRef.current);
      upListenerRef.current = null;
    }
  }, []);

  const applyPointerMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragItemRef.current || !startPosRef.current) return;

      const dx = clientX - startPosRef.current.x;
      const dy = clientY - startPosRef.current.y;

      // Only start showing drag after 5px movement
      if (!hasMoved.current && Math.sqrt(dx * dx + dy * dy) < 5) return;

      if (!hasMoved.current) {
        hasMoved.current = true;
        setDragItem(dragItemRef.current);
      }

      setOverlay({
        x: clientX,
        y: clientY,
        offsetX: dx,
        offsetY: dy,
      });

      const target = findDropTarget(clientX, clientY);
      dropTargetRef.current = target;
      setDropTarget(target);
    },
    [findDropTarget],
  );

  const finishDrag = useCallback((clientX?: number, clientY?: number) => {
    const currentTarget =
      clientX !== undefined && clientY !== undefined
        ? findDropTarget(clientX, clientY)
        : dropTargetRef.current;
    dropTargetRef.current = currentTarget;
    if (dragItemRef.current && hasMoved.current && currentTarget) {
      const drag = dragItemRef.current;
      let result: DropResult = null;

      if (drag.type === 'bank' && currentTarget.type === 'bank') {
        result = { kind: 'bank-on-bank', dragId: drag.id, targetId: currentTarget.id };
      } else if (drag.type === 'bank' && currentTarget.type === 'folder') {
        result = { kind: 'bank-on-folder', bankId: drag.id, folderId: currentTarget.id };
      } else {
        // folder-on-folder, folder-on-bank, or any other reorder scenario
        result = { kind: 'reorder', dragItem: drag, targetItem: currentTarget };
      }

      if (result) {
        onDrop(result);
      }
    }

    dragItemRef.current = null;
    dropTargetRef.current = null;
    hasMoved.current = false;
    startPosRef.current = null;
    setDragItem(null);
    setOverlay(null);
    setDropTarget(null);
    cleanupGlobalListeners();
  }, [onDrop, cleanupGlobalListeners, findDropTarget]);

  const startDrag = useCallback((item: DragItem, e: React.PointerEvent) => {
    dragItemRef.current = item;
    hasMoved.current = false;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    // We set drag state once the pointer has moved enough (> 5px)
    // so a simple tap doesn't trigger drag UI
    setOverlay({
      x: e.clientX,
      y: e.clientY,
      offsetX: 0,
      offsetY: 0,
    });

    // Track the pointer globally so drags don't cancel when leaving grid bounds.
    cleanupGlobalListeners();
    moveListenerRef.current = (event: PointerEvent) => {
      applyPointerMove(event.clientX, event.clientY);
    };
    upListenerRef.current = (event: PointerEvent) => {
      finishDrag(event.clientX, event.clientY);
    };
    window.addEventListener('pointermove', moveListenerRef.current);
    window.addEventListener('pointerup', upListenerRef.current, { once: true });
  }, [applyPointerMove, cleanupGlobalListeners, finishDrag]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      applyPointerMove(e.clientX, e.clientY);
    },
    [applyPointerMove],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      finishDrag(e.clientX, e.clientY);
    },
    [finishDrag],
  );

  const onPointerLeave = useCallback(
    () => {},
    [],
  );

  return {
    dragItem,
    overlay,
    dropTarget,
    startDrag,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    registerTarget,
    isDragging: dragItem !== null,
  };
}
