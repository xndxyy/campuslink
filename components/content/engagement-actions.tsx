'use client';

import { type FormEvent, useRef, useState } from 'react';

type Kind = 'resource' | 'marketplace' | 'campus-work';
const targetTypes = {
  'campus-work': 'JOB_POST',
  marketplace: 'MARKETPLACE_ITEM',
  resource: 'RESOURCE',
} as const;

const englishReportReasons = [
  ['SPAM', 'Spam'],
  ['MISLEADING', 'Misleading information'],
  ['HARASSMENT', 'Harassment'],
  ['PROHIBITED', 'Prohibited content'],
  ['OTHER', 'Other'],
] as const;

const campusWorkReportReasons = [
  ['SPAM', '垃圾信息'],
  ['MISLEADING', '虚假或误导信息'],
  ['HARASSMENT', '骚扰行为'],
  ['PROHIBITED', '违规内容'],
  ['OTHER', '其他'],
] as const;

const engagementCopy = {
  resource: {
    addFavourite: 'Add favourite',
    ariaLabel: 'Community actions',
    cancel: 'Cancel',
    contactError: 'Unable to request contact.',
    contactLabel: 'Contact: ',
    contactSuccess: 'Contact access was recorded for community safety.',
    favouriteAdded: 'Saved to favourites.',
    favouriteError: 'Unable to update favourite.',
    favouriteRemoved: 'Removed from favourites.',
    optionalDetails: 'Optional details',
    ownerMarker: 'Owner listing',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Select a reason',
    removeFavourite: 'Remove favourite',
    reportBody: 'Reports are reviewed privately by the campus moderation team.',
    reportContent: 'Report content',
    reportError: 'Unable to submit report.',
    reportReasons: englishReportReasons,
    reportSuccess:
      'Report received. Thank you for helping the campus community.',
    reportTitle: 'Report this content',
    requestContact: 'Request contact',
    requestingContact: 'Requesting...',
    savingFavourite: 'Saving...',
    signedOutHint:
      'Sign in with a verified campus account to use these actions.',
    submitReport: 'Submit report',
    submittingReport: 'Submitting...',
  },
  marketplace: {
    addFavourite: 'Add favourite',
    ariaLabel: 'Community actions',
    cancel: 'Cancel',
    contactError: 'Unable to request contact.',
    contactLabel: 'Seller contact: ',
    contactSuccess: 'Contact access was recorded for community safety.',
    favouriteAdded: 'Saved to favourites.',
    favouriteError: 'Unable to update favourite.',
    favouriteRemoved: 'Removed from favourites.',
    optionalDetails: 'Optional details',
    ownerMarker: 'Owner listing',
    reasonLabel: 'Reason',
    reasonPlaceholder: 'Select a reason',
    removeFavourite: 'Remove favourite',
    reportBody: 'Reports are reviewed privately by the campus moderation team.',
    reportContent: 'Report content',
    reportError: 'Unable to submit report.',
    reportReasons: englishReportReasons,
    reportSuccess:
      'Report received. Thank you for helping the campus community.',
    reportTitle: 'Report this content',
    requestContact: 'Request contact',
    requestingContact: 'Requesting...',
    savingFavourite: 'Saving...',
    signedOutHint:
      'Sign in with a verified campus account to use these actions.',
    submitReport: 'Submit report',
    submittingReport: 'Submitting...',
  },
  'campus-work': {
    addFavourite: '收藏',
    ariaLabel: '校园工作互动操作',
    cancel: '取消',
    contactError: '无法获取联系方式，请稍后重试。',
    contactLabel: '联系方式：',
    contactSuccess: '联系方式访问已记录，请注意线下见面与付款安全。',
    favouriteAdded: '已收藏。',
    favouriteError: '收藏操作失败，请稍后重试。',
    favouriteRemoved: '已取消收藏。',
    optionalDetails: '补充说明（可选）',
    ownerMarker: '发布者本人',
    reasonLabel: '举报原因',
    reasonPlaceholder: '请选择原因',
    removeFavourite: '取消收藏',
    reportBody: '举报将由校园审核团队私下处理。',
    reportContent: '举报内容',
    reportError: '举报提交失败，请稍后重试。',
    reportReasons: campusWorkReportReasons,
    reportSuccess: '举报已提交，感谢你帮助维护校园社区。',
    reportTitle: '举报此内容',
    requestContact: '查看联系方式',
    requestingContact: '正在获取...',
    savingFavourite: '保存中...',
    signedOutHint: '请使用已验证的校园账号登录后使用这些操作。',
    submitReport: '提交举报',
    submittingReport: '提交中...',
  },
} as const;

async function responseMessage(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

export function canRequestContact({
  hasContact,
  isOwner,
  kind,
  signedIn,
}: {
  hasContact: boolean;
  isOwner: boolean;
  kind: Kind;
  signedIn: boolean;
}) {
  if (isOwner) return false;
  if (kind === 'marketplace') return true;
  return kind === 'campus-work' && hasContact && signedIn;
}

export function EngagementActions({
  hasContact = false,
  id,
  initialFavourited,
  isOwner,
  kind,
  signedIn,
}: {
  hasContact?: boolean;
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
  const copy = engagementCopy[kind];
  const targetType = targetTypes[kind];

  async function requestErrorMessage(response: Response, fallback: string) {
    return kind === 'campus-work'
      ? fallback
      : responseMessage(response, fallback);
  }

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
          await requestErrorMessage(response, copy.favouriteError),
        );
      setFavourited(!favourited);
      setMessage(favourited ? copy.favouriteRemoved : copy.favouriteAdded);
    } catch (error) {
      setMessage(
        kind !== 'campus-work' && error instanceof Error
          ? error.message
          : copy.favouriteError,
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
        throw new Error(await requestErrorMessage(response, copy.reportError));
      dialogRef.current?.close();
      formElement.reset();
      setMessage(copy.reportSuccess);
    } catch (error) {
      setMessage(
        kind !== 'campus-work' && error instanceof Error
          ? error.message
          : copy.reportError,
      );
    } finally {
      setPending(null);
    }
  }

  async function revealContact() {
    setPending('contact');
    setMessage(null);
    try {
      const contactKind =
        kind === 'campus-work' ? 'campus-work' : 'marketplace';
      const response = await fetch(
        `/api/${contactKind}/${encodeURIComponent(id)}/contact`,
        { method: 'POST' },
      );
      const body = (await response.json().catch(() => null)) as {
        contact?: unknown;
        message?: unknown;
      } | null;
      if (!response.ok || typeof body?.contact !== 'string') {
        throw new Error(
          kind !== 'campus-work' && typeof body?.message === 'string'
            ? body.message
            : copy.contactError,
        );
      }
      setContact(body.contact);
      setMessage(copy.contactSuccess);
    } catch (error) {
      setMessage(
        kind !== 'campus-work' && error instanceof Error
          ? error.message
          : copy.contactError,
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="engagement-panel" aria-label={copy.ariaLabel}>
      <div className="engagement-buttons">
        <button
          aria-pressed={favourited}
          disabled={pending !== null}
          onClick={changeFavourite}
          type="button"
        >
          {pending === 'favourite'
            ? copy.savingFavourite
            : favourited
              ? copy.removeFavourite
              : copy.addFavourite}
        </button>
        <button
          disabled={pending !== null}
          onClick={() => dialogRef.current?.showModal()}
          type="button"
        >
          {copy.reportContent}
        </button>
        {kind === 'marketplace' || kind === 'campus-work' ? (
          isOwner ? (
            <span className="owner-marker">{copy.ownerMarker}</span>
          ) : contact ? (
            <p className="revealed-contact" role="status">
              {copy.contactLabel}
              <strong>{contact}</strong>
            </p>
          ) : canRequestContact({
              hasContact,
              isOwner,
              kind,
              signedIn,
            }) ? (
            <button
              disabled={pending !== null}
              onClick={revealContact}
              type="button"
            >
              {pending === 'contact'
                ? copy.requestingContact
                : copy.requestContact}
            </button>
          ) : null
        ) : null}
      </div>
      {!signedIn ? <p className="action-hint">{copy.signedOutHint}</p> : null}
      {message ? (
        <p className="action-message" role="status">
          {message}
        </p>
      ) : null}
      <dialog aria-labelledby="report-dialog-title" ref={dialogRef}>
        <form className="report-form" onSubmit={submitReport}>
          <h2 id="report-dialog-title">{copy.reportTitle}</h2>
          <p>{copy.reportBody}</p>
          <label>
            {copy.reasonLabel}
            <select defaultValue="" name="reason" required>
              <option disabled value="">
                {copy.reasonPlaceholder}
              </option>
              {copy.reportReasons.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {copy.optionalDetails}
            <textarea maxLength={1000} name="details" rows={5} />
          </label>
          <div className="dialog-actions">
            <button disabled={pending === 'report'} type="submit">
              {pending === 'report' ? copy.submittingReport : copy.submitReport}
            </button>
            <button onClick={() => dialogRef.current?.close()} type="button">
              {copy.cancel}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
