import { notFound } from 'next/navigation';
import { AiSettingsForm } from '@/components/admin/ai-settings-form';
import { requireRole } from '@/lib/auth/guards';
import { getDb } from '@/lib/db';
import {
  getAiSettings,
  type AiSettingsAdapter,
} from '@/lib/domain/ai-settings';

const defaults = {
  baseUrl: '',
  blockThreshold: 80,
  enabled: false,
  model: '',
  reviewThreshold: 40,
  timeoutMs: 8000,
};
export default async function AiSettingsPage() {
  let actor;
  try {
    const user = await requireRole(['ADMIN']);
    actor = { campusId: user.campusId, id: user.id, role: user.role };
  } catch {
    notFound();
  }
  let initial = defaults;
  let unavailable = false;
  try {
    initial =
      (await getAiSettings(getDb() as unknown as AiSettingsAdapter, actor)) ??
      defaults;
  } catch {
    unavailable = true;
  }
  return (
    <section>
      <header className="admin-masthead">
        <p className="eyebrow">仅管理员可用</p>
        <h2>AI 审核设置</h2>
        <p>配置 OpenAI 兼容模型。密钥加密保存，页面仅显示后四位。</p>
      </header>
      {unavailable ? (
        <div className="empty-state error-state">
          <h2>AI 设置暂时不可用</h2>
          <p>请检查数据库连接后重试。</p>
        </div>
      ) : (
        <AiSettingsForm initial={initial} />
      )}
    </section>
  );
}
