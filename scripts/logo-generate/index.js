import * as fs from 'fs/promises'
import * as opentype from 'opentype.js'
import * as yaml from 'js-yaml'
import * as path from 'path'
import Color from 'color'

try {
  // Create output folder
  const outputPath = process.env.OUTPUT_PATH || 'output'
  await fs.mkdir(outputPath, { recursive: true })

  // Load identities
  const identitiesPath = process.env.IDENTITIES_PATH || 'identities.yml'
  const identities = yaml.load(await fs.readFile(identitiesPath))
  if (!identities || !identities.input || identities.input.length < 1) {
    throw new Error('Invalid or empty identities.yml file!')
  }
  console.info(`Found ${identities.input.length} identities to generate.`)

  // Load base template
  const base = await fs.readFile('base.svg', 'utf8')
  console.info('Loaded base template successfully.')

  // Load font
  const font = await opentype.load('./fonts/OpenSansCondensed-Bold.ttf')
  console.info('Loaded font successfully.')

  for (const identity of identities.input) {
    console.info(`Generating SVG for ${identity.key}...`)

    // Calculate color gradient
    const bottomColor = Color(identity.color ?? '#02A1D7')
    const topColor = bottomColor.blacken(1.75)
    const darkColor = bottomColor.blacken(0.75)
    const lightColor = bottomColor.desaturate(0.35).lighten(0.35)

    // Generate font paths
    const paths = font.getPaths(identity.label, 450, 235, 200)
    const pathsShadow = font.getPaths(identity.label, 451, 236, 200)

    // Convert to SVG paths
    let output = ''
    let maxX = 0
    for (const p of pathsShadow) {
      const bBox = p.getBoundingBox()
      if (bBox.x2 > maxX) {
        maxX = bBox.x2
      }
      p.fill = '#FFFFFF'
      output += p.toSVG()
    }
    for (const p of paths) {
      p.fill = 'url(#TextGradient)'
      output += p.toSVG()
    }

    // Inject into base template
    const final = base.replaceAll('{{DOCWIDTH}}', maxX + 100)
      .replace('{{LOGOTYPE}}', output)
      .replaceAll('{{TOPCOLOR}}', topColor.hex())
      .replaceAll('{{BOTTOMCOLOR}}', bottomColor.hex())
      .replaceAll('{{DARKCOLOR}}', darkColor.hex())
      .replaceAll('{{LIGHTCOLOR}}', lightColor.hex())

    // Write to file
    await fs.writeFile(path.join(outputPath, `${identity.key}.svg`), final)
    console.info(`Generated SVG for ${identity.key} successfully.`)
  }

  console.info('Done.')
} catch (err) {
  console.error(err)
  process.exit(1)
}
