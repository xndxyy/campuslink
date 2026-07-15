'use client';
import { useState, type FormEvent } from 'react';

type Settings = {
  apiKeyLastFour?: string;
  baseUrl: string;
  blockThreshold: number;
  enabled: boolean;
  model: string;
  reviewThreshold: number;
  timeoutMs: number;
};
export function AiSettingsForm({ initial }: { initial: Settings }) {
  const [form, setForm] = useState(initial);
  const [apiKey, setApiKey] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  function field<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const response = await fetch('/api/admin/ai-settings', {
      body: JSON.stringify({ ...form, ...(apiKey ? { apiKey } : {}), reason }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    setMessage(
      response.ok
        ? 'AI 审核设置已保存。'
        : '保存失败，请检查地址、阈值和密钥。',
    );
    if (response.ok) {
      setApiKey('');
      setReason('');
    }
  }
  async function testConnection() {
    const response = await fetch('/api/admin/ai-settings/test', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    setMessage(response.ok ? '连接测试成功。' : '连接测试失败。');
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <label>
        <input
          checked={form.enabled}
          onChange={(event) => field('enabled', event.target.checked)}
          type="checkbox"
        />
        启用 AI 审核
      </label>
      <label>
        API 请求地址
        <input
          name="baseUrl"
          onChange={(event) => field('baseUrl', event.target.value)}
          required
          type="url"
          value={form.baseUrl}
        />
      </label>
      <label>
        模型
        <input
          name="model"
          onChange={(event) => field('model', event.target.value)}
          required
          value={form.model}
        />
      </label>
      <label>
        API Key
        {form.apiKeyLastFour ? (
          <span>当前结尾：{form.apiKeyLastFour}</span>
        ) : null}
        <input
          autoComplete="new-password"
          name="apiKey"
          onChange={(event) => setApiKey(event.target.value)}
          type="password"
          value={apiKey}
        />
      </label>
      <label>
        人工复核阈值
        <input
          name="reviewThreshold"
          onChange={(event) =>
            field('reviewThreshold', Number(event.target.value))
          }
          type="number"
          value={form.reviewThreshold}
        />
      </label>
      <label>
        自动拦截阈值
        <input
          name="blockThreshold"
          onChange={(event) =>
            field('blockThreshold', Number(event.target.value))
          }
          type="number"
          value={form.blockThreshold}
        />
      </label>
      <label>
        超时（毫秒）
        <input
          name="timeoutMs"
          onChange={(event) => field('timeoutMs', Number(event.target.value))}
          type="number"
          value={form.timeoutMs}
        />
      </label>
      <label>
        治理原因
        <textarea
          minLength={5}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </label>
      <button type="submit">保存设置</button>
      <button onClick={() => void testConnection()} type="button">
        测试连接
      </button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  );
}
