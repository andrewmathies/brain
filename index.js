module.exports = {
    versionResponse: (beanID, version) => {
        dict[beanID] = version

        mqttClient.subscribe('unit/' + beanID + '/', (err) => {
            console.log('MQTT - subscribed to: ' + 'unit/' + beanID + '/')
            if (!err) {
                publish(message.HELLO, beanID)
            }
        })
    },

    updateResponse: (beanID, succeeded) => {
        updating = false

        if (succeeded)
            publish(message.SUCCESS, beanID)
        else
            publish(message.FAIL, beanID)

        if (q.length !== 0) {
            let key = q.pop()
            update(key)
        }
    }
}

const mqtt = require('mqtt')
const usb = require('usb')
const SegfaultHandler = require('segfault-handler')
const GeaNode = require('gea-communication').DualNode
const unitManager = require('../applcommon.sbc-pi-update/index')

let dict = []
let q = []

let updating = false

const mqttClient = mqtt.connect('tls://saturten.com:8883', {username: 'andrew', password: '1plus2is3'})
const masterNode = createNode()

const message = {
    HELLO: 0,
    SUCCESS: 1,
    FAIL: 2
}

// "Main" -------------------------------------------------------------

SegfaultHandler.registerHandler('crash.log')
checkForNodes()

// Event Listeners
usb.on('attach', async () => {
    console.log('detected new usb device')
    //await checkForNodes()
})
 
mqttClient.on('connect', () => {
    console.log('MQTT - connected to broker')
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
        dict[beanID] = msg.version
        update(beanID)
    }
})

// Functions ----------------------------------------------------------

function publish(type, beanID) {
    let msg

    switch (type) {
        case message.HELLO:
            let version = dict[beanID]
            msg = { header: 'Hello', version: version }
            break
        case message.SUCCESS:
            msg = { header: 'Success' }
            break
        case message.FAIL:
            msg = { header: 'Fail' }
            break
        default:
            console.log('ERR - mqtt publish request with unknown message type')
            return
    }

    mqttClient.publish('unit/' + beanID + '/', JSON.stringify(msg))
}

function update(beanID) {
	if (updating) {
        q.push(beanID)
	    return
    }

    updating = true

    let version = dict[beanID]
	console.log('Updating unit ' + beanID + ' to ' + version)
	unitManager.requestUpdate(beanID, version)
}

async function checkForNodes() {
    let beanIDs = []

    while (beanIDs.length == 0) {
        try {
            beanIDs = await masterNode.list()
            await sleep(500)
        } catch(err) {
            console.log('couldnt get list of nodes')
            console.log(err)
            return
        }
    }

    console.log('found ' + beanIDs.length + ' nodes')

    for (let i = 0; i < beanIDs.length; i++) {
        let beanID = beanIDs[i]
        if (!(beanID in dict)) {
            unitManager.requestVersion(beanID)
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

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec))
