import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as engagementActions from '@/components/content/engagement-actions';

const source = readFileSync(
  fileURLToPath(
    new URL('../../components/content/engagement-actions.tsx', import.meta.url),
  ),
  'utf8',
);

describe('published detail engagement UI', () => {
  it('offers CampusWork contact only when a signed-in non-owner has contact available', () => {
    const canRequestContact = (
      engagementActions as unknown as {
        canRequestContact?: (input: {
          hasContact: boolean;
          isOwner: boolean;
          kind: 'campus-work' | 'marketplace' | 'resource';
          signedIn: boolean;
        }) => boolean;
      }
    ).canRequestContact;
    expect(canRequestContact).toBeTypeOf('function');
    if (!canRequestContact) return;

    expect(
      canRequestContact({
        hasContact: true,
        isOwner: false,
        kind: 'campus-work',
        signedIn: true,
      }),
    ).toBe(true);
    for (const input of [
      { hasContact: false, isOwner: false, signedIn: true },
      { hasContact: true, isOwner: false, signedIn: false },
      { hasContact: true, isOwner: true, signedIn: true },
    ]) {
      expect(canRequestContact({ ...input, kind: 'campus-work' })).toBe(false);
    }
  });

  it('provides accessible favourite, report dialog, and contact controls', () => {
    expect(source).toContain('aria-pressed');
    expect(source).toContain('<dialog');
    expect(source).toContain('aria-labelledby');
    expect(source).toContain('查看联系方式');
    expect(source).toContain('发布者本人');
  });

  it('keeps revealed contact ephemeral', () => {
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/URLSearchParams|history\.pushState/);
    expect(source).toMatch(/useState<string \| null>\(null\)/);
  });

  it('sends only strict target identity and report fields', () => {
    expect(source).not.toMatch(/userId\s*:/);
    expect(source).not.toMatch(/ownerId\s*:/);
    expect(source).not.toMatch(/assigneeId\s*:/);
    expect(source).toContain("'/api/favourites'");
    expect(source).toContain("'/api/reports'");
  });

  it('captures the report form before awaiting and resets the captured element', () => {
    const submit = source.indexOf('async function submitReport');
    const capture = source.indexOf(
      'const formElement = event.currentTarget;',
      submit,
    );
    const firstAwait = source.indexOf('await ', submit);

    expect(capture).toBeGreaterThan(submit);
    expect(capture).toBeLessThan(firstAwait);
    expect(source).toContain('new FormData(formElement)');
    expect(source).toContain('formElement.reset()');
    expect(source).not.toContain('event.currentTarget.reset()');
  });

  it('localizes the entire CampusWork engagement panel in Chinese', () => {
    expect(source).toContain('const copy = engagementCopy[kind]');
    expect(source).toContain("addFavourite: '收藏'");
    expect(source).toContain("removeFavourite: '取消收藏'");
    expect(source).toContain("savingFavourite: '保存中...' ".trim());
    expect(source).toContain("favouriteAdded: '已收藏。'");
    expect(source).toContain("favouriteRemoved: '已取消收藏。'");
    expect(source).toContain("favouriteError: '收藏操作失败，请稍后重试。'");
    expect(source).toContain("reportContent: '举报内容'");
    expect(source).toContain(
      "reportSuccess: '举报已提交，感谢你帮助维护校园社区。'",
    );
    expect(source).toContain("reportError: '举报提交失败，请稍后重试。'");
    expect(source).toContain("contactLabel: '联系方式：'");
    expect(source).toContain("ownerMarker: '发布者本人'");
    expect(source).toContain(
      "signedOutHint: '请使用已验证的校园账号登录后使用这些操作。'",
    );
    expect(source).toContain("reportTitle: '举报此内容'");
    expect(source).toContain("reportBody: '举报将由校园审核团队私下处理。'");
    expect(source).toContain("reasonLabel: '举报原因'");
    expect(source).toContain("reasonPlaceholder: '请选择原因'");
    expect(source).toContain("['SPAM', '垃圾信息']");
    expect(source).toContain("['MISLEADING', '虚假或误导信息']");
    expect(source).toContain("['HARASSMENT', '骚扰行为']");
    expect(source).toContain("['PROHIBITED', '违规内容']");
    expect(source).toContain("['OTHER', '其他']");
    expect(source).toContain("optionalDetails: '补充说明（可选）'");
    expect(source).toContain("submitReport: '提交举报'");
    expect(source).toContain("submittingReport: '提交中...'");
    expect(source).toContain("cancel: '取消'");
    expect(source).toContain("requestContact: '查看联系方式'");
    expect(source).toContain("requestingContact: '正在获取...'");
    expect(source).toContain(
      "contactSuccess: '联系方式访问已记录，请注意线下见面与付款安全。'",
    );
    expect(source).toContain("contactError: '无法获取联系方式，请稍后重试。'");
    expect(source).toContain('{copy.contactLabel}');
    expect(source).not.toContain('Seller contact: <strong>');
  });
});
