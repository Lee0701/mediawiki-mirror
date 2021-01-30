
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')

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
        this.titles = []
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

    updateMeta() {
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    meta: 'siteinfo',
                    siprop: 'general|namespaces',
                }
            }).then(({data}) => {
                const {general, namespaces} = data.query
                Object.entries(namespaces).forEach(([key, value]) => namespaces[key] = value['*'])

                this.config.mainPage = general.mainpage
                this.config.namespaces = namespaces
                resolve()
            }).catch((error) => reject({error}))
        })
    }

    writeRaw(title, rawPage) {
        return new Promise((resolve, reject) => {
            const content = JSON.stringify(rawPage, null, 2)
            fs.writeFile(this.getRawPath(title), content, (error) => {
                if(error) reject(error)
                else resolve()
            })
        })
    }

    writePage(title, content) {
        return new Promise((resolve, reject) => {
            fs.writeFile(this.getPagePath(title), content, (error) => {
                if(error) reject(error)
                else resolve()
            })
        })
    }

    getCategoryMembers(cmtitle) {
        return new Promise((resolve, reject) => {
            const members = []
            const continueQuery = (cmcontinue) => {
                axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                    params: {
                        format: 'json',
                        action: 'query',
                        list: 'categorymembers',
                        cmtitle,
                        cmcontinue,
                    }
                }).then(({data}) => {
                    const result = data.query.categorymembers.map(({title}) => title)
                    members.push(...result)
                    if(data.continue) continueQuery(data.continue.cmcontinue)
                    else resolve(members)
                }).catch(reject)
            }
            continueQuery()
        })
    }

    updatePage(title) {
        return new Promise((resolve, reject) => {
            const isCategory = title.indexOf(':') !== -1
                    && title.slice(0, title.indexOf(':')) == this.config.namespaces[14]
            const getContent = axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'parse',
                    page: title,
                    prop: 'text|categories',
                    formatversion: 2,
                }
            })
            const promises = [getContent]
            if(isCategory) promises.push(this.getCategoryMembers(title))
            Promise.all(promises).then((results) => {
                const {title, text} = results[0].data.parse
                const categories = results[0].data.parse.categories.map(({category}) => category)
                const page = {title, text, categories}
                if(isCategory && results.length > 1) page.members = results[1]
                this.writeRaw(title, page).then(() => {
                    this.buildPage(page).then(resolve).catch(reject)
                }).catch((error) => reject({error}))
            }).catch((error) => {
                reject({error})
            })
        })
    }

    updateBatch = (aplimit, apnamespace, apcontinue=null) => {
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
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
                Promise.all(titles.map((title) => this.updatePage(title))).then((updatedPages) => {
                    resolve({apcontinue, updatedPages})
                }).catch((errors) => reject({error: errors}))
            }).catch((error) => {
                reject({error})
            })
        })
    }

    fullUpdate(namespace, interval, batch) {
        return new Promise((resolve, reject) => {
            const pages = []
            const update = (apcontinue) => {
                this.updateBatch(batch, namespace, apcontinue).then(({apcontinue, updatedPages}) => {
                    pages.push(...updatedPages)
                    if(apcontinue) setTimeout(() => update(apcontinue), interval)
                    else resolve({updatedPages: pages})
                }).catch(({error}) => {
                    reject({error, updatedPages: pages})
                })
            }
            update()
        })
    }

    fullUpdateAllNamespaces(interval, batch) {
        this.config.lastUpdate = new Date().getTime()
        this.mkdirs()
        return new Promise((resolve, reject) => {
            const promises = this.config.pageNamespaces.map((namespace) => this.fullUpdate(namespace, interval, batch))
            Promise.all(promises).then((result) => {
                resolve({updatedPages: result.map(({updatedPages}) => updatedPages).flat()})
            }).catch(reject)
        })
    }

    update() {
        const rcnamespace = this.config.pageNamespaces.join('|')
        const rcend = Math.floor(this.config.lastUpdate / 1000) // //milliseconds to seconds
        this.config.lastUpdate = new Date().getTime()
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
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
                Promise.all(titles.map((title) => this.updatePage(title))).then((updatedPages) => {
                    resolve({updatedPages})
                }).catch((errors) => reject({error: errors}))
            }).catch((error) => reject({error}))
        })
    }

    buildPage(rawPage) {
        return new Promise((resolve, reject) => {
            const title = rawPage.title
            const text = rawPage.text.toString()
            const categories = (rawPage.categories || [])
                    .map((c) => ({name: c, url: `${this.config.baseUrl}/${encodeURIComponent(this.config.namespaces[14] + ':' + c)}`}))
            const members = (rawPage.members || [])
                    .map((m) => ({name: m, url: `${this.config.baseUrl}/${encodeURIComponent(m)}`}))
            const page = {title, content: text, categories, members}
            const $ = cheerio.load(text)
            const mwParserOutput = $('.mw-parser-output')
    
            mwParserOutput.contents().filter((_i, {type}) => type === 'comment').remove()
            mwParserOutput.find('a').attr('href', (_i, href) => {
                if(!href) return
                const replace = this.config.sourceWikiUrl
                const to = this.config.baseUrl
                if(href.slice(0, replace.length) == replace) {
                    return to + href.slice(replace.length)
                } else return href
            })
            page.content = mwParserOutput.html().replace(/\r?\n\r?\n/g, '\n')
            page.content = this.skin.formatIndex({site: this.config, page})
    
            this.writePage(title, page.content)
                    .then(() => resolve(page))
                    .catch((error) => reject({error}))
        })
    }

    buildPageWithTitle(title) {
        return new Promise((resolve, reject) => {
            fs.readFile(this.getRawPath(title), (error, data) => {
                if(error) reject(error)
                else {
                    this.buildPage(JSON.parse(data)).then(resolve).catch(reject)
                }
            })
        })
    }

    fullBuild() {
        return new Promise((resolve, reject) => {
            fs.readdir(path.join(this.dir, RAWS_PATHNAME), (error, list) => {
                if(error) return reject(error)
                else Promise.all(list.map((title) => new Promise((resolve, reject) => {
                    fs.readFile(path.join(this.dir, RAWS_PATHNAME, title), (error, data) => {
                        if(error) reject(error)
                        else {
                            this.buildPage(JSON.parse(data)).then(resolve).catch(reject)
                        }
                    })
                }))).then((builtPages) => {
                    resolve({builtPages})
                }).catch(reject)
            })
        })
    }

    escapeTitle(title) {
        return title.replace(/\$/g, '$$').replace(/\//g, '$s')
    }

    getRawPath(title) {
        return path.join(this.dir, RAWS_PATHNAME, `${this.escapeTitle(title)}.json`)
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
