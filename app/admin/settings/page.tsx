import { notFound } from 'next/navigation';

import { CampusSettingsForm } from '@/components/admin/campus-settings-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';

export default async function SettingsPage() {
  let campus: { name: string } | null = null;
  try {
    const user = await requireRole(['ADMIN']);
    campus = await getDb().campus.findFirst({
      select: { name: true },
      where: { id: user.campusId },
    });
  } catch {
    notFound();
  }
  if (!campus) notFound();
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">仅管理员可用</p>
        <h2>校区信息</h2>
        <p>校区信息的每次变更都会写入审计日志。</p>
      </header>
      <CampusSettingsForm name={campus.name} />
    </section>
  );
}
