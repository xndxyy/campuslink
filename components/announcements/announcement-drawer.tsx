'use client';

import { useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { PublicAnnouncement } from '@/lib/domain/announcement-queries';

export function AnnouncementDrawer({
  announcement,
}: {
  announcement: PublicAnnouncement;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    headingRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [announcement.id]);

  const imageSource = announcement.coverAssetId
    ? `/api/assets/${announcement.coverAssetId}/read`
    : '/brand/campuslink-mark-light.png';

  return (
    <dialog
      aria-labelledby="announcement-detail-title"
      className="announcement-drawer"
      onCancel={(event) => {
        event.preventDefault();
        router.push('/announcements');
      }}
      ref={dialogRef}
    >
      <header className="announcement-drawer-header">
        <div>
          <p className="eyebrow">
            {announcement.isPinned ? '置顶公告' : '校园公告'}
          </p>
          <h2 id="announcement-detail-title" ref={headingRef} tabIndex={-1}>
            {announcement.title}
          </h2>
        </div>
        <Link aria-label="关闭公告详情" href="/announcements">
          关闭
        </Link>
      </header>
      <div className="announcement-cover">
        <Image
          alt={`公告“${announcement.title}”的封面`}
          height={675}
          sizes="(max-width: 760px) 100vw, 600px"
          src={imageSource}
          unoptimized={Boolean(announcement.coverAssetId)}
          width={1200}
        />
      </div>
      <div className="announcement-drawer-content">
        <time dateTime={announcement.publishedAt.toISOString()}>
          发布于 {announcement.publishedAt.toLocaleDateString('zh-CN')}
        </time>
        <p className="announcement-body">{announcement.body}</p>
      </div>
    </dialog>
  );
}
