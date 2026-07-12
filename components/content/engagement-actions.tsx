'use client';

import { type FormEvent, useRef, useState } from 'react';

type Kind = 'resource' | 'marketplace' | 'job';
const targetTypes = {
  job: 'JOB_POST',
  marketplace: 'MARKETPLACE_ITEM',
  resource: 'RESOURCE',
} as const;

async function responseMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

export function EngagementActions({
  id,
  initialFavourited,
  isOwner,
  kind,
  signedIn,
}: {
  id: string;
  initialFavourited: boolean;
  isOwner: boolean;
  kind: Kind;
  signedIn: boolean;
}) {
  const [favourited, setFavourited] = useState(initialFavourited);
  const [contact, setContact] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<
    'contact' | 'favourite' | 'report' | null
  >(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const targetType = targetTypes[kind];

  async function changeFavourite() {
    setPending('favourite');
    setMessage(null);
    try {
      const response = await fetch('/api/favourites', {
        body: JSON.stringify({ targetId: id, targetType }),
        headers: { 'Content-Type': 'application/json' },
        method: favourited ? 'DELETE' : 'POST',
      });
      if (!response.ok)
        throw new Error(
          await responseMessage(response, 'Unable to update favourite.'),
        );
      setFavourited(!favourited);
      setMessage(
        favourited ? 'Removed from favourites.' : 'Saved to favourites.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to update favourite.',
      );
    } finally {
      setPending(null);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending('report');
    setMessage(null);
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/reports', {
        body: JSON.stringify({
          details: String(form.get('details') ?? '').trim() || undefined,
          reason: String(form.get('reason') ?? ''),
          targetId: id,
          targetType,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok)
        throw new Error(
          await responseMessage(response, 'Unable to submit report.'),
        );
      dialogRef.current?.close();
      formElement.reset();
      setMessage(
        'Report received. Thank you for helping the campus community.',
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to submit report.',
      );
    } finally {
      setPending(null);
    }
  }

  async function revealContact() {
    setPending('contact');
    setMessage(null);
    try {
      const response = await fetch(
        `/api/marketplace/${encodeURIComponent(id)}/contact`,
        { method: 'POST' },
      );
      const body = (await response.json().catch(() => null)) as {
        contact?: unknown;
        message?: unknown;
      } | null;
      if (!response.ok || typeof body?.contact !== 'string') {
        throw new Error(
          typeof body?.message === 'string'
            ? body.message
            : 'Unable to request contact.',
        );
      }
      setContact(body.contact);
      setMessage('Contact access was recorded for community safety.');
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Unable to request contact.',
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="engagement-panel" aria-label="Community actions">
      <div className="engagement-buttons">
        <button
          aria-pressed={favourited}
          disabled={pending !== null}
          onClick={changeFavourite}
          type="button"
        >
          {pending === 'favourite'
            ? 'Saving…'
            : favourited
              ? 'Remove favourite'
              : 'Add favourite'}
        </button>
        <button
          disabled={pending !== null}
          onClick={() => dialogRef.current?.showModal()}
          type="button"
        >
          Report content
        </button>
        {kind === 'marketplace' ? (
          isOwner ? (
            <span className="owner-marker">Owner listing</span>
          ) : contact ? (
            <p className="revealed-contact" role="status">
              Seller contact: <strong>{contact}</strong>
            </p>
          ) : (
            <button
              disabled={pending !== null}
              onClick={revealContact}
              type="button"
            >
              {pending === 'contact' ? 'Requesting…' : 'Request contact'}
            </button>
          )
        ) : null}
      </div>
      {!signedIn ? (
        <p className="action-hint">
          Sign in with a verified campus account to use these actions.
        </p>
      ) : null}
      {message ? (
        <p className="action-message" role="status">
          {message}
        </p>
      ) : null}
      <dialog aria-labelledby="report-dialog-title" ref={dialogRef}>
        <form className="report-form" onSubmit={submitReport}>
          <h2 id="report-dialog-title">Report this content</h2>
          <p>Reports are reviewed privately by the campus moderation team.</p>
          <label>
            Reason
            <select defaultValue="" name="reason" required>
              <option disabled value="">
                Select a reason
              </option>
              <option value="SPAM">Spam</option>
              <option value="MISLEADING">Misleading information</option>
              <option value="HARASSMENT">Harassment</option>
              <option value="PROHIBITED">Prohibited content</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            Optional details
            <textarea maxLength={1000} name="details" rows={5} />
          </label>
          <div className="dialog-actions">
            <button disabled={pending === 'report'} type="submit">
              {pending === 'report' ? 'Submitting…' : 'Submit report'}
            </button>
            <button onClick={() => dialogRef.current?.close()} type="button">
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
