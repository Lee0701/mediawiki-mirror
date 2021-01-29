
module.exports = class MirrorInfo {
    constructor(url='', lastUpdate=0) {
        this.url = new URL(url).href
        this.lastUpdate = lastUpdate
    }
    json() {
        return JSON.stringify(this)
    }
}
