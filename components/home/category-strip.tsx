import Link from 'next/link';

const categories = [
  {
    href: '/resources',
    label: '学习资源',
    number: '01',
    summary: '笔记 · 讲义 · 课程资料',
  },
  {
    href: '/marketplace',
    label: '二手交易',
    number: '02',
    summary: '书籍 · 设备 · 生活用品',
  },
  {
    href: '/campus-work',
    label: '校园工作',
    number: '03',
    summary: '预设标签与自定义标签表达具体类型',
  },
  {
    href: '/forum',
    label: '校园论坛',
    number: '04',
    summary: '话题讨论 · 校园互助 · 匿名树洞',
  },
] as const;

export function CategoryStrip() {
  return (
    <nav aria-label="校园内容分区" className="category-strip">
      {categories.map((category) => (
        <Link href={category.href} key={category.href}>
          <b>{category.number}</b>
          <span>{category.label}</span>
          <small>{category.summary}</small>
        </Link>
      ))}
    </nav>
  );
}
