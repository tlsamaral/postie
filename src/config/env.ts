import { z } from 'zod'
import dotenv from 'dotenv'

dotenv.config()

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    EMAIL_PROVIDER: z.enum(['MS_GRAPH', 'IMAP']).default('MS_GRAPH'),

    AZURE_TENANT_ID: z.string().optional(),
    AZURE_CLIENT_ID: z.string().optional(),
    AZURE_CLIENT_SECRET: z.string().optional(),
    MS_GRAPH_MAILBOX_USER: z.string().email('Email da caixa do M365 a monitorar').optional(),

    IMAP_HOST: z.string().optional(),
    IMAP_PORT: z.coerce.number().default(993).optional(),
    IMAP_USER: z.string().optional(),
    IMAP_PASSWORD: z.string().optional(),
    IMAP_TLS: z.coerce.boolean().default(true).optional(),

    AI_PROVIDER: z.enum(['GEMINI', 'OPENAI']).default('GEMINI'),
    GEMINI_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),

    GITHUB_AUTH_TOKEN: z.string().min(1, 'Token de autenticação do GitHub obrigatório'),

    POLLING_INTERVAL_SECONDS: z.coerce.number().min(5).default(60),
    ALERT_NOTIFICATION_EMAIL: z.string().email('Email que receberá as confirmações de novos tickets'),
  })
  .refine(
    (data) => {
      if (data.AI_PROVIDER === 'GEMINI' && !data.GEMINI_API_KEY) return false
      if (data.AI_PROVIDER === 'OPENAI' && !data.OPENAI_API_KEY) return false
      return true
    },
    {
      message: 'Chave de API do provedor de IA selecionado não fornecida',
      path: ['AI_PROVIDER'],
    }
  )
  .refine(
    (data) => {
      if (data.EMAIL_PROVIDER === 'MS_GRAPH') {
        return Boolean(
          data.AZURE_TENANT_ID &&
            data.AZURE_CLIENT_ID &&
            data.AZURE_CLIENT_SECRET &&
            data.MS_GRAPH_MAILBOX_USER
        )
      }
      if (data.EMAIL_PROVIDER === 'IMAP') {
        return Boolean(data.IMAP_HOST && data.IMAP_USER && data.IMAP_PASSWORD)
      }
      return true
    },
    {
      message: 'Credenciais incompletas para o provedor de email selecionado',
      path: ['EMAIL_PROVIDER'],
    }
  )

export type Env = z.infer<typeof envSchema>

export function validateEnv(customEnv?: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(customEnv ?? process.env)
  if (!result.success) {
    const formatted = result.error.format()
    console.error('❌ Falha na validação das variáveis de ambiente:')
    console.error(JSON.stringify(formatted, null, 2))
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1)
    }
    throw new Error('Falha na validação das variáveis de ambiente: ' + JSON.stringify(formatted))
  }
  return result.data
}

// Defer strict process.env validation when imported inside unit test suites
export const env: Env =
  process.env.NODE_ENV === 'test'
    ? ({} as unknown as Env)
    : validateEnv(process.env)
