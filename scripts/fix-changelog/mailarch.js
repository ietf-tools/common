import { Octokit } from 'octokit'
import _ from 'lodash'
import { DateTime } from 'luxon'
import fs from 'fs/promises'

const gh = new Octokit({ auth: 'YOUR_TOKEN' })
const owner = 'ietf-tools'
const repo = 'mailarch'
const changelogPath = 'CHANGELOG' // Path to changelog in remote repository
const svnMapPath = 'svn-history/mailarch-revmap.txt' // Path to changelog in remote repository, set to null to disable SVN Changeset linking
const coverageLocalPath = null // './data/release-coverage.json' // Path to coverage json on LOCAL DISK, set to null to disable coverage

// ---------------------------------

const reChunk = /^-- ([\w ]+) <([\w@.-]+)> +([0-9a-zA-Z+: ]+) *$/gm
const reVersion = /^\w+ \(([0-9]+\.[0-9]+\.?[0-9]*)\)/
const reDescription = /^\*\*([\w ,.-]+?)\*\*/
const reSemver = /^[0-9]+\.[0-9]+\.?[0-9]*$/
const reChangeset = /\[([1-9][0-9]*)\]/gm
const reInlineCode = / \'([^\'\n]+?)\'/gm

try {
  // -> Get changelog file
  console.info('Fetching current changelog...')
  const respChgLog = await gh.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner,
    repo,
    path: changelogPath
  })

  if (!respChgLog?.data?.content) {
    throw new Error('Invalid CHANGELOG Path')
  }

  // -> Process changelog contents
  const chlogRaw = Buffer.from(respChgLog.data.content, 'base64').toString('utf-8')

  // -> Parse changelog in chunks
  console.info('Parsing changelog entries...')
  const entries = []
  let currentIdx = 0
  for (const match of chlogRaw.matchAll(reChunk)) {
    const bodyRaw = chlogRaw.slice(currentIdx, match.index).trim()
    const version = reVersion.exec(bodyRaw)?.[1]?.trim()
    let body = bodyRaw.substring(bodyRaw.indexOf('\n') + 1).trim()
    const descriptionMatch = reDescription.exec(body)
    const description = descriptionMatch?.[1]?.trim()
    if (description) {
      body = body.substring(descriptionMatch[0].length + 1).trim()
    }

    // -> Try to parse the dates... (different formats all over the place...)
    let entryDate = DateTime.fromFormat(match[3], 'dd MMMM yyyy HH:mm:ss ZZZ')
    if (!entryDate.isValid) {
      entryDate = DateTime.fromFormat(match[3], 'd MMMM yyyy HH:mm:ss ZZZ')
    }
    if (!entryDate.isValid) {
      entryDate = DateTime.fromFormat(match[3], 'dd MMM yyyy HH:mm:ss ZZZ')
    }
    if (!entryDate.isValid) {
      entryDate = DateTime.fromFormat(match[3], 'd MMM yyyy HH:mm:ss ZZZ')
    }
    
    entries.push({
      version,
      author: match[1],
      authorEmail: match[2],
      date: entryDate.setZone('utc'),
      description,
      body
    })
    currentIdx = match.index + match[0].length
  }
  console.info(`${entries.length} entries parsed.`)

  // -> Get SVN Mapping file
  const refs = []
  if (svnMapPath) {
    console.info('Fetching SVN Mapping file...')
    const respSvnMap = await gh.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: svnMapPath
    })

    if (!respSvnMap?.data?.content) {
      throw new Error('Invalid SVN Mapping Path')
    }

    // -> Process SVN Mapping contents
    const svnMapRaw = Buffer.from(respSvnMap.data.content, 'base64').toString('utf-8')
    refs.push(...svnMapRaw.split('\n').filter(r => !_.isEmpty(r)).map(r => {
      const refData = r.split('|')
      const chgSet = refData[0].trim()
      return {
        changeset: chgSet.indexOf('r') === 0 ? chgSet.substring(1) : chgSet,
        commit: refData?.[1]?.trim()
      }
    }))
  }

  // -> Get coverage results
  let coverage = {}
  if (coverageLocalPath) {
    console.info('Loading coverage results file...')
    const rawCoverage = await fs.readFile(coverageLocalPath, 'utf8')
    coverage = JSON.parse(rawCoverage)
  }

  // -> Fetch repo tags
  const tags = []
  let hasMoreTags = false
  let tagsCurPage = 0
  do {
    hasMoreTags = false
    tagsCurPage++
    const resp = await gh.request('GET /repos/{owner}/{repo}/tags', {
      owner,
      repo,
      page: tagsCurPage,
      per_page: 100
    })
    if (resp?.data?.length > 0) {
      console.info(`Fetching tags... ${(tagsCurPage - 1) * 100}`)
      hasMoreTags = true
      tags.push(...resp.data.filter(t => reSemver.test(t.name)))
    }
  } while (hasMoreTags)
  console.info(`Found ${tags.length} valid tags.`)

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

  // -> Create / update releases

  for (const tag of tags) {
    const release = _.find(releases, r => r.tag_name === tag.name || r.tag_name === `v${tag.name}`)
    const entry = _.find(entries, e => e.version === tag.name)
    const cov = coverage[tag.name]
    
    let formattedBody = ''

    if (entry) {
      formattedBody = entry.description ? `**Summary:** ${entry.description}\n` : ''
      formattedBody += `**Release Date**: ${entry.date.toFormat('ccc, LLLL d, y \'at\' h:mm a ZZZZ')}\n`
      formattedBody += `**Release Author**: [${entry.author}](mailto:${entry.authorEmail})\n`
      formattedBody += `\n---\n\n  ${entry.body}`
      formattedBody = formattedBody.replaceAll(reChangeset, (match, cs) => {
        const m = _.find(refs, ['changeset', cs])
        return m ? `[\[${cs}\]](https://github.com/${owner}/${repo}/commit/${m.commit})` : match
      })
      formattedBody = formattedBody.replaceAll(reInlineCode, (match, c) => ` \`${c}\``)

      if (cov) {
        const covInfo = {
          code: _.round(cov.code.coverage * 100, 2),
          template: _.round(cov.template.coverage * 100, 2),
          url: _.round(cov.url.coverage * 100, 2)
        }
        formattedBody += `\n\n---\n\n**Coverage**\n\n`
        formattedBody += `![](https://img.shields.io/badge/Code-${covInfo.code}%25-${getCoverageColor(covInfo.code)}?style=flat-square)`
        formattedBody += `![](https://img.shields.io/badge/Templates-${covInfo.template}%25-${getCoverageColor(covInfo.template)}?style=flat-square)`
        formattedBody += `![](https://img.shields.io/badge/URLs-${covInfo.url}%25-${getCoverageColor(covInfo.url)}?style=flat-square)`
      }
    } else {
      formattedBody = '*This release has no changelog.*'
    }

    if (release) {
      console.info(`Updating release ${release.name}...`)
      await gh.request('PATCH /repos/{owner}/{repo}/releases/{release_id}', {
        owner,
        repo,
        release_id: release.id,
        body: formattedBody,
        draft: false,
        prerelease: false
      })
    } else {
      console.info(`Creating release v${tag.name}...`)
      await gh.request('POST /repos/{owner}/{repo}/releases', {
        owner,
        repo,
        tag_name: tag.name,
        name: `v${tag.name}`,
        body: formattedBody,
        draft: false,
        prerelease: false
      })
    }
  }

  console.info('Done.')
} catch (err) {
  console.error(err)
  process.exit(1)
}

function getCoverageColor (val) {
  if (val >= 95) {
    return 'brightgreen'
  } else if (val >= 90) {
    return 'green'
  } else if (val >= 80) {
    return 'yellowgreen'
  } else if (val >= 60) {
    return 'yellow'
  } else if (val >= 50) {
    return 'orange'
  } else {
    return 'red'
  }
}