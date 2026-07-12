import { SubmissionForm } from '@/components/content/submission-form';
export default function SubmitResourcePage() {
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">知识共享 / 01</p>
        <h1>提交学习资源</h1>
        <p>上传至少一份文档。所有内容在公开前都会由校园审核员检查。</p>
      </header>
      <SubmissionForm kind="resource" />
    </main>
  );
}
