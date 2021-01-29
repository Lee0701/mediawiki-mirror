
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const MirrorConfig = require('./MirrorConfig')
const Skin = require('./Skin')

const API_ENDPOINT = '/api.php'

const MIRROR_CONFIG_FILENAME = 'mirror.json'
const TITLES_FILENAME = 'titles.txt'
const PAGES_PATHNAME = 'pages'
const RAWS_PATHNAME = 'raws'

const Mirror = class Mirror {
    constructor(config, dir) {
        this.config = config
        this.dir = dir
        this.skin = new Skin(path.join(this.dir, config.skinPath))
        this.readTitles()
    }
    writeConfig() {
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir)
        fs.writeFileSync(path.join(this.dir, MIRROR_CONFIG_FILENAME), this.config.json())
    }
    writeTitles() {
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir)
        fs.writeFileSync(path.join(this.dir, TITLES_FILENAME), this.titles.join('\n'))
    }
    writeMetadata() {
        this.writeConfig()
        this.writeTitles()
    }
    readTitles() {
        if(!fs.existsSync(path.join(this.dir, TITLES_FILENAME))) return
        this.titles = fs.readFileSync(path.join(this.dir, TITLES_FILENAME)).toString().split('\n')
    }
    writeRaw(page) {
        return new Promise((resolve, reject) => {
            fs.writeFile(this.getRawPath(page.title), page.content, (error) => {
                if(error) reject(error)
                else resolve()
            })
        })
    }
    writePage(page) {
        return new Promise((resolve, reject) => {
            fs.writeFile(this.getPagePath(page.title), this.skin.formatIndex({site: this.config, page}), (error) => {
                if(error) reject(error)
                else resolve()
            })
        })
    }
    writePageAndRaw(page) {
        return Promise.all([this.writePage(page), this.writeRaw(page)])
    }
    updateTitle(title) {
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.url).href, {
                params: {
                    format: 'json',
                    action: 'parse',
                    page: title,
                    prop: 'text',
                    formatversion: 2
                }
            }).then(({data}) => {
                const {title, text} = data.parse
                const content = text
                const page = {title, content}
                this.writePageAndRaw(page).then(() => resolve(page)).catch((error) => reject({error}))
            }).catch((error) => {
                reject({error})
            })
        })
    }
    updateBatch = (aplimit, apnamespace=0, apcontinue=null) => {
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.url).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'allpages',
                    aplimit,
                    apnamespace,
                    apcontinue,
                }
            }).then(({data}) => {
                const titles = data.query.allpages.map(({title}) => title)
                const apcontinue = data.continue ? data.continue.apcontinue : null
                Promise.all(titles.map((title) => this.updateTitle(title))).then((updatedPages) => {
                    resolve({apcontinue, updatedPages})
                }).catch((errors) => reject({error: errors}))
            }).catch((error) => {
                reject({error})
            })
        })
    }
    fullUpdate(interval, batch) {
        this.config.lastUpdate = new Date().getTime()
        this.mkdirs()
        const namespace = 0
        return new Promise((resolve, reject) => {
            const pages = []
            const update = (apcontinue) => {
                this.updateBatch(batch, namespace, apcontinue).then(({apcontinue, updatedPages}) => {
                    pages.push(...updatedPages)
                    if(apcontinue == null) {
                        this.titles = pages.map(({title}) => title)
                        resolve({updatedPages: pages})
                    } else {
                        setTimeout(() => update(apcontinue), interval)
                    }
                }).catch(({error}) => {
                    reject({error, updatedPages: pages})
                })
            }
            update()
        })
    }
    update() {
        const rcnamespace = 0
        const rcend = Math.floor(this.config.lastUpdate / 1000)
        this.config.lastUpdate = new Date().getTime()
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.url).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'recentchanges',
                    rclimit: 'max',
                    rcnamespace,
                    rcend,
                }
            }).then(({data}) => {
                const titles = data.query.recentchanges.map(({title}) => title)
                Promise.all(titles.map((title) => this.updateTitle(title))).then((updatedPages) => {
                    resolve({updatedPages})
                }).catch((errors) => reject({error: errors}))
            }).catch((error) => reject({error}))
        })
    }
    buildPage(title) {
        return new Promise((resolve, reject) => {
            fs.readFile(this.getRawPath(title), (error, data) => {
                if(error) reject(error)
                else {
                    const content = data.toString()
                    this.writePage({title, content}).then(() => resolve({title, content})).catch(reject)
                }
            })
        })
    }
    fullBuild() {
        return new Promise((resolve, reject) => {
            Promise.all(this.titles.map((title) => this.buildPage(title)))
                    .then((builtPages) => resolve({builtPages}))
                    .catch(reject)
        })
    }
    escapeTitle(title) {
        return title.replace(/\$/g, '$$').replace(/\//g, '$s')
    }
    getRawPath(title) {
        return path.join(this.dir, RAWS_PATHNAME, `${this.escapeTitle(title)}.txt`)
    }
    getPagePath(title) {
        return path.join(this.dir, PAGES_PATHNAME, `${this.escapeTitle(title)}.html`)
    }
    mkdirs() {
        const pages = path.join(this.dir, PAGES_PATHNAME)
        if(!fs.existsSync(pages)) fs.mkdirSync(pages)
        const raws = path.join(this.dir, RAWS_PATHNAME)
        if(!fs.existsSync(raws)) fs.mkdirSync(raws)
    }
    getPageContent(title) {
        const path = this.getPagePath(title)
        if(!fs.existsSync(path)) return null
        return fs.readFileSync(path).toString()
    }
}

Mirror.init = function(url, dir) {
    const config = new MirrorConfig(url)
    const mirror = new Mirror(config, dir)
    return mirror
}

Mirror.load = function(dir) {
    const config = MirrorConfig.load(path.join(dir, MIRROR_CONFIG_FILENAME))
    const mirror = new Mirror(config, dir)
    return mirror
}

module.exports = Mirror
