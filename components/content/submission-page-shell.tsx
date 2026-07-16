import type { ReactNode } from 'react';

import { PublishCategoryTabs } from './publish-category-tabs';

export function SubmissionPageShell({
  activeHref,
  children,
  eyebrow,
  title,
}: {
  activeHref: string;
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="page-shell form-page">
      <header className="publish-workspace-header">
        <p className="eyebrow">发布中心</p>
        <h1>发布内容</h1>
      </header>
      <PublishCategoryTabs activeHref={activeHref} />
      <section className="publish-form-area">
        <header className="publish-form-heading">
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </header>
        {children}
      </section>
    </main>
  );
}
