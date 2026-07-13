import Link from 'next/link';

export const publishTypes = [
  {
    href: '/submit/resource',
    label: '学习资源',
    description: '笔记、讲义与课程资料',
  },
  {
    href: '/submit/marketplace',
    label: '二手交易',
    description: '书籍、设备与生活用品',
  },
  {
    href: '/submit/campus-work',
    label: '校园工作',
    description: '用标签说明具体工作类型',
  },
  {
    href: '/submit/forum',
    label: '论坛帖子',
    description: '话题讨论与校园互助',
  },
  {
    href: '/submit/tree-hole',
    label: '匿名树洞',
    description: '匿名表达，仅开放点赞与举报',
  },
] as const;

export function PublishTypeList() {
  return (
    <nav aria-label="发布类型" className="publish-type-list">
      {publishTypes.map((type, index) => (
        <Link href={type.href} key={type.href}>
          <span className="publish-type-number">
            {String(index + 1).padStart(2, '0')}
          </span>
          <span className="publish-type-copy">
            <strong>{type.label}</strong>
            <small>{type.description}</small>
          </span>
          <span aria-hidden="true" className="publish-type-arrow">
            →
          </span>
        </Link>
      ))}
    </nav>
  );
}
