import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';

import { SiteBrand } from '@/components/brand/site-brand';

import './globals.css';

export const metadata: Metadata = {
  title: '西大同学 CampusLink',
  description: '校园学习资源、二手交易、校园工作与论坛社区。',
  icons: { icon: '/brand/campuslink-icon.png' },
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
          <div className="header-scroll-region">
            <div className="header-navigation">
              <SiteBrand />
              <nav aria-label="全站导航" className="site-navigation">
                <Link href="/resources">学习资源</Link>
                <Link href="/marketplace">二手交易</Link>
                <Link href="/campus-work">校园工作</Link>
                <Link href="/forum">校园论坛</Link>
                <Link
                  className="utility-navigation-link"
                  href="/me/submissions"
                >
                  我的发布
                </Link>
                <Link className="utility-navigation-link" href="/me/favourites">
                  我的收藏
                </Link>
                <Link className="header-action" href="/submit">
                  发布内容
                </Link>
              </nav>
            </div>
          </div>
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
