import { SubmissionForm } from '@/components/content/submission-form';
export default function SubmitJobPage() {
  return (
    <main className="page-shell form-page">
      <header>
        <p className="eyebrow">机会公示 / 03</p>
        <h1>发布校园工作</h1>
        <p>写明单位、地点和薪酬，帮助同学在申请前做出知情判断。</p>
      </header>
      <SubmissionForm kind="job" />
    </main>
  );
}
