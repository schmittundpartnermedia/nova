import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NOVA_ORG_SLUG: z.string().default("joachim"),
  NOVA_USER_EMAIL: z.string().default("joachim@local"),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOCAL_AI_BASE_URL: z.string().optional(),
  LOCAL_AI_MODEL: z.string().optional(),
  NOVA_VOICE: z.string().optional(),
  NOVA_VOICE_SPEED: z.string().optional(),
  NOVA_A2F_GRPC_URL: z.string().optional(),
  NOVA_A2F_SERVICE_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    NOVA_ORG_SLUG: process.env.NOVA_ORG_SLUG,
    NOVA_USER_EMAIL: process.env.NOVA_USER_EMAIL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    LOCAL_AI_BASE_URL: process.env.LOCAL_AI_BASE_URL,
    LOCAL_AI_MODEL: process.env.LOCAL_AI_MODEL,
    NOVA_VOICE: process.env.NOVA_VOICE,
    NOVA_VOICE_SPEED: process.env.NOVA_VOICE_SPEED,
    NOVA_A2F_GRPC_URL: process.env.NOVA_A2F_GRPC_URL,
    NOVA_A2F_SERVICE_URL: process.env.NOVA_A2F_SERVICE_URL,
  });
}
