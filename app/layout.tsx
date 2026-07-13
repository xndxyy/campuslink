import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { SiteBrand } from '@/components/brand/site-brand';

import './globals.css';

export const metadata: Metadata = {
  title: '西大同学 CampusLink',
  description: '经过审核的校园知识、市集与机会公告板。',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="zh-CN">
      <body>
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <header className="site-header">
          <SiteBrand />
          <nav aria-label="主导航">
            <Link href="/resources">资源</Link>
            <Link href="/marketplace">市集</Link>
            <Link href="/jobs">工作</Link>
            <Link href="/me/submissions">我的提交</Link>
            <Link href="/me/favourites">Favourites</Link>
          </nav>
          <Link className="header-action" href="/submit/resource">
            发布内容
          </Link>
        </header>
        <div id="main-content">{children}</div>
        <footer className="site-footer">
          <strong>西大同学 CampusLink</strong>
          <p>
            本站为学生社区，非西南大学官方平台。校园内容经审核后公开，请尊重知识、隐私与彼此。
          </p>
        </footer>
      </body>
    </html>
  );
}
