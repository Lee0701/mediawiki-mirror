
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
        mirror.fullUpdate(1000, 10).then(console.log)
        mirror.writeInfo()
    }
} else {
    console.log('main.js [init]')
}
