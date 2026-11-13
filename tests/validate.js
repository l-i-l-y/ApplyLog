const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const compilerDirectory = process.argv[2]
if (!compilerDirectory) {
  throw new Error('Pass the installed WeChat wcc-exec directory as the first argument')
}

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name)
    return entry.isDirectory() ? files(full) : [full]
  })
}

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout)
    throw new Error(path.basename(executable) + ' exited with code ' + result.status)
  }
  if (result.stderr) process.stderr.write(result.stderr)
}

const all = files(root)
const jsonFiles = all.filter(file => file.endsWith('.json'))
jsonFiles.forEach(file => JSON.parse(fs.readFileSync(file, 'utf8')))
console.log('JSON parse OK: ' + jsonFiles.length)
const jsFiles = all.filter(file => file.endsWith('.js'))
jsFiles.forEach(file => run(process.execPath, ['--check', file]))
console.log('JS syntax OK: ' + jsFiles.length)
const wxmlFiles = all.filter(file => file.endsWith('.wxml'))
run(path.join(compilerDirectory, 'wcc.exe'), wxmlFiles.map(file => path.relative(root, file)))
console.log('Native WXML compilation OK: ' + wxmlFiles.length)
const wxssFiles = all.filter(file => file.endsWith('.wxss'))
run(path.join(compilerDirectory, 'wcsc.exe'), ['-lc', ...wxssFiles.map(file => path.relative(root, file))])
console.log('Native WXSS compilation/lint OK: ' + wxssFiles.length)

const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
if (app.renderer !== 'skyline' || app.componentFramework !== 'glass-easel' || app.lazyCodeLoading !== 'requiredComponents') {
  throw new Error('Required mini-program framework configuration changed')
}
for (const page of app.pages) {
  const wxml = fs.readFileSync(path.join(root, page + '.wxml'), 'utf8')
  if (!/<scroll-view[^>]*type="list"[^>]*scroll-y/.test(wxml)) throw new Error('Missing list scroll-view: ' + page)
  const config = JSON.parse(fs.readFileSync(path.join(root, page + '.json'), 'utf8'))
  if (!config.usingComponents || !config.usingComponents['navigation-bar']) throw new Error('Missing navigation-bar: ' + page)
}
console.log('Skyline/glass-easel/requiredComponents, navigation-bar and six list scroll-views OK')
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'))
if (!project.packOptions.ignore.some(item => item.type === 'folder' && item.value === 'tests')) {
  throw new Error('Node-only tests must be excluded from mini-program packaging')
}
console.log('Node tests excluded from mini-program packaging OK')
