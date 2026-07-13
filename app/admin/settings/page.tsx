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
        <p className="eyebrow">Administrator only</p>
        <h2>Campus identity</h2>
        <p>Campus identity changes are always audited.</p>
      </header>
      <CampusSettingsForm name={campus.name} />
    </section>
  );
}
