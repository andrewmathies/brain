const unitManager = require('../applcommon.sbc-pi-update/index')
const mqtt = require('mqtt')
const usb = require('usb')
const GeaNode = require('gea-communication').DualNode
const SegFaultHandler = require('segfault-handler')

let unitDict = []
let q = []

let updating = false

const mqttClient = mqtt.connect('tls://saturten.com:8883', {username: 'andrew', password: '1plus2is3'})
const geaNode = createNode()

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

SegfaultHandler.registerHandler('crash.log')

getNodes()

initMqtt()

apUpdate.getGeaNodes((nodeList) => {
	for (let i = 0; i < nodeList.length; i++) {
        let beanID = nodeList[i].uid()
        //let version = await apUpdate.readVersion(nodeList[i])
        let unit = new Unit(beanID, '', nodeList[i])
		unitDict[beanID] = unit
	}

	console.log('GEA - Connected to all of the beans we found')
	establishConnection()
})

// Functions ----------------------------------------------------------
 
client.on('connect', () => {
    for (let [beanID, unit] of Object.entries(unitDict)) {
        client.subscribe('/unit/' + beanID + '/', (err) => {
        if (!err) {
            let helloMsg = {header: 'Hello', version: unit.version}
            client.publish('/unit/' + beanID + '/', JSON.stringify(helloMsg))
        }
            })
		}
	})

    client.on('message', (topic, message) => {
        console.log('topic: ' + topic)
        console.log('message: ' + message.toString())

        let topicParts = topic.split('/')
        if (topicParts.length !== 4) {
            console.log('unexpected topic')
            return
        }

        let msg = JSON.parse(message.toString())
        if (msg.header === 'StartUpdate') {
            let key = topicParts[2]
            unitDict[key].version = msg.version
            update(key)
        }
    })
}

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
    function nodeResponse(node) {
        let beanID = node.uid()
        let key = hash(beanID)
        unitDict[key].node = node
        unitMananger.requestVersion(node)
    }

    function versionResponse(beanID, version) {
        let key = hash(beanID)
        unitDict[key].version = version
    }

    function updateResponse(beanID, result) {
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
