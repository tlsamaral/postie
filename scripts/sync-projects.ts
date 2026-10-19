import 'dotenv/config'
import { Octokit } from '@octokit/rest'
import { execSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProjectDefinition, AllowedAction } from '../src/domain/entities/project-definition.entity.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getGitHubToken(): string | undefined {
  if (process.env.GITHUB_AUTH_TOKEN) return process.env.GITHUB_AUTH_TOKEN
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (token) return token
  } catch {
    // gh CLI not available or not logged in
  }
  return undefined
}

async function main() {
  console.info('🔍 Iniciando sincronização dinâmica de projetos alvo...')

  const token = getGitHubToken()
  if (!token) {
    console.error('❌ Erro: GITHUB_AUTH_TOKEN não configurado e `gh auth token` não retornou credenciais válidas.')
    process.exit(1)
  }

  const octokit = new Octokit({ auth: token })

  let owner = process.env.GITHUB_OWNER
  if (!owner) {
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated()
      owner = user.login
      console.info(`👤 Usuário autenticado detectado: ${owner}`)
    } catch (err) {
      console.error('❌ Falha ao obter usuário autenticado via GitHub API:', err)
      process.exit(1)
    }
  }

  const targetTopic = process.env.TARGET_TOPIC || 'postie-target'
  console.info(`🎯 Buscando repositórios em "${owner}" com o topic "${targetTopic}"...`)

  const searchQuery = `user:${owner} topic:${targetTopic} fork:true`
  let searchResults
  try {
    searchResults = await octokit.rest.search.repos({
      q: searchQuery,
      per_page: 100,
    })
  } catch (err) {
    console.error(`❌ Erro ao pesquisar repositórios (query: ${searchQuery}):`, err)
    process.exit(1)
  }

  const repos = searchResults.data.items
  console.info(`📦 Repositórios encontrados com topic "${targetTopic}": ${repos.length}`)

  if (repos.length === 0) {
    console.warn(`\n⚠️  Nenhum repositório com o topic "${targetTopic}" foi localizado para "${owner}".`)
    console.info(`💡 Dica: Adicione o topic "${targetTopic}" no GitHub (About -> Topics) nos repositórios desejados.`)
    console.info(`💡 Opcional: Adicione um arquivo .github/postie.json no repo para personalizar escopo e permissões.`)
    console.info('ℹ️  O arquivo src/config/projects.catalog.json existente foi preservado.\n')
    return
  }

  const projects: ProjectDefinition[] = []

  for (const repo of repos) {
    const repoOwner = repo.owner?.login || owner
    const repoName = repo.name
    console.info(`- Processando [${repoOwner}/${repoName}]...`)

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
          console.info(`  ✓ Configuração personalizada lida de ${manifestPath}`)
          break
        }
      } catch {
        // Optional per-repository manifest not present; fall back to repository metadata
      }
    }

    const defaultActions: AllowedAction[] = ['create_issue', 'comment']
    const projectDef: ProjectDefinition = {
      id: repoName.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
      name: manifestConfig?.name || repoName,
      description: manifestConfig?.description || repo.description || `Repositório ${repoName}`,
      scopeBoundaries: manifestConfig?.scopeBoundaries || [
        `Pertence: Chamados, erros, melhorias ou dúvidas relacionados ao serviço ${repoName}.`,
      ],
      github: {
        owner: repoOwner,
        repo: repoName,
      },
      allowedActions: manifestConfig?.allowedActions || defaultActions,
    }

    projects.push(projectDef)
  }

  const targetFile = path.resolve(__dirname, '../src/config/projects.catalog.json')
  await fs.writeFile(targetFile, JSON.stringify(projects, null, 2), 'utf-8')

  console.info(`\n🎉 Sucesso! ${projects.length} projeto(s) catalogado(s) em:`)
  console.info(`   ${targetFile}`)
}

main().catch((error) => {
  console.error('❌ Erro fatal durante a sincronização:', error)
  process.exit(1)
})
