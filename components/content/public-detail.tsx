import Link from 'next/link';
import Image from 'next/image';

import type { ContentRecord } from '@/lib/domain/content-service';
import {
  contentTagsForPresentation,
  type PublicContentKind,
} from '@/lib/domain/public-content';
import { EngagementActions } from './engagement-actions';

export function documentAccessLink(assetId: string, canDownload: boolean) {
  return canDownload
    ? { href: `/api/assets/${assetId}/read`, label: '下载文档' }
    : { href: '/auth/sign-in', label: '登录后下载文档' };
}

export function PublicDetail({
  item,
  kind,
  canDownloadDocuments = false,
  engagement,
}: {
  canDownloadDocuments?: boolean;
  engagement?: {
    initialFavourited: boolean;
    isOwner: boolean;
    signedIn: boolean;
  };
  item: ContentRecord;
  kind: PublicContentKind;
}) {
  const description = String(item.summary ?? item.description ?? '');
  const tags = contentTagsForPresentation(item);
  const author = (item.author ?? item.seller) as { name?: unknown } | undefined;
  const assets = Array.isArray(item.assets)
    ? (item.assets as Array<{ contentType: string; id: string; kind: string }>)
    : [];
  return (
    <main className="page-shell detail-page">
      <Link
        className="back-link"
        href={
          kind === 'resource'
            ? '/resources'
            : kind === 'marketplace'
              ? '/marketplace'
              : '/campus-work'
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
            {kind === 'campus-work'
              ? `${String(item.location)} · ${String(item.payText)}`
              : null}
          </p>
          <p className="author-line">
            发布者：{String(author?.name ?? '校园成员')}
          </p>
          {tags.length > 0 ? (
            <ul className="content-tag-list" aria-label="内容标签">
              {tags.map((tag) => (
                <li
                  className={tag.isActive ? undefined : 'is-inactive'}
                  key={tag.id}
                  title={tag.isActive ? undefined : '历史标签（已停用）'}
                >
                  {tag.label}
                </li>
              ))}
            </ul>
          ) : null}
        </header>
        {assets.some((asset) => asset.kind.endsWith('_IMAGE')) ? (
          <div className="asset-gallery">
            {assets
              .filter((asset) => asset.kind.endsWith('_IMAGE'))
              .map((asset) => (
                <Image
                  alt={`${String(item.title)} 配图`}
                  height={720}
                  key={asset.id}
                  src={`/api/assets/${asset.id}/read`}
                  unoptimized
                  width={1080}
                />
              ))}
          </div>
        ) : null}
        <div className="prose-plain">
          <p>{description}</p>
        </div>
        {engagement ? (
          <EngagementActions
            hasContact={kind !== 'campus-work' || item.hasContact === true}
            id={item.id}
            kind={kind}
            {...engagement}
          />
        ) : null}
        {assets.some((asset) => asset.kind === 'RESOURCE_DOCUMENT') ? (
          <section className="asset-downloads" aria-label="资源附件">
            <h2>资源附件</h2>
            {assets
              .filter((asset) => asset.kind === 'RESOURCE_DOCUMENT')
              .map((asset, index) => {
                const access = documentAccessLink(
                  asset.id,
                  canDownloadDocuments,
                );
                return (
                  <Link href={access.href} key={asset.id}>
                    {access.label} {index + 1} · {asset.contentType}
                  </Link>
                );
              })}
          </section>
        ) : null}
        {kind === 'marketplace' && !engagement ? (
          <aside className="privacy-note">
            为保护发布者隐私，联系方式不会公开展示。联系请求功能将在受审计流程中开放。
          </aside>
        ) : null}
        {kind === 'campus-work' ? (
          <aside className="privacy-note" aria-label="校园工作安全提示">
            <p>建议在公共场所见面。</p>
            <p>不要提前付款。</p>
            <p>平台不提供资金托管或担保。</p>
          </aside>
        ) : null}
      </article>
    </main>
  );
}
