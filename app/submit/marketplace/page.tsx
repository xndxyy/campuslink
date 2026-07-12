import { SubmissionForm } from '@/components/content/submission-form';
export default function SubmitMarketplacePage() {
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">循环市集 / 02</p>
        <h1>发布二手物品</h1>
        <p>
          清楚描述物品与取货区域。联系方式只保存于受保护记录，不会公开展示。
        </p>
      </header>
      <SubmissionForm kind="marketplace" />
    </main>
  );
}
