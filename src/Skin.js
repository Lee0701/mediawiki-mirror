
const fs = require('fs')
const path = require('path')
const {Liquid} = require('liquidjs')

const SKIN_CONFIG_FILENAME = 'skin.json'

const Skin = class Skin {
    constructor(dir) {
        this.liquid = new Liquid()
        try {
            const data = fs.readFileSync(path.join(dir, SKIN_CONFIG_FILENAME)).toString()
            const {index} = JSON.parse(data)
            this.index = fs.readFileSync(path.join(dir, index)).toString()
        } catch {
            this.index = ''
        }
    }
    formatIndex(vars) {
        return this.liquid.parseAndRenderSync(this.index, vars)
    }
}

module.exports = Skin
