
const cheerio = require('cheerio')

const WordIndex = require('./content/WordIndex')

const NUMBER_RANGE = '0-9'
const LATIN_RANGE = 'A-Za-z'
const HANJA_RANGE = '\u4E00-\u62FF\u6300-\u77FF\u7800-\u8CFF\u8D00-\u9FFF\u3400-\u4DBF'
const HANGUL_RANGE = '가-힣ㄱ-ㅎㅏ-ㅣ'
const WORD_RANGE = HANGUL_RANGE + HANJA_RANGE
const PUNCTUATIONS = '.,?!()[]{}<>'

const WORD_SPLIT_REGEX = new RegExp(`[\s${PUNCTUATIONS}]`)
const HANJA_WORD_REGEX = new RegExp(`[${HANJA_RANGE}]+`, 'g')
const HANJA_HANGUL_REGEX = new RegExp(`[${WORD_RANGE}]+`, 'g')
const NUMBER_WORD_REGEX = new RegExp(`[${NUMBER_RANGE}]+[${WORD_RANGE}]+`, 'g')
const LATIN_REGEX = new RegExp(`[${LATIN_RANGE}]+`, 'g')

const WordIndexer = class WordIndexer {
    constructor(mirror) {
        this.mirror = mirror
    }

    async buildWordList(rawPage) {
        const words = []
        const text = this.preprocess(rawPage.text)
        text.split(WORD_SPLIT_REGEX).forEach((word) => {
            if(word == '') return
            words.push(word.match(HANJA_WORD_REGEX))
            words.push(word.match(HANJA_HANGUL_REGEX))
            words.push(word.match(NUMBER_WORD_REGEX))
            words.push(word.match(LATIN_REGEX))
        })
        const result = words
                .filter((list) => list != null)
                .flat()
                .map((word) => [word, 1])
                .reduce((acc, [word, i]) => (acc[word] = (acc[word] || 0) + i, acc), {})
        return Object.entries(result)
    }

    async buildPage(wordList, rawPage) {
        const result = {}
        const title = rawPage.title
        const text = this.preprocess(rawPage.text)
        const textWords = text.split(WORD_SPLIT_REGEX)
        wordList.forEach((word) => {
            textWords.forEach((wordInText, index) => {
                const p = wordInText.indexOf(word)
                if(!p) return
                if(!result[word]) result[word] = new WordIndex(word)
                const surrounding = textWords.slice(index - 2, index + 2)
                result[word].addEntry(title, surrounding)
            })
        })
        return result
    }
    
    async build(wordList, rawPages) {
        const wordIndicesList = await Promise.all(rawPages.map((rawPage) => this.buildPage(wordList, rawPage)))
        return wordIndicesList.map(Object.entries).flat()
                .reduce((acc, [word, value]) => (acc[word] = acc[word] ? acc[word].merge(value) : value, acc), {})
    }

    preprocess(text) {
        return cheerio.load(text)('.mw-parser-output')
                .text().replace(/\n+/g, '\n')
    }

}

module.exports = WordIndexer
