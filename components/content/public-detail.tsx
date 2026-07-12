import Link from 'next/link';

import type { ContentRecord } from '@/lib/domain/content-service';
import type { PublicContentKind } from '@/lib/domain/public-content';

export function PublicDetail({
  item,
  kind,
}: {
  item: ContentRecord;
  kind: PublicContentKind;
}) {
  const description = String(item.summary ?? item.description ?? '');
  return (
    <main className="page-shell detail-page">
      <Link
        className="back-link"
        href={
          kind === 'resource'
            ? '/resources'
            : kind === 'marketplace'
              ? '/marketplace'
              : '/jobs'
        }
      >
        ← 返回公示列表
      </Link>
      <article className="detail-sheet">
        <header>
          <p className="eyebrow">已通过校园审核</p>
          <h1>{String(item.title)}</h1>
          <p className="detail-meta">
            {kind === 'resource'
              ? String(item.courseCode ?? '跨学科资源')
              : null}
            {kind === 'marketplace'
              ? `¥${(Number(item.priceCents) / 100).toFixed(2)} · ${String(item.condition)} · ${String(item.pickupArea)}`
              : null}
            {kind === 'job'
              ? `${String(item.company)} · ${String(item.location)} · ${String(item.payText)}`
              : null}
          </p>
        </header>
        <div className="prose-plain">
          <p>{description}</p>
        </div>
        {kind === 'marketplace' ? (
          <aside className="privacy-note">
            为保护发布者隐私，联系方式不会公开展示。联系请求功能将在受审计流程中开放。
          </aside>
        ) : null}
      </article>
    </main>
  );
}
