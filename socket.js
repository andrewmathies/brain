const mqtt = require('mqtt')
const usb = require('usb')
const fnv = require('fnv-plus')
const SegFaultHandler = require('segfault-handler')
const GeaNode = require('gea-communication').DualNode
const unitManager = require('../applcommon.sbc-pi-update/index')

let unitDict = []
let q = []

let updating = false

const mqttClient = mqtt.connect('tls://saturten.com:8883', {username: 'andrew', password: '1plus2is3'})
const masterNode = createNode()

class Unit {
	constructor(beanID, version, node) {
		this.beanID = beanID
		this.version = version
		this.node = node
	}
}

const message = {
    HELLO: 0,
    SUCCESS: 1,
    FAIL: 2
}

// "Main" -------------------------------------------------------------

SegFaultHandler.registerHandler('crash.log')

(async () => {
    await checkForNodes()
})()

// Event Listeners
usb.on('attach', () => {
    console.log('detected new usb device')
    await checkForNodes()
})
 
mqttClient.on('connect', () => {
    for (let [key, unit] of Object.entries(unitDict)) {
        client.subscribe('unit/' + unit.beanID + '/', (err) => {
            if (!err) {
                publish(message.HELLO, unit.beanID)
            }
        })
    }
})

mqttClient.on('message', (topic, message) => {
    console.log('topic: ' + topic)
    console.log('message: ' + message.toString())

    let topicParts = topic.split('/')

    if (topicParts.length !== 3) {
        console.log('unexpected topic')
        return
    }

    let msg = JSON.parse(message.toString())

    if (msg.header === 'StartUpdate') {
        let beanID = topicParts[1]
        let key = hash(beanID)
        unitDict[key].version = msg.version
        update(key)
    }
})

// Functions ----------------------------------------------------------

function publish(type, beanID) {
    let msg

    switch (type) {
        case message.HELLO:
            let key = hash(beanID)
            let unit = unitDict[key]
            msg = {header: 'Hello', version: unit.version}
            break
        case message.SUCCESS:
            msg = {header: 'Success'}
            break
        case message.FAIL:
            msg = {header: 'Fail'}
            break
        default:
            console.log('ERR - mqtt publish request with unknown message type')
            return
    }

    client.publish('unit/' + beanID + '/', JSON.stringify(msg))
}

function hash(beanID) {
    return fnv.hash(beanID, 64).dec()
}

function update(key) {
	if (updating) {
        q.push(key)
	    return
    }

    updating = true

    let unit = unitDict[key]
	console.log('Updating unit ' + unit.beanID + ' to ' + unit.version)
	unitManager.requestUpdate(unit.node, unit.version)
}

async function checkForNodes() {
    let nodes = await masterNode.list()

    for (let i = 0; i < nodes.length; i++) {
        let beanID = nodes[i].uid()
        let key = hash(beanID)
        
        if (!(key in unitDict)) {
            unitMananger.requestNode(beanID)
        }
    }
}

function createNode() {
    let node = GeaNode()
    
    node._sendGea2 = node.sendGea2
    node.sendGea2 = (...args) => {
        node._sendGea2(...args)
        node.sendGea3(...args)
    }

    return node
}

module.exports = {
    nodeResponse: function (node) {
        let beanID = node.uid()
        let key = hash(beanID)
        unitDict[key].node = node
        unitMananger.requestVersion(node)
    },

    versionResponse: function (beanID, version) {
        let key = hash(beanID)
        unitDict[key].version = version
    },

    updateResponse: function (beanID, result) {
        updating = false

        if (result)
            publish(message.SUCCESS, beanID)
        else
            publish(message.FAIL, beanID)

        if (q.length !== 0) {
            let key = q.pop()
            update(key)
        }
    }
}
