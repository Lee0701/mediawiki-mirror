
const fs = require('fs')

const MirrorConfig = class MirrorConfig {
    constructor(sourceUrl='', title='Wiki Mirror') {
        this.sourceUrl = new URL(sourceUrl).href
        this.sourceWikiUrl = '/wiki'
        this.mainPage = 'MainPage'
        this.namespaces = {}

        this.title = title
        this.baseUrl = ''
        this.skinPath = 'skin'

        this.lastUpdate = 0
    }
    json() {
        return JSON.stringify(this, null, 2)
    }
}

MirrorConfig.load = function(file) {
    const json = JSON.parse(fs.readFileSync(file).toString())
    const config = new MirrorConfig(json.sourceUrl)
    if(json.sourceWikiUrl) config.sourceWikiUrl = json.sourceWikiUrl
    if(json.mainPage) config.mainPage = json.mainPage
    if(json.namespaces) config.namespaces = json.namespaces

    if(json.title) config.title = json.title
    if(json.baseUrl) config.baseUrl = json.baseUrl
    if(json.skinPath) config.skinPath = json.skinPath
    if(json.lastUpdate) config.lastUpdate = json.lastUpdate
    
    return config
}

module.exports = MirrorConfig
