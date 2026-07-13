import { createHash, randomBytes } from 'node:crypto';

import bcrypt from 'bcryptjs';
import { z } from 'zod';

import { isPasswordValid } from './password';

const passwordSchema = z.string().refine(isPasswordValid, {
  message:
    'Password must have at least 12 characters including upper- and lower-case letters, a number, and a symbol.',
});

const normalizedEmailSchema = z.string().trim().toLowerCase().email();

const nameSchema = z.string().trim().min(1).max(200);

export const signUpSchema = z.object({
  email: normalizedEmailSchema,
  name: nameSchema,
});

export const verificationCompletionSchema = z
  .object({
    confirmPassword: z.string(),
    password: passwordSchema,
    token: z.string().trim().min(1).max(256),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const resendVerificationSchema = z.object({
  email: normalizedEmailSchema,
});

export const signInSchema = z.object({
  email: normalizedEmailSchema,
  password: z.string().min(1),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type VerificationCompletionInput = z.infer<
  typeof verificationCompletionSchema
>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
