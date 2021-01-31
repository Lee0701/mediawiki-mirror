
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const cheerio = require('cheerio')

const MirrorConfig = require('./MirrorConfig')
const Skin = require('./Skin')

const API_ENDPOINT = '/api.php'

const MIRROR_CONFIG_FILENAME = 'mirror.json'
const PAGE_EXTENSION = '.html'
const RAWS_PATHNAME = 'raws'
const PAGES_PATHNAME = 'wiki'
const IMAGES_PATHNAME = 'images'

const Mirror = class Mirror {

    constructor(config, dir) {
        this.config = config
        this.dir = dir
        this.skin = new Skin(path.join(this.dir, config.skinPath))
        this.axios = axios.create({
            baseURL: this.config.sourceUrl,
        })

        this.pagesBaseUrl = this.config.baseUrl + '/' + PAGES_PATHNAME
        this.imagesBaseUrl = this.config.baseUrl + '/' + IMAGES_PATHNAME
    }

    sleep(duration) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(), duration)
        })
    }

    writeConfig() {
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir)
        fs.writeFileSync(path.join(this.dir, MIRROR_CONFIG_FILENAME), this.config.json())
    }
    
    writeMetadata() {
        this.writeConfig()
    }
    
    async updateMeta() {
        const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
            params: {
                format: 'json',
                action: 'query',
                meta: 'siteinfo',
                siprop: 'general|namespaces',
            }
        })
        const {general, namespaces} = data.query
        Object.entries(namespaces).forEach(([key, value]) => namespaces[key] = value['*'])

        this.config.mainPage = general.mainpage
        this.config.namespaces = namespaces

    }

    writeRaw(rawPage) {
        return new Promise((resolve, reject) => {
            const rawPath = this.getRawPath(rawPage.title)
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

    async getCategoryMembers(cmtitle) {
        const members = []
        let cmcontinue = null
        do {
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'categorymembers',
                    cmtitle,
                    cmcontinue,
                }
            })
            const result = data.query.categorymembers.map(({title}) => title)
            members.push(...result)
        } while(cmcontinue)
        return members
    }

    async updatePage(title, images=true) {
        const isCategory = title.indexOf(':') !== -1
                && title.slice(0, title.indexOf(':')) == this.config.namespaces[14]
        const {data} = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'parse',
                page: title,
                prop: 'text|categories',
                formatversion: 2,
            }
        })
        const categoriesResult = await this.axios.get(API_ENDPOINT, {
            params: {
                format: 'json',
                action: 'query',
                titles: title,
                prop: 'categories',
            }
        })
        const categories = (Object.values(categoriesResult.data.query.pages)[0].categories || []).map(({title}) => title)
        if(!data.parse) return null
        const {text} = data.parse
        const page = {title, text, categories}
        if(isCategory) page.members = await this.getCategoryMembers(title)
        if(images) {
            const $ = cheerio.load(text)
            $('img').each(async (_i, img) => {
                const sourceUrl = new URL(img.attribs['src'], this.config.sourceUrl)
                const destPath = this.getImagePath(sourceUrl)
                this.downloadImage(sourceUrl.href, destPath)
            })
        }
        await this.writeRaw(title, page)
        await this.buildPage(page)
        return page
    }

    async fullUpdatePages(namespace, interval, batch, images=true) {
        const updatedPages = []
        let apcontinue = null
        do {
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'allpages',
                    aplimit: batch,
                    apnamespace: namespace,
                    apcontinue,
                }
            })
            const titles = data.query.allpages.map(({title}) => title)
            apcontinue = data.continue ? data.continue.apcontinue : null
            updatedPages.push(...await Promise.all(titles.map((title) => this.updatePage(title, images))))
            await this.sleep(interval)
        } while(apcontinue)
        return updatedPages.filter((page) => page)
    }

    async fullUpdateAllNamespaces(interval, batch) {
        this.config.lastUpdate = new Date().getTime()
        this.mkdirs()
        const result = []
        for(let namespace of this.config.pageNamespaces) {
            result.push(...await this.fullUpdatePages(namespace, interval, batch))
        }
        return result
    }

    async updatePages(interval, batch, images) {
        const rcnamespace = this.config.pageNamespaces.join('|')
        const rcend = Math.floor(this.config.lastUpdate / 1000) // //milliseconds to seconds
        this.config.lastUpdate = new Date().getTime()
        const updatedPages = []
        let rccontinue = null
        do {
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'recentchanges',
                    rclimit: batch,
                    rcnamespace,
                    rcend,
                    rccontinue,
                }
            })
            const titles = data.query.recentchanges.map(({title}) => title)
            updatedPages.push(...await Promise.all(titles.map((title) => this.updatePage(title, images))))
            await this.sleep(interval)
        } while(rccontinue)
        return updatedPages.filter((page) => page)
    }

    async buildPage(rawPage) {
        const title = rawPage.title
        const text = rawPage.text.toString()

        const categories = (rawPage.categories || []).map((category) => ({
            name: category.split(':')[0],
            url: this.processLink(category)
        }))
        const members = (rawPage.members || [])
                .map((m) => ({name: m, url: `${this.pagesBaseUrl}/${encodeURIComponent(m)}`}))
        
        const page = {title, content: text, categories, members}
        const $ = cheerio.load(text)
        const mwParserOutput = $('.mw-parser-output')

        mwParserOutput.contents().filter((_i, {type}) => type === 'comment').remove()
        mwParserOutput.find('a').attr('href', (_i, href) => {
            if(!href) return
            return this.processLink(href)
        })
        mwParserOutput.find('img').attr('src', (_i, src) => {
            if(!src) return
            return this.processImageSrc(src)
        })
        page.content = mwParserOutput.html().replace(/\r?\n\r?\n/g, '\n')
        page.content = this.skin.formatIndex({site: this.config, page})

        return await this.writePage(title, page.content)
    }

    async buildPageWithTitle(title) {
        const data = fs.readFileSync(this.getRawPath(title))
        return await this.buildPage(JSON.parse(data)).then(resolve).catch(reject)
    }

    async fullBuild() {
        let list = fs.readdirSync(path.join(this.dir, RAWS_PATHNAME))
        list = list.map((title) => path.join(this.dir, RAWS_PATHNAME, title))
        list = list.filter((rawPath) => !fs.statSync(rawPath).isDirectory())
        return list.map(async (rawPath) => {
            const data = fs.readFileSync(rawPath)
            return await this.buildPage(JSON.parse(data))
        })
    }

    async updateImage(title) {
        const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
            params: {
                format: 'json',
                action: 'query',
                titles: title,
                prop: 'imageinfo',
                iiprop: 'url',
            }
        })
        const sourceUrl = new URL(Object.values(data.query.pages)[0].imageinfo[0].url)
        const destPath = this.getImagePath(sourceUrl)
        return this.downloadImage(sourceUrl.href, destPath)
    }

    async fullUpdateImages(interval, batch) {
        const updatedImages = []
        let aicontinue = null
        do {
            const {data} = await axios.get(new URL(API_ENDPOINT, this.config.sourceUrl).href, {
                params: {
                    format: 'json',
                    action: 'query',
                    list: 'allimages',
                    ailimit: batch,
                    aicontinue,
                }
            })
            const titles = data.query.allimages.map(({title}) => title)
            aicontinue = data.continue ? data.continue.aicontinue : null
            updatedImages.push(...await Promise.all(titles.map((title) => this.updateImage(title))))
            await this.sleep(interval)
        } while(aicontinue)
        return updatedImages
    }

    processLink(href) {
        const indexPhp = '/index.php'
        const url = new URL(href, this.config.sourceUrl)
        const path = url.pathname.split('/')
        if(path.slice(0, 2).join('/') == this.config.sourceWikiUrl) {
            return path.join('/') + PAGE_EXTENSION
        } else if(href.slice(0, indexPhp.length) == indexPhp) {
            return url.href
        } else return href
    }

    processImageSrc(src) {
        const url = new URL(src, this.config.sourceUrl)
        const path = url.pathname.split('/')
        if(path.slice(0, 2).join('/') == this.config.sourceImagesUrl) {
            return path.join('/')
        } else return src
    }

    getRawPath(title) {
        return path.join(this.dir, RAWS_PATHNAME, `${title}.json`)
    }

    getPagePath(title) {
        return path.join(this.dir, PAGES_PATHNAME, `${title}.html`)
    }

    getImagePath(sourceUrl) {
        return path.join(this.dir, IMAGES_PATHNAME, sourceUrl.pathname.split('/').slice(2).join('/'))
    }

    mkdirs() {
        const pages = path.join(this.dir, PAGES_PATHNAME)
        if(!fs.existsSync(pages)) fs.mkdirSync(pages)
        const raws = path.join(this.dir, RAWS_PATHNAME)
        if(!fs.existsSync(raws)) fs.mkdirSync(raws)
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
