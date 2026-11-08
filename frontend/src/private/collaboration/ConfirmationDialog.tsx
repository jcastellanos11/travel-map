import { useEffect, useId, useRef } from 'react';

export default function ConfirmationDialog({ title, message, pending, confirm, cancel }: {
  title: string; message: string; pending: boolean; confirm(): void; cancel(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), safeCancel = useRef<HTMLButtonElement>(null), id = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current; if (element && !element.open) element.showModal();
    safeCancel.current?.focus();
    return () => { element?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={dialog} className="collaboration-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-message`} onCancel={event => { event.preventDefault(); if (!pending) cancel(); }}>
    <h2 id={`${id}-title`}>{title}</h2><p id={`${id}-message`}>{message}</p>
    <div className="action-row"><button ref={safeCancel} disabled={pending} onClick={cancel}>Cancel</button><button disabled={pending} onClick={confirm}>{pending ? 'Waiting for server…' : 'Confirm'}</button></div>
  </dialog>;
}
