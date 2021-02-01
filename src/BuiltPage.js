
const fs = require('fs')
const {mkdir} = require('./tools')

const BuiltPage = class BuiltPage {
    constructor(title, content) {
        this.title = title
        this.content = content
    }

    async write(pagePath) {
        mkdir(pagePath)
        const {title, content} = this
        const writeContent = JSON.stringify({title, content})
        fs.writeFileSync(pagePath, writeContent)
    }
}

module.exports = BuiltPage
