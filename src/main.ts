import { env } from './config/env.js'
import { PROJECTS_CATALOG } from './config/projects.registry.js'
import { IEmailReaderPort } from './domain/ports/email-reader.port.js'
import { IEmailSenderPort } from './domain/ports/email-sender.port.js'
import { IAIRouterPort } from './domain/ports/ai-router.port.js'
import { MSGraphEmailAdapter } from './infrastructure/email/ms-graph-email.adapter.js'
import { ImapEmailAdapter } from './infrastructure/email/imap-email.adapter.js'
import { MSGraphSenderAdapter } from './infrastructure/notifications/ms-graph-sender.adapter.js'
import { ConsoleNotifierAdapter } from './infrastructure/notifications/console-sender.adapter.js'
import { GeminiRouterAdapter } from './infrastructure/ai/gemini-router.adapter.js'
import { OpenAIRouterAdapter } from './infrastructure/ai/openai-router.adapter.js'
import { GitHubTrackerAdapter } from './infrastructure/tracker/github-tracker.adapter.js'
import { ProcessIncomingEmailUseCase } from './application/use-cases/process-incoming-email.use-case.js'

function initializeEmailReader(): IEmailReaderPort {
  if (env.EMAIL_PROVIDER === 'MS_GRAPH') {
    return new MSGraphEmailAdapter({
      tenantId: env.AZURE_TENANT_ID!,
      clientId: env.AZURE_CLIENT_ID!,
      clientSecret: env.AZURE_CLIENT_SECRET!,
      mailboxUser: env.MS_GRAPH_MAILBOX_USER!,
    })
  }

  if (env.EMAIL_PROVIDER === 'IMAP') {
    return new ImapEmailAdapter({
      host: env.IMAP_HOST!,
      port: env.IMAP_PORT,
      secure: env.IMAP_TLS,
      auth: {
        user: env.IMAP_USER!,
        pass: env.IMAP_PASSWORD!,
      },
    })
  }

  throw new Error(`Provedor de email não suportado: ${env.EMAIL_PROVIDER}`)
}

function initializeEmailSender(): IEmailSenderPort {
  if (env.EMAIL_PROVIDER === 'MS_GRAPH') {
    return new MSGraphSenderAdapter({
      tenantId: env.AZURE_TENANT_ID!,
      clientId: env.AZURE_CLIENT_ID!,
      clientSecret: env.AZURE_CLIENT_SECRET!,
      mailboxUser: env.MS_GRAPH_MAILBOX_USER!,
    })
  }

  console.info('[Setup] Provedor de envio padrão: ConsoleNotifierAdapter')
  return new ConsoleNotifierAdapter()
}

function initializeAIRouter(): IAIRouterPort {
  if (env.AI_PROVIDER === 'GEMINI') {
    return new GeminiRouterAdapter({
      apiKey: env.GEMINI_API_KEY!,
    })
  }

  if (env.AI_PROVIDER === 'OPENAI') {
    return new OpenAIRouterAdapter({
      apiKey: env.OPENAI_API_KEY!,
    })
  }

  throw new Error(`Provedor de IA não suportado: ${env.AI_PROVIDER}`)
}

async function bootstrap() {
  console.info('🚀 Inicializando Ticket Router Agent...')
  console.info(`- Ambiente: ${env.NODE_ENV}`)
  console.info(`- Provedor de Email: ${env.EMAIL_PROVIDER}`)
  console.info(`- Provedor de IA: ${env.AI_PROVIDER}`)
  console.info(`- Intervalo de Polling: ${env.POLLING_INTERVAL_SECONDS}s`)
  console.info(`- Notificações de Alerta: ${env.ALERT_NOTIFICATION_EMAIL}`)
  console.info(`- Projetos no Catálogo: ${PROJECTS_CATALOG.length}`)

  const emailReader = initializeEmailReader()
  const emailSender = initializeEmailSender()
  const aiRouter = initializeAIRouter()
  const issueTracker = new GitHubTrackerAdapter({
    authToken: env.GITHUB_AUTH_TOKEN,
    projectsCatalog: PROJECTS_CATALOG,
  })

  const processIncomingEmailUseCase = new ProcessIncomingEmailUseCase(
    emailReader,
    emailSender,
    aiRouter,
    issueTracker,
    PROJECTS_CATALOG,
    {
      alertNotificationEmail: env.ALERT_NOTIFICATION_EMAIL,
    }
  )

  let isRunning = false

  const runTriageCycle = async () => {
    if (isRunning) {
      console.warn('[Scheduler] Ciclo anterior ainda em execução. Ignorando este pulso.')
      return
    }

    isRunning = true
    try {
      console.info(`[Scheduler] Iniciando verificação em ${new Date().toISOString()}...`)
      await processIncomingEmailUseCase.execute()
    } catch (error) {
      console.error('[Scheduler] Falha durante ciclo de triagem:', error)
    } finally {
      isRunning = false
    }
  }

  // Executa imediatamente o primeiro ciclo
  await runTriageCycle()

  // Inicia o loop periódico
  const intervalId = setInterval(runTriageCycle, env.POLLING_INTERVAL_SECONDS * 1000)

  const shutdown = () => {
    console.info('\n🛑 Encerrando Ticket Router Agent com segurança...')
    clearInterval(intervalId)
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

bootstrap().catch((err) => {
  console.error('💥 Falha fatal ao inicializar Ticket Router Agent:', err)
  process.exit(1)
})
