
const fs = require('fs')

const MirrorConfig = class MirrorConfig {
    constructor(url='', title='Wiki Mirror') {
        this.url = new URL(url).href
        this.title = title
        this.lastUpdate = 0
        this.skinPath = 'skin'
    }
    json() {
        return JSON.stringify(this, null, 2)
    }
}

MirrorConfig.load = function(file) {
    const json = JSON.parse(fs.readFileSync(file).toString())
    const config = new MirrorConfig(json.url)
    if(json.title) config.title = json.title
    if(json.lastUpdate) config.lastUpdate = json.lastUpdate
    if(json.skinPath) config.skinPath = json.skinPath
    return config
}

module.exports = MirrorConfig
