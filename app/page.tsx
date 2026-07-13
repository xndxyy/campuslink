import Link from 'next/link';
import { CategoryStrip } from '@/components/home/category-strip';

export default function HomePage() {
  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">西大学生社区 · 2026</p>
          <h1>
            让知识、物品与互助，<em>在校园里持续流动。</em>
          </h1>
          <p>
            CampusLink
            是面向西大学子的校园公共空间。公开内容经过审核，匿名树洞也为表达保留边界。
          </p>
          <div className="hero-actions">
            <Link href="/resources">浏览校园内容</Link>
            <Link href="/submit">发布内容</Link>
          </div>
        </div>
        <aside>
          <span>今日栏目</span>
          <strong>04</strong>
          <p>
            学习资源
            <br />
            二手交易
            <br />
            校园工作
            <br />
            校园论坛
          </p>
        </aside>
      </section>
      <CategoryStrip />
    </main>
  );
}
