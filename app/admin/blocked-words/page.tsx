import { notFound } from 'next/navigation';

import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  listBlockedWords,
  type BlockedWordAdapter,
} from '@/lib/domain/blocked-words';
import { BlockedWordManagement } from '@/components/admin/blocked-word-management';

export default async function BlockedWordsPage() {
  let actor;
  try {
    const user = await requireRole(['ADMIN']);
    actor = { campusId: user.campusId, id: user.id, role: user.role };
  } catch {
    notFound();
  }

  let items: Awaited<ReturnType<typeof listBlockedWords>> = [];
  let unavailable = false;
  try {
    items = await listBlockedWords(
      getDb() as unknown as BlockedWordAdapter,
      actor,
    );
  } catch {
    unavailable = true;
  }

  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">仅管理员可用</p>
        <h2>屏蔽词管理</h2>
        <p>
          本地规则会在内容发送到 AI 前生效。词条仅支持纯文本，永久删除不可恢复。
        </p>
      </header>
      {unavailable ? (
        <div className="empty-state error-state">
          <h2>屏蔽词列表暂时不可用</h2>
          <p>请检查数据库连接后重试。</p>
        </div>
      ) : (
        <BlockedWordManagement items={items} />
      )}
    </section>
  );
}
