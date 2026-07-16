import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
}

describe('Chinese authentication experience', () => {
  const signUp = source('../../app/auth/sign-up/page.tsx');
  const signIn = source('../../app/auth/sign-in/page.tsx');
  const verify = source('../../app/auth/verify/page.tsx');
  const resend = source('../../components/auth/resend-verification-form.tsx');
  const routes = [
    source('../../app/api/auth/sign-up/route.ts'),
    source('../../app/api/auth/sign-in/route.ts'),
    source('../../app/api/auth/verify/route.ts'),
    source('../../app/api/auth/resend-verification/route.ts'),
  ];

  it('localizes sign-up, sign-in, and verification copy', () => {
    for (const value of [signUp, signIn, verify]) {
      expect(value).not.toMatch(
        /Create an account|Sign in with|Verify your e-mail|Invalid e-mail|Choose a password|Confirm password|At least 12 characters|Back to sign in/,
      );
    }
    expect(signUp).toContain('注册 CampusLink');
    expect(signIn).toContain('登录 CampusLink');
    expect(verify).toContain('验证邮箱');
    expect(verify).toContain('只有最新一封验证邮件中的链接有效');
  });

  it('keeps browser-facing auth API responses in Chinese', () => {
    const routeSource = routes.join('\n');
    expect(routeSource).not.toMatch(
      /Invalid request origin|Please try again later|Invalid registration details|Invalid e-mail or password|E-mail verified|Unable to send a verification link/,
    );
    expect(routeSource).toContain('请求来源无效。');
    expect(routeSource).toContain('邮箱或密码错误。');
    expect(routeSource).toContain('邮箱验证成功。');
  });

  it('disables resend for a visible 60-second countdown after success', () => {
    expect(resend).toContain("'use client'");
    expect(resend).toContain('initialSent ? 60 : 0');
    expect(resend).toContain('setInterval');
    expect(resend).toContain('秒后可重新发送');
    expect(resend).toContain('disabled={secondsRemaining > 0}');
  });
});
