const GeaNode = require('gea-communication').DualNode
const ErdClient = require('erd-core').Client
const wifi = require('node-wifi')
const equal = require('fast-deep-equal')
const _exec = require('child-process-promise').exec
const Blinkt = require('node-blinkt')
const fs = require('fs')
const socket = require('../socket/socket.js')

const path = '/home/pi/versions/'
const fileExt = '_walloven.tar.xz.enc'
const interface = 'wlan0'

const address = {
  self: 0xE4,
  sbc1: 0x80,
  sbc2: 0xC0,
  wifi: 0xBF
}

const erd = {
  networkMode: 0x602C,
  ssid: 0x6001,
  password: 0x6002,
  networkState: 0x6003,
  status: 0x0108,
  version: 0x0106
}

const networkMode = {
  off: [0],
  ap: [1]
}

const networkState = {
  off: [0],
  on: [1]
}

const status = {
  done: [0]
}

let version = {
  expected: ''
}

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec))

const connect = async ({ ssid, password }) => {
  	return await dieTrying(async () => {
    	try {
      		await wifi.disconnect()
   		}     
    	catch(e) {
    	}
    	return await wifi.connect({ ssid, password })
  	})
}

const readErd = (erdClient, host, erd) => {
    return await dieTrying(async () => {
        return await erdClient.read({ host, erd })
    })
}

const writeErd = (erdClient, host, erd, data) => {
    return await dieTrying(async () => {
        await erdClient.write({ host, erd, data })
    })
}

const dieTrying = async (f) => {
  	while(true) {
    	try {
      		const result = await f()
      		return result
   		}
    	catch(e) {
      		await sleep(10000)
      		console.log(e)
    	}
  	}
}

const exec = async (...args) => {
    return await dieTrying(async() => await _exec(...args))
}

const ascii = (a) => {
    let result = ''
  	for (let c of a) {
    	if(c == 0) break
    	result += String.fromCharCode(c)
  	}
  	return result
}

const progress = (n) => {
    if (n === 8) {
    	blinkt.setAllPixels(0, 255, 0, 1.0)
  	} else {
    	for(let i = 0; i < n; i++) {
     		blinkt.setPixel(i, 0, 0, 255, 1.0)
    	}
  	}
  	blinkt.sendUpdate()
}

const getPath = (version) => {
	fs.readdir(path, (err, files) => {
		if (err) {
			console.log('ERR - Unable to scan directory at: ' + path)
			console.log(err)
			return
		}

		for (let i = 0; i < files.length; i++) {
			if (files[i].includes(version)) {
				return path + files[i]
			}
		}
	})
}

const setExpectedVersion = (versionString) => {
	let parts = versionString.split('_')
	version.expected = [0, 0, parseInt(parts[0], 10), parseInt(parts[1], 10)]
}

const createNode = () => {
	let geaNode = GeaNode()
	geaNode._sendGea2 = geaNode.sendGea2
	geaNode.sendGea2 = (...args) => {
 		geaNode._sendGea2(...args)
 		geaNode.sendGea3(...args)
	}

	return geaNode
}

const startUpdate = async (versionString, geaNode) => {
	// initialization
	wifi.init({ iface: interface })
	const blinkt = new Blinkt()
	blinkt.setup()
	blinkt.clearAll()
	blinkt.sendUpdate()
	
	let payloadPath = getPath(versionString)
	setExpectedVersion(versionString)

	let err = false
	let beanID = geaNode.uid()
	const erdClient = ErdClient({ address: address.self, geaNode })

	// doing stuff
	try {
		progress(1)
		console.log('AP - Network State to Off')
		let currentWifiState, currentSbcState

		do {
			await writeErd(erdClient, address.wifi, erd.networkState, networkState.off)
			await writeErd(erdClient, address.sbc1, erd.networkState, networkState.off)

			currentWifiState = await readErd(erdClient, address.wifi, erd.networkState)
			currentSbcState = await readErd(erdClient, address.sbc1, erd.networkState)
		} while (!equal(currentWifiState, networkState.off) && !equal(currentSbcState, networkState.off))

		console.log('AP - Enabling AP mode')
		let currentMode
		
		do {
			await writeErd(erdClient, address.wifi, erd.networkMode, networkMode.ap)
			currentMode = await readErd(erdClient, address.wifi, erd.networkMode)
		} while(!equal(currentMode, networkMode.ap))

		progress(2)
		console.log('AP - Reading SSID and password')
		const ssid = ascii(await readErd(erdClient, address.wifi, erd.ssid))
		const password = ascii(await readErd(erdClient, address.wifi, erd.password))

		console.log('AP - SSID: ' + ssid + ' Password: ' + password)

		progress(3)
		console.log('AP - Connecting to AP')
		await connect({ ssid, password })

		progress(4)
		console.log('AP - Uploading')

		await exec('sh /home/pi/git/applcommon.sbc-pi-update/upload.sh ' + payloadPath + ' ' + password)

		progress(5)
		console.log('AP - Waiting for the update to be applied')
		while(!equal(await readErd(erdClient, address.wifi, erd.status), status.done)) {
			await sleep(5000)
		}

		progress(6)
		console.log('AP - Verifying version')
		let tries = 0
		
		while(!equal(await readErd(erdClient, address.sbc1, erd.version), version.expected)) {
			await sleep(5000)
			if(++tries > 25) {
				console.log('ERR - Update failed, cannot verify version')
				socket.updateResponse(beanID, false)
				return
			}
		}

		progress(7)
		console.log('AP - Turning AP mode off')
		await writeErd(erdClient, address.wifi, erd.networkMode, networkMode.off)
		
		logMemory()
		progress(8)

		socket.updateResponse(beanID, true)
	} catch(err) {
		console.log('ERR - ' + err)
		socket.updateResponse(beanID, false)
	}
}

module.exports = {

	requestUpdate: (node, version) => {
		startUpdate(version, node)
	},

	requestNode: async (beanID) => {
		let node = createNode()
		let connected = false

		node.on('connect', () => {
			connected = true
			console.log('GEA - connected to: ' + node.uid())
			socket.nodeResponse(node)
		})

		for (let curTry = 0; curTry < MAX_TRIES; curTry++) {
			node.bind(beanID)
			await sleep(5000)
			if (connected) {
				return
			}
		}

		console.log('GEA - failed to connect to: ' + beanID)
	},

	requestVersion: async (node) => {
		const erdClient = ErdClient({ address: address.self, node })
		let beanID = node.uid()

		for (let curTry = 0; curTry < 10; curTry++) {
            console.log('try: ' + curTry)
            try {
				let version = await readErd(erdClient, address.sbc1, erd.version)
				socket.versionResponse(beanID, version)
				return
            } catch(e) {
                await sleep(5000)
            }
  		}

        console.log('ERR - cannot verify version')
	}
}
