import { Octokit } from 'octokit'

const gh = new Octokit({ auth: 'YOUR_GH_TOKEN' })
const owner = 'ietf-tools'
const repo = 'datatracker'

// ---------------------------------

try {
  // -> Fetch existing releases
  const releases = []
  let hasMoreReleases = false
  let releasesCurPage = 0
  do {
    hasMoreReleases = false
    releasesCurPage++
    const resp = await gh.request('GET /repos/{owner}/{repo}/releases', {
      owner,
      repo,
      page: releasesCurPage,
      per_page: 100
    })
    if (resp?.data?.length > 0) {
      console.info(`Fetching existing releases... ${(releasesCurPage - 1) * 100}`)
      hasMoreReleases = true
      releases.push(...resp.data)
    }
  } while (hasMoreReleases)
  console.info(`Found ${releases.length} existing releases.`)

  // -> Update releases

  for (const release of releases) {
    if (release.name.startsWith('v')) {
      console.info(`Updating release ${release.name} to ${release.name.substring(1)}...`)
      await gh.request('PATCH /repos/{owner}/{repo}/releases/{release_id}', {
        owner,
        repo,
        release_id: release.id,
        name: release.name.substring(1)
      })
    }
  }

  console.info('Done.')
} catch (err) {
  console.error(err)
  process.exit(1)
}