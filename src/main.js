
const express = require('express')
const Mirror = require('./Mirror')

const args = process.argv.slice(2)

const usage = () => 'main.js [init|fullupdate|fullbuild|serve]'

if(args.length > 0) {
    const command = args.shift()
    if(command == 'init') {
        if(args.length > 0) {
            const url = args[0]
            const dir = (args.length > 1) ? args[1] : '.'

            const mirror = Mirror.init(url, dir)
            mirror.writeMetadata()
        } else {
            console.log('main js init [url]')
        }
    } else if(command == 'fullupdate') {
        const dir = (args.length > 0) ? args[0] : '.'
        const mirror = Mirror.load(dir)
        console.log(`full update started.`)
        mirror.fullUpdate(1000, 10).then(({updatedPages}) => {
            console.log(`${updatedPages.length} pages updated.`)
            mirror.writeMetadata()
        }).catch(console.error)
    } else if(command == 'update') {
        const dir = (args.length > 0) ? args[0] : '.'
        const mirror = Mirror.load(dir)
        console.log(`update started.`)
        mirror.update().then(({updatedPages}) => {
            console.log(`${updatedPages.length} pages updated.`)
            mirror.writeMetadata()
        })
    } else if(command == 'fullbuild') {
        const dir = (args.length > 0) ? args[0] : '.'
        const mirror = Mirror.load(dir)
        console.log(`full build started.`)
        mirror.fullBuild().then(({builtPages}) => {
            console.log(`${builtPages.length} pages built.`)
            mirror.writeMetadata()
        })
    } else if(command == 'serve') {
        const dir = (args.length > 0) ? args[0] : '.'
        const port = (args.length > 1) ? args[1] : 8080
        const mirror = Mirror.load(dir)
        const app = express()
        const prefix = '/wiki'
        app.get(`${prefix}/*`, (req, res) => {
            const url = decodeURIComponent(req.url.replace(prefix, ''))
            console.log(url)
            const title = (url.charAt(0) == '/') ? url.slice(1) : url
            const content = mirror.getPageContent(title)
            if(content === null) res.status(404).send('404')
            else res.status(200).send(content)
        })
        app.listen(port)
    } else {
        console.log(usage())
    }
} else {
    console.log(usage())
}
