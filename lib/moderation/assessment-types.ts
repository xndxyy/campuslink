import { z } from 'zod';

export const assessmentCategories = [
  '诈骗引流',
  '违法违规',
  '色情低俗',
  '暴力伤害',
  '仇恨骚扰',
  '隐私泄露',
  '广告垃圾',
  '其他风险',
] as const;
export const assessmentSchema = z
  .object({
    adminSignals: z.array(z.string().trim().min(1).max(200)).max(10),
    categories: z.array(z.enum(assessmentCategories)).max(8),
    decision: z.enum(['PASS', 'REVIEW', 'BLOCK']),
    reasonZh: z.string().trim().min(1).max(500),
    riskScore: z.number().int().min(0).max(100),
    suggestionZh: z.string().trim().min(1).max(500),
  })
  .strict();
export type AssessmentOutput = z.infer<typeof assessmentSchema>;
export type PublishAssessment =
  | { kind: 'pass'; assessmentId?: string }
  | { kind: 'review'; assessmentId?: string; reasonZh: string }
  | {
      kind: 'block';
      assessmentId?: string;
      categories: string[];
      reasonZh: string;
      suggestionZh: string;
    }
  | { kind: 'skipped'; assessmentId?: string };
