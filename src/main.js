
const express = require('express')
const Mirror = require('./Mirror')

const args = process.argv.slice(2)

if(args.length > 0) {
    const command = args.shift()
    if(command == 'init') {
        if(args.length > 0) {
            const url = args[0]
            const dir = (args.length > 1) ? args[1] : '.'

            const mirror = Mirror.init(url, dir)
            mirror.writeInfo()
        } else {
            console.log('main js init [url]')
        }
    } else if(command == 'fullupdate') {
        const dir = (args.length > 0) ? args[0] : '.'
        const mirror = Mirror.load(dir)
        console.log(`full update started.`)
        mirror.fullUpdate(1000, 10).then(({updatedPages}) => {
            console.log(`${updatedPages.length} pages updated.`)
            mirror.writeInfo()
        }).catch(console.error)
    } else if(command == 'serve') {
        const dir = (args.length > 0) ? args[0] : '.'
        const port = (args.length > 1) ? args[1] : 8080
        const mirror = Mirror.load(dir)
        const app = express()
        app.get('/*', (req, res) => {
            console.log(req.url)
            const url = decodeURIComponent(req.url)
            const title = (url.charAt(0) == '/') ? url.slice(1) : url
            const content = mirror.getPageContent(title)
            if(content === null) res.status(404).send('404')
            else res.status(200).send(content)
        })
        app.listen(port)
    }
} else {
    console.log('main.js [init]')
}
