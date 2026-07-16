import Link from 'next/link';

import { publishTypes } from './publish-type-list';

export function PublishCategoryTabs({ activeHref }: { activeHref: string }) {
  return (
    <nav aria-label="发布分类" className="publish-category-tabs">
      {publishTypes.map((type) => (
        <Link
          aria-current={type.href === activeHref ? 'page' : undefined}
          href={type.href}
          key={type.href}
        >
          <strong>{type.label}</strong>
          <span>{type.description}</span>
        </Link>
      ))}
    </nav>
  );
}
