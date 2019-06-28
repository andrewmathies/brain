const GeaNode = require('gea-communication').DualNode
const ErdClient = require('erd-core').Client
const wifi = require('node-wifi')
const equal = require('fast-deep-equal')
const _exec = require('child-process-promise').exec
const fs = require('fs')
const socket = require('../socket/index')

const iface = 'wlan0'

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

let payloadPath = ''

let version = {
  expected: ''
}

let clients = {}

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec))

const connect = async ({ ssid, password }) => {
    try {
      	await wifi.disconnect()
   	}     
    catch(err) {
        console.error('ERR - couldnt disconnect from wifi')
    }

    return await wifi.connect({ ssid, password })
}

const readErd = async (beanID, host, erd) => {
    const erdClient = clients[beanID]

    return await dieTrying(async () => {
        try {
            return await erdClient.read({ host, erd })
        } catch(err) {
            console.log('ERD Read failed. bean: ' + beanID + ', address: ' + host.toString(16) + ', erd: ' + erd.toString(16))
        }
    })
}

const writeErd = async (beanID, host, erd, data) => {
    const erdClient = clients[beanID]

    return await dieTrying(async () => {
        try {
            await erdClient.write({ host, erd, data })
        } catch(err) {
            console.log('ERD Write failed. bean: ' + beanID + ', address: ' + host.toString(16) + ', erd: ' + erd.toString(16))
        }
    })
}

const dieTrying = async (f) => {
  	while(true) {
    	try {
      		const result = await f()
      		return result
   		}
    	catch(e) {
      		await sleep(3000)
      		console.log(e)
    	}
  	}
}

const exec = async (...args) => {
    return await dieTrying(async() => {
        try {
            await _exec(...args)
        } catch(err) {
            console.error('ERR - exec failed')
            console.error(err)
        }
    })
}

const ascii = (a) => {
    let result = ''
  	for (let c of a) {
    	if(c == 0) break
    	result += String.fromCharCode(c)
  	}
  	return result
}

const getPath = (version) => {
    const path = '/home/pi/versions/'
    const fileExt = '_walloven.tar.xz.enc'
    
    version = version.replace('.', '_')

    fs.readdir(path, (err, files) => {
		if (err) {
			console.error('ERR - Unable to scan directory at: ' + path)
			console.error(err)
			return
		}

		for (let i = 0; i < files.length; i++) {
			if (files[i].includes(version)) {
                payloadPath = path + files[i]
                console.log('PATH - ' + payloadPath)
                return
			}
		}
	})
}

const setExpectedVersion = (versionString) => {
	let parts = versionString.split('.')

    try {
        let major = parseInt(parts[0], 10)
        let minor = parseInt(parts[1], 10)
        version.expected = [0, 0, major, minor]
    } catch (err) {
        console.error('couldnt parse ints when setting expected version')
        console.error(err)
    }
}

const validateSSID = (ssid) => {
    let parts = ssid.split('_')
    console.log('checking if ' + parts[2] + ' is alphanumeric')
    let result = /^[a-zA-Z0-9]+$/.test(parts[2])
    console.log('returning ' + result)
    return result
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

const createClient = async (beanID) => {
    let node = createNode()
	let connected = false
    const MAX_TRIES = 3

	node.on('connect', () => {
        if (node.uid() !== beanID) {
            console.error('wrong bean listener')
            return
        }
		
        connected = true
        console.log('GEA - connected to: ' + beanID)

        const erdClient = ErdClient({ address: address.self, geaNode: node })
        clients[beanID] = erdClient
	    
        getVersion(beanID)
    })

	for (let curTry = 0; curTry < MAX_TRIES; curTry++) {
        node.bind(beanID)
		await sleep(5000)
		if (connected) {
			return
		}
	}

	console.error('GEA - failed to connect to: ' + beanID)
}

const getVersion = async (beanID) => {
    for (let curTry = 0; curTry < 25; curTry++) {
		let version = await readErd(beanID, address.sbc1, erd.version)
        await sleep(5000)
			
        if (typeof version !== 'undefined') {
            let versionString = version[2].toString() + '.' + version[3].toString()
            socket.versionResponse(beanID, versionString)
		    return
        }
    }

    console.error('ERR - cannot verify version')
    socket.versionResponse(beanID, '')
}

const startUpdate = async (beanID, versionString) => {
	wifi.init({ iface: iface })
	getPath(versionString)
	setExpectedVersion(versionString)

	let err = false

	// doing stuff
	try {
		console.log('AP - Network State to Off')
		let currentWifiState, currentSbcState
        let tries = 0

		do {
			await writeErd(beanID, address.wifi, erd.networkState, networkState.off)
			await writeErd(beanID, address.sbc1, erd.networkState, networkState.off)

			currentWifiState = await readErd(beanID, address.wifi, erd.networkState)
			currentSbcState = await readErd(beanID, address.sbc1, erd.networkState)

            if (++tries > 5) {
    			console.error('ERR - Update failed, cannot change network state to off')
				socket.updateResponse(beanID, false)
				return
            }
		} while (!equal(currentWifiState, networkState.off) && !equal(currentSbcState, networkState.off))

		console.log('AP - Enabling AP mode')
		let currentMode
		
		do {
			await writeErd(beanID, address.wifi, erd.networkMode, networkMode.ap)
			currentMode = await readErd(beanID, address.wifi, erd.networkMode)
		} while(!equal(currentMode, networkMode.ap))

		console.log('AP - Reading SSID and password')

		const ssid = ascii(await readErd(beanID, address.wifi, erd.ssid))
		const password = ascii(await readErd(beanID, address.wifi, erd.password))

		console.log('AP - SSID: ' + ssid + ' Password: ' + password)

        if (!validateSSID(ssid)) {
            console.error('ERR - this unit doesnt have a good UPD')
            socket.updateResponse(beanID, false)
            return
        }

		console.log('AP - Connecting to AP')
		
        tries = 0
        while (tries < 20) {
            try {
                await connect({ ssid, password })
                break
            } catch(err) {
                console.error('ERR - failed to connect to wifi, retrying')
                await sleep(1000)
            }
        }

		console.log('AP - Uploading')

		await exec('sh /home/pi/git/applcommon.sbc-pi-update/upload.sh ' + payloadPath + ' ' + password)

        // wait 10 minutes for update to be applied
        tries = 0
		console.log('AP - Waiting for the update to be applied')
		while(!equal(await readErd(beanID, address.wifi, erd.status), status.done)) {
			await sleep(10000)

            if (++tries > 60) {
                console.error('ERR - timed out waiting for the update to be applied')
                socket.updateResponse(beanID, false)
                return
            }
		}

		console.log('AP - Verifying version')
		tries = 0
        let versionRead = ''

		while(!equal(versionRead, version.expected)) {
			versionRead = await readErd(beanID, address.sbc1, erd.version)
            await sleep(5000)
            console.log('read a version of: ' + versionRead)
			if(++tries > 25) {
				console.error('ERR - Update failed, cannot verify version')
				socket.updateResponse(beanID, false)
				return
			}
		}

		console.log('AP - Turning AP mode off')
		await writeErd(beanID, address.wifi, erd.networkMode, networkMode.off)
		
		socket.updateResponse(beanID, true)
	} catch(err) {
		console.error('ERR - ' + err)
		socket.updateResponse(beanID, false)
	}
}

module.exports = {
	requestUpdate: (beanID, version) => {
		startUpdate(beanID, version)
	},

	requestVersion: async (beanID) => {
        createClient(beanID)
    }
}
