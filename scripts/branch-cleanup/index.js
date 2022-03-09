import { Octokit } from 'octokit'

const gh = new Octokit({ auth: 'GH_PERSONAL_TOKEN_HERE' })
const owner = 'ietf-tools'
const repo = 'datatracker'

const branches = []
let hasMoreBranches = false
let curPage = 0
do {
  hasMoreBranches = false
  curPage++
  const resp = await gh.request('GET /repos/{owner}/{repo}/branches', {
    owner,
    repo,
    protected: false,
    page: curPage,
    per_page: 100
  })
  if (resp?.data?.length > 0) {
    console.info(`Fetching branches... ${(curPage - 1) * 100}`)
    hasMoreBranches = true
    branches.push(...resp.data)
  }
} while (hasMoreBranches)

console.info(`Found ${branches.length} branches.`)

for (const branch of branches) {
  if (
    branch.name.startsWith('attic/') ||
    branch.name.startsWith('sprint/') ||
    branch.name.startsWith('branch/') ||
    branch.name.startsWith('personal/') ||
    branch.name.startsWith('unbranched')
    ) {
    console.info(`Deleting branch ${branch.name}...`)
    await gh.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      ref: `heads/${branch.name}`
    })
  }
  
}