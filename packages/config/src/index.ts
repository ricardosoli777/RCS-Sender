import { z } from 'zod';
const credentialKeys = z.string().transform((value, context) => {
  try {
    const parsed = z.record(z.string().regex(/^[A-Za-z0-9_-]{1,32}$/), z.string().regex(/^[a-f0-9]{64}$/)).safeParse(JSON.parse(value));
    if (parsed.success && Object.keys(parsed.data).length > 0) return parsed.data;
  } catch { /* Configuration errors identify the key, never its value. */ }
  context.addIssue({ code: 'custom', message: 'Chaves de credenciais inválidas' });
  return z.NEVER;
});

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  }, 'Use a origem HTTP(S) da interface, sem caminhos ou credenciais'),
  API_URL: z.url().refine((value) => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash;
  }, 'Use a origem HTTP(S) da API, sem caminhos ou credenciais'),
  DATABASE_URL: z.url().refine((url) => url.startsWith('postgresql://') || url.startsWith('postgres://'), 'Use uma URL PostgreSQL'),
  REDIS_URL: z.url().refine((url) => url.startsWith('redis://') || url.startsWith('rediss://'), 'Use uma URL Redis'),
  RCS_EDGE_PROXY_SECRET: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  RCS_API_PROXY_SECRET: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  RCS_CREDENTIAL_KEYS: credentialKeys.optional(),
  RCS_CREDENTIAL_ACTIVE_KEY: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
}).superRefine((config, context) => {
  if (config.RCS_CREDENTIAL_KEYS || config.RCS_CREDENTIAL_ACTIVE_KEY) {
    if (!config.RCS_CREDENTIAL_KEYS || !config.RCS_CREDENTIAL_ACTIVE_KEY || !Object.hasOwn(config.RCS_CREDENTIAL_KEYS, config.RCS_CREDENTIAL_ACTIVE_KEY)) {
      context.addIssue({ code: 'custom', path: ['RCS_CREDENTIAL_ACTIVE_KEY'], message: 'Chave ativa ausente' });
    }
    if (Object.values(config.RCS_CREDENTIAL_KEYS ?? {}).some((key) => key === config.RCS_EDGE_PROXY_SECRET || key === config.RCS_API_PROXY_SECRET)) {
      context.addIssue({ code: 'custom', path: ['RCS_CREDENTIAL_KEYS'], message: 'Use chaves distintas dos segredos de proxy' });
    }
  }
  if (config.NODE_ENV === 'production' && !config.APP_URL.startsWith('https://')) {
    context.addIssue({ code: 'custom', path: ['APP_URL'], message: 'HTTPS obrigatório em produção' });
  }
  if (config.NODE_ENV === 'production' || config.RCS_EDGE_PROXY_SECRET || config.RCS_API_PROXY_SECRET) {
    if (!config.RCS_EDGE_PROXY_SECRET || !config.RCS_API_PROXY_SECRET || config.RCS_EDGE_PROXY_SECRET === config.RCS_API_PROXY_SECRET) {
      context.addIssue({ code: 'custom', path: ['RCS_API_PROXY_SECRET'], message: 'Configure dois segredos de proxy distintos' });
    }
  }
});

export type ServerConfig = z.infer<typeof serverSchema>;

export function loadServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
  const result = serverSchema.safeParse(env);
  if (result.success) return result.data;
  const keys = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Configuração inválida ou ausente: ${keys}`);
}
