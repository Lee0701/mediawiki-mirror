
const fs = require('fs')

const MirrorConfig = class MirrorConfig {
    constructor(sourceUrl='', title='Wiki Mirror') {
        this.sourceUrl = new URL(sourceUrl).href
        this.sourceWikiUrl = '/wiki'
        this.baseUrl = ''
        this.title = title
        this.mainPage = 'MainPage'
        this.lastUpdate = 0
        this.skinPath = 'skin'
    }
    json() {
        return JSON.stringify(this, null, 2)
    }
}

MirrorConfig.load = function(file) {
    const json = JSON.parse(fs.readFileSync(file).toString())
    const config = new MirrorConfig(json.sourceUrl)
    if(json.sourceWikiUrl) config.sourceWikiUrl = json.sourceWikiUrl
    if(json.title) config.title = json.title
    if(json.mainPage) config.mainPage = json.mainPage
    if(json.lastUpdate) config.lastUpdate = json.lastUpdate
    if(json.skinPath) config.skinPath = json.skinPath
    return config
}

module.exports = MirrorConfig
