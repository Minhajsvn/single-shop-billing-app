"use client";

import { useRef } from "react";

// Opens the 20-second tour in a native dialog (focus trap and Escape come with <dialog>).
export function TourButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  function open() {
    dialog.current?.showModal();
    video.current?.play().catch(() => {});
  }

  function close() {
    video.current?.pause();
    dialog.current?.close();
  }

  return (
    <>
      <button type="button" className="lp-link" onClick={open}>
        Watch the 20-second tour
      </button>
      <dialog ref={dialog} className="tour" aria-label="billo tour" onClose={() => video.current?.pause()} onClick={(event) => event.target === dialog.current && close()}>
        <video ref={video} src="/media/teaser.mp4" poster="/media/teaser.jpg" controls playsInline preload="none" width={1280} height={720} />
        <button type="button" className="tour-close" onClick={close}>Close</button>
      </dialog>
    </>
  );
}
