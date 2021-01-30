
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')

const MirrorConfig = require('./MirrorConfig')
const Skin = require('./Skin')

const API_ENDPOINT = '/api.php'

const MIRROR_CONFIG_FILENAME = 'mirror.json'
const RAWS_PATHNAME = 'raws'
const PAGES_PATHNAME = 'pages'
const IMAGES_PATHNAME = 'images'

const Mirror = class Mirror {

    constructor(config, dir) {
        this.config = config
        this.dir = dir
        this.skin = new Skin(path.join(this.dir, config.skinPath))
    }

    writeConfig() {
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir)
        fs.writeFileSync(path.join(this.dir, MIRROR_CONFIG_FILENAME), this.config.json())
    }
    
    writeMetadata() {
        this.writeConfig()
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
            const rawPath = this.getRawPath(title)
            const content = JSON.stringify(rawPage, null, 2)
            fs.mkdirSync(path.dirname(rawPath), {recursive: true})
            fs.writeFile(rawPath, content, (error) => {
                if(error) reject(error)
                else resolve()
            })
        })
    }

    writePage(title, content) {
        return new Promise((resolve, reject) => {
            const pagePath = this.getPagePath(title)
            fs.mkdirSync(path.dirname(pagePath), {recursive: true})
            fs.writeFile(pagePath, content, (error) => {
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
            const getCategories = axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    titles: title,
                    prop: 'categories',
                }
            })
            const promises = [getContent, getCategories]
            if(isCategory) promises.push(this.getCategoryMembers(title))
            Promise.all(promises).then((results) => {
                const {title, text} = results[0].data.parse
                const categories = (Object.values(results[1].data.query.pages)[0].categories || [])
                        .map(({title}) => title)
                const page = {title, text, categories}
                if(isCategory && results.length > 2) page.members = results[2]
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

    fullUpdatePages(namespace, interval, batch) {
        return new Promise((resolve, reject) => {
            const pages = []
            const update = (apcontinue) => {
                axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                    params: {
                        format: 'json',
                        action: 'query',
                        list: 'allpages',
                        aplimit: batch,
                        apnamespace: namespace,
                        apcontinue,
                    }
                }).then(({data}) => {
                    const titles = data.query.allpages.map(({title}) => title)
                    const apcontinue = data.continue ? data.continue.apcontinue : null
                    Promise.all(titles.map((title) => this.updatePage(title))).then((updatedPages) => {
                        pages.push(...updatedPages)
                        if(apcontinue) setTimeout(() => update(apcontinue), interval)
                        else resolve({updatedPages: pages})
                    }).catch((errors) => reject({error: errors, updatedPages: pages}))
                }).catch((error) => {
                    reject({error, updatedPages: pages})
                })
            }
            update()
        })
    }

    fullUpdateAllNamespaces(interval, batch) {
        this.config.lastUpdate = new Date().getTime()
        this.mkdirs()
        return new Promise(async (resolve, reject) => {
            const updatedPages = []
            try {
                for(let namespace of this.config.pageNamespaces) {
                    updatedPages.push(...(await this.fullUpdatePages(namespace, interval, batch)).updatedPages)
                }
                resolve({updatedPages})
            } catch(error) {
                reject({error, updatedPages})
            }
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
            const pagesBaseUrl = this.config.baseUrl + '/' + PAGES_PATHNAME
            const imagesBaseUrl = this.config.baseUrl + '/' + IMAGES_PATHNAME

            const title = rawPage.title
            const text = rawPage.text.toString()

            const categories = (rawPage.categories || []).map((c) => ({
                name: c.slice(c.indexOf(':') + 1),
                url: `${pagesBaseUrl}/${encodeURIComponent(c)}`
            }))
            const members = (rawPage.members || [])
                    .map((m) => ({name: m, url: `${pagesBaseUrl}/${encodeURIComponent(m)}`}))
            
            const page = {title, content: text, categories, members}
            const $ = cheerio.load(text)
            const mwParserOutput = $('.mw-parser-output')
    
            mwParserOutput.contents().filter((_i, {type}) => type === 'comment').remove()
            mwParserOutput.find('a').attr('href', (_i, href) => {
                if(!href) return
                if(href.charAt(0) !== '/') href = '/' + href
                const replace = this.config.sourceWikiUrl
                const to = pagesBaseUrl
                const indexPhp = '/index.php'
                if(href.slice(0, replace.length) == replace) {
                    return to + href.slice(replace.length)
                } else if(href.slice(0, indexPhp.length) == indexPhp) {
                    return new URL(href, this.config.sourceUrl).href
                } else return href
            })
            mwParserOutput.find('img').attr('src', (_i, src) => {
                if(!src) return
                if(src.charAt(0) !== '/') src = '/' + src
                const replace = this.config.sourceImagesUrl
                const to = imagesBaseUrl
                if(src.slice(0, replace.length) == replace) {
                    return to + src.slice(replace.length)
                } else return src
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
                else {
                    list = list.map((title) => path.join(this.dir, RAWS_PATHNAME, title))
                    list = list.filter((rawPath) => !fs.statSync(rawPath).isDirectory())
                    Promise.all(list.map((rawPath) => new Promise((resolve, reject) => {
                        fs.readFile(rawPath, (error, data) => {
                            if(error) reject(error)
                            else {
                                this.buildPage(JSON.parse(data)).then(resolve).catch(reject)
                            }
                        })
                    }))).then((builtPages) => {
                        resolve({builtPages})
                    }).catch(reject)
                }
            })
        })
    }

    downloadImage(sourceUrl, destPath) {
        return new Promise((resolve, reject) => {
            axios.get(sourceUrl, {
                responseType: 'stream',
            }).then(({data}) => {
                fs.mkdirSync(path.dirname(destPath), {recursive: true})
                const writer = fs.createWriteStream(destPath)
                data.pipe(writer)
                writer.on('finish', resolve)
                writer.on('error', reject)
            }).catch(reject)
        })
    }

    updateImage(title) {
        return new Promise((resolve, reject) => {
            axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    titles: title,
                    prop: 'imageinfo',
                    iiprop: 'url',
                }
            }).then(({data}) => {
                const sourceUrl = Object.values(data.query.pages)[0].imageinfo[0].url
                const destUrl = sourceUrl.slice(new URL('images', this.config.sourceUrl).href.length)
                const destPath = this.getImagePath(destUrl)
                console.log(destUrl)
                this.downloadImage(sourceUrl, destPath).then(resolve).catch(reject)
            }).catch((error) => reject({error}))
        })
    }

    fullUpdateImages(interval, batch) {
        return new Promise((resolve, reject) => {
            const images = []
            const update = (aicontinue) => {
                axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                    params: {
                        format: 'json',
                        action: 'query',
                        list: 'allimages',
                        ailimit: batch,
                        aicontinue,
                    }
                }).then(({data}) => {
                    const titles = data.query.allimages.map(({title}) => title)
                    const aicontinue = data.continue ? data.continue.aicontinue : null
                    Promise.all(titles.map((title) => this.updateImage(title))).then((updatedImages) => {
                        images.push(...updatedImages)
                        if(aicontinue) setTimeout(() => update(aicontinue), interval)
                        else resolve({updatedImages: images})
                    }).catch((errors) => reject({error: errors, updatedImages: images}))
                }).catch((error) => {
                    reject({error, updatedImages: images})
                })
            }
            update()
        })
    }

    getRawPath(title) {
        return path.join(this.dir, RAWS_PATHNAME, `${title}.json`)
    }

    getPagePath(title) {
        return path.join(this.dir, PAGES_PATHNAME, `${title}.html`)
    }

    getImagePath(imagePath) {
        return path.join(this.dir, IMAGES_PATHNAME, imagePath)
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

    getImage(imagePath) {
        imagePath = path.join(this.dir, IMAGES_PATHNAME, imagePath)
        if(!fs.existsSync(imagePath)) return null
        return fs.readFileSync(imagePath)
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
