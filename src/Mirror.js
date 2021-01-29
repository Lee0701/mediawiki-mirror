
const fs = require('fs')
const path = require('path')
const axios = require('axios')

const MirrorInfo = require('./MirrorInfo')

const MIRROR_INFO_FILENAME = 'mirror.json'

const Mirror = class Mirror {
    constructor(info, dir) {
        this.info = info
        this.dir = dir
    }
    writeInfo() {
        if(!fs.existsSync(this.dir)) fs.mkdirSync(this.dir)
        fs.writeFileSync(path.join(this.dir, MIRROR_INFO_FILENAME), this.info.json())
    }
    updateTitle(title) {
        return new Promise((resolve, reject) => {
            console.log(title)
            resolve(title)
        })
    }
    batchUpdate = (aplimit, apnamespace=0, apcontinue=null) => {
        return new Promise((resolve, reject) => {
            axios.get(new URL('/api.php', this.info.url).href, {
                params: {
                    action: 'query',
                    format: 'json',
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
                })
            }).catch((error) => {
                reject(error)
            })
        })
    }
    fullUpdate(interval, batch) {
        this.info.lastUpdate = new Date().getTime()
        const namespace = 0
        return new Promise((resolve, reject) => {
            const pages = []
            const update = (apcontinue) => {
                this.batchUpdate(batch, namespace, apcontinue).then(({apcontinue, updatedPages}) => {
                    pages.push(...updatedPages)
                    if(apcontinue == null) resolve({updatedPages: pages})
                    else setTimeout(() => update(apcontinue), interval)
                }).catch((error) => {
                    reject({error, updatedPages: pages})
                })
            }
            update()
        })
    }
    getPagePath(title) {
        return path.join(this.dir, 'pages', `${title}.html`)
    }
    getPageContent(title) {
        const path = this.getPagePath(title)
        if(!fs.existsSync(path)) return null
        return fs.readFileSync(path).toString()
    }
}

Mirror.init = function(url, dir) {
    const mirrorInfo = new MirrorInfo(url)
    const mirror = new Mirror(mirrorInfo, dir)
    return mirror
}

Mirror.load = function(dir) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, MIRROR_INFO_FILENAME)).toString())
    const mirrorInfo = new MirrorInfo(json.url, json.lastUpdate)
    const mirror = new Mirror(mirrorInfo, dir)
    return mirror
}

module.exports = Mirror
