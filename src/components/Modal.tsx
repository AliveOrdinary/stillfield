import { useState, useEffect, useRef } from 'react';

export default function Modal() {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const triggers = document.querySelectorAll('[data-cta]');
    const handler = () => { setOpen(true); setSent(false); };
    triggers.forEach(t => t.addEventListener('click', handler));
    return () => triggers.forEach(t => t.removeEventListener('click', handler));
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      setTimeout(() => nameRef.current?.focus(), 340);
    } else {
      document.body.style.overflow = '';
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!fd.get('name') || !fd.get('email')) return;
    setSent(true);
  };

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="modal-backdrop open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modalTitle"
      onClick={handleBackdrop}
    >
      <div className={`modal${sent ? ' sent' : ''}`}>
        <button className="modal-close" onClick={() => setOpen(false)} aria-label="Close">&times;</button>

        {!sent && (
          <>
            <div className="kicker">— Register interest —</div>
            <h2 id="modalTitle">Be first to the quiet.</h2>
            <p className="modal-sub">Tell us where Stillfield belongs. We'll be in touch as pods become available for partners.</p>
            <form className="form" onSubmit={handleSubmit} noValidate>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="f-name">Name</label>
                  <input ref={nameRef} id="f-name" name="name" type="text" placeholder="Esme Hartwell" required autoComplete="name" />
                </div>
                <div className="field">
                  <label htmlFor="f-email">Email</label>
                  <input id="f-email" name="email" type="email" placeholder="you@domain.com" required autoComplete="email" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="f-org">Organisation</label>
                <input id="f-org" name="org" type="text" placeholder="Where it would live" autoComplete="organization" />
              </div>
              <div className="field">
                <label htmlFor="f-type">Setting</label>
                <select id="f-type" name="type">
                  <option>Spa</option>
                  <option>Wellness centre</option>
                  <option>Hotel</option>
                  <option>Workplace</option>
                  <option>Other</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-note">Anything else? <span style={{textTransform:'none',letterSpacing:0,color:'var(--ink-faint)' as React.CSSProperties['color']}}>(optional)</span></label>
                <textarea id="f-note" name="note" placeholder="Timing, number of pods, questions…" />
              </div>
              <button type="submit" className="modal-submit">Register interest <span aria-hidden="true">→</span></button>
              <p className="modal-foot">One message · no marketing lists</p>
            </form>
          </>
        )}

        {sent && (
          <div className="modal-success" role="status">
            <div className="success-mark" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3">
                <path d="M4 10.5l4 4 8-9"/>
              </svg>
            </div>
            <h3>Noted, with thanks.</h3>
            <p>We've got your details. We'll reach out personally as Stillfield pods open to partners.</p>
          </div>
        )}
      </div>
    </div>
  );
}
