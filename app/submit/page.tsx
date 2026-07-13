import { PublishTypeList } from '@/components/content/publish-type-list';

export default function SubmitPage() {
  return (
    <main className="page-shell publish-center">
      <header className="publish-masthead">
        <p className="eyebrow">发布中心 / PUBLISH</p>
        <h1>选择发布类型</h1>
      </header>
      <PublishTypeList />
    </main>
  );
}
