import 'dotenv/config'
import { Octokit } from '@octokit/rest'
import { checkbox } from '@inquirer/prompts'
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectDefinition, AllowedAction } from '../src/domain/entities/project-definition.entity.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getGitHubToken(): string | undefined {
  if (process.env.GITHUB_AUTH_TOKEN) return process.env.GITHUB_AUTH_TOKEN.trim()
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim()
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (token) return token
  } catch {
    // gh CLI fallback
  }
  return undefined
}

async function main() {
  console.info('\n🚀 Assistente Interativo de Seleção de Projetos - Postie\n')

  const token = getGitHubToken()
  if (!token) {
    console.error('❌ Token do GitHub não encontrado. Verifique seu .env (GITHUB_AUTH_TOKEN) ou execute `gh auth login`.')
    process.exit(1)
  }

  const octokit = new Octokit({ auth: token })

  let authenticatedUser: string = 'desconhecido'
  try {
    const { data: user } = await octokit.rest.users.getAuthenticated()
    authenticatedUser = user.login
    console.info(`🔑 Autenticado via token como: @${authenticatedUser}`)
  } catch (err) {
    console.warn('⚠️  Não foi possível identificar o usuário do token:', err)
  }

  // Busca organizações vinculadas a esse token
  let orgs: string[] = []
  try {
    const orgsRes = await octokit.rest.orgs.listForAuthenticatedUser({ per_page: 50 })
    orgs = orgsRes.data.map((o) => o.login)
    if (orgs.length > 0) {
      console.info(`🏢 Organizações com acesso detectadas: ${orgs.map((o) => `@${o}`).join(', ')}`)
    }
  } catch {
    // Token pode ter escopo restrito a repositório
  }

  console.info('📡 Buscando repositórios (pessoais e de organizações)...')

  const allReposMap = new Map<string, any>()

  // 1. Busca repositórios do usuário autenticado
  try {
    const userRepos = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
      affiliation: 'owner,collaborator,organization_member',
    })
    for (const r of userRepos.data) {
      allReposMap.set(r.full_name, r)
    }
  } catch (e) {
    console.warn('⚠️  Aviso ao buscar repositórios do usuário:', e)
  }

  // 2. Busca explicitamente os repositórios de cada organização detectada
  for (const org of orgs) {
    try {
      const orgRepos = await octokit.rest.repos.listForOrg({
        org,
        sort: 'updated',
        per_page: 100,
      })
      for (const r of orgRepos.data) {
        allReposMap.set(r.full_name, r)
      }
    } catch {
      // Ignora erros de permissão em orgs específicas
    }
  }

  const repos = Array.from(allReposMap.values())

  if (repos.length === 0) {
    console.warn('\n⚠️  Nenhum repositório foi encontrado com as permissões do token atual.')
    return
  }

  console.info(`📦 Total de ${repos.length} repositório(s) disponível(is).\n`)

  // Prepara lista para o checkbox interativo com owner destacado
  const choices = repos.map((repo) => ({
    name: `[${repo.owner.login}] ${repo.name}${repo.private ? ' 🔒 (privado)' : ' 🌐 (público)'} - ${repo.description || 'Sem descrição'}`,
    value: repo,
  }))

  const selectedRepos = await checkbox({
    message: 'Selecione os projetos que devem receber chamados (Espaço para marcar, Enter para confirmar):',
    choices,
    pageSize: 15,
  })

  if (selectedRepos.length === 0) {
    console.warn('\n⚠️  Nenhum repositório foi selecionado. O catálogo não foi modificado.')
    return
  }

  console.info(`\n⚙️  Configurando ${selectedRepos.length} projeto(s) selecionado(s)...`)

  const newProjects: ProjectDefinition[] = []

  for (const repo of selectedRepos) {
    const repoOwner = repo.owner.login
    const repoName = repo.name

    let manifestConfig: Partial<{
      name: string
      description: string
      scopeBoundaries: string[]
      allowedActions: AllowedAction[]
    }> | null = null

    for (const manifestPath of ['.github/postie.json', 'postie.json']) {
      try {
        const fileRes = await octokit.rest.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: manifestPath,
        })

        if ('content' in fileRes.data && fileRes.data.content) {
          const rawContent = Buffer.from(fileRes.data.content, 'base64').toString('utf-8')
          manifestConfig = JSON.parse(rawContent)
          console.info(`  ✓ Configuração customizada encontrada para ${repoOwner}/${repoName}`)
          break
        }
      } catch {
        // Sem arquivo customizado
      }
    }

    const defaultActions: AllowedAction[] = ['create_issue', 'update_priority', 'comment']

    newProjects.push({
      id: repoName.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      name: manifestConfig?.name || repoName,
      description: manifestConfig?.description || repo.description || `Repositório ${repoName}`,
      scopeBoundaries: manifestConfig?.scopeBoundaries || [
        `Pertence: Chamados, bugs, dúvidas e melhorias do serviço ${repoName}.`,
        'Não pertence: Assuntos fora de escopo, marketing, propostas comerciais ou spam.',
      ],
      github: {
        owner: repoOwner,
        repo: repoName,
      },
      allowedActions: manifestConfig?.allowedActions || defaultActions,
    })
  }

  const catalogPath = path.resolve(__dirname, '../src/config/projects.catalog.json')

  // Salva no arquivo de catálogo
  await fs.writeFile(catalogPath, JSON.stringify(newProjects, null, 2), 'utf-8')

  console.info(`\n✅ Catálogo atualizado com sucesso em: ${catalogPath}`)
  console.info('📋 Projetos ativos no catálogo:')
  for (const p of newProjects) {
    console.info(`   • ${p.name} (GitHub: ${p.github.owner}/${p.github.repo})`)
  }

  console.info('\n🎉 Tudo pronto! Agora basta rodar `pnpm dev` para iniciar o agente.')
}

main().catch((err) => {
  if (err.name === 'ExitPromptError') {
    console.info('\n👋 Seleção cancelada.')
    process.exit(0)
  }
  console.error('❌ Erro inesperado:', err)
  process.exit(1)
})
