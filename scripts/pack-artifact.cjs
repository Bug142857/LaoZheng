const fs = require('node:fs')
const path = require('node:path')

/**
 * 构建收尾：
 * 1. electron-builder 输出的版本是三段式（0.5.0），安装包名去掉末尾 .0（0.5）；
 * 2. 删除 release 目录里的旧版本安装包、blockmap、latest.yml 与调试文件，只留当前 exe。
 */
const root = path.resolve(__dirname, '..')
const release = path.join(root, 'release')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = pkg.build.productName
const displayVersion = pkg.version.replace(/\.0$/, '')

const built = path.join(release, `${productName} Setup ${pkg.version}.exe`)
const target = path.join(release, `${productName} Setup ${displayVersion}.exe`)

if (fs.existsSync(built) && built !== target) {
  fs.rmSync(target, { force: true })
  fs.renameSync(built, target)
}

if (!fs.existsSync(target)) {
  console.error(`[pack] installer not found: ${target}`)
  process.exit(1)
}

for (const name of fs.readdirSync(release)) {
  const full = path.join(release, name)
  const isInstaller = name.startsWith(`${productName} Setup `)
  if (isInstaller && full !== target) {
    fs.rmSync(full, { force: true })
  } else if (name === 'latest.yml' || name === 'builder-debug.yml') {
    fs.rmSync(full, { force: true })
  }
}

console.log(`[pack] installer: ${target}`)
