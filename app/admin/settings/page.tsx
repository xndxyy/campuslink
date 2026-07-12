import { notFound } from 'next/navigation';

import { CampusSettingsForm } from '@/components/admin/campus-settings-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';

export default async function SettingsPage() {
  let campus: { allowedEmailDomain: string; name: string } | null = null;
  try {
    const user = await requireRole(['ADMIN']);
    campus = await getDb().campus.findFirst({
      select: { allowedEmailDomain: true, name: true },
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
        <p>
          Domain changes affect future account eligibility and are always
          audited.
        </p>
      </header>
      <CampusSettingsForm
        allowedEmailDomain={campus.allowedEmailDomain}
        name={campus.name}
      />
    </section>
  );
}
