import * as React from 'react';

interface ToastState {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
  open: boolean;
}

type ToastAction =
  | { type: 'ADD'; toast: Omit<ToastState, 'open'> }
  | { type: 'DISMISS'; id: string }
  | { type: 'REMOVE'; id: string };

const TOAST_LIMIT = 3;
const TOAST_REMOVE_DELAY = 3000;

let count = 0;
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER;
  return count.toString();
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function reducer(state: ToastState[], action: ToastAction): ToastState[] {
  switch (action.type) {
    case 'ADD':
      return [{ ...action.toast, open: true }, ...state].slice(0, TOAST_LIMIT);
    case 'DISMISS':
      return state.map(t => (t.id === action.id ? { ...t, open: false } : t));
    case 'REMOVE':
      return state.filter(t => t.id !== action.id);
  }
}

const listeners: Array<(state: ToastState[]) => void> = [];
let memoryState: ToastState[] = [];

function dispatch(action: ToastAction) {
  memoryState = reducer(memoryState, action);
  listeners.forEach(l => l(memoryState));
}

function addToRemoveQueue(id: string) {
  if (toastTimeouts.has(id)) return;
  const timeout = setTimeout(() => {
    toastTimeouts.delete(id);
    dispatch({ type: 'REMOVE', id });
  }, TOAST_REMOVE_DELAY);
  toastTimeouts.set(id, timeout);
}

export function toast(props: { title?: string; description?: string; variant?: 'default' | 'destructive' }) {
  const id = genId();
  dispatch({ type: 'ADD', toast: { id, ...props } });
  setTimeout(() => {
    dispatch({ type: 'DISMISS', id });
    addToRemoveQueue(id);
  }, 4000);
  return id;
}

export function useToast() {
  const [state, setState] = React.useState<ToastState[]>(memoryState);

  React.useEffect(() => {
    listeners.push(setState);
    return () => {
      const idx = listeners.indexOf(setState);
      if (idx > -1) listeners.splice(idx, 1);
    };
  }, []);

  return { toasts: state, toast };
}
