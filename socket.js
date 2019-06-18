const apUpdate = require('../applcommon.sbc-pi-update/index')

const net = require('net')
const fs = require('fs')
const fastcsv = require('fast-csv')

const localCSVPath = '/home/andrew/git/brain/dict.csv'
const serverPort = 3000
const serverIP = '18.217.44.191'
// ec2 ip - '18.223.114.193'

let unitDict = []
let nodeDict = []
let q = []

let taskRunning = false

class Unit {
	constructor(beanID, version, node) {
		this.beanID = beanID
		this.version = version
		this.node = node
	}
}

// "Main" -------------------------------------------------------------

// get list of beans, then set up the TCP socket to go server
apUpdate.getGeaNodes((ret) => {
	for (let i = 0; i < ret.length; i++) {
		nodeDict[ret[i].uid()] = ret[i]
	}

	console.log('GEA - Connected to all of the beans we found')
	establishConnection()
})

// Functions ----------------------------------------------------------
// open TCP socket and connect with server

function establishConnection() {
	let client = new net.Socket()

	client.connect(serverPort, serverIP, function() {
		console.log('TCP SOCKET - Connected to server')
		client.write('yo')
		// TODO send list of versions we have downloaded to server
	})

	client.on('data', function(data) {
		console.log('TCP SOCKET - Recieved: ' + data)

		let req = isJson(data)
	
		if (Boolean(req)) {
			handlePost(req)
		} else {
			parseRecords(data)
		}
	})

	client.on('close', function() {
		console.log('TCP SOCKET - Disconnected from server')
	})
}


function parseRecords(csv) {
	let records = String(csv).split('_')

	records.forEach(record => {
		if (!record)
			return
		
		let csvRow = '_' + record
		let values = String(csvRow).split(',')

		let node = nodeDict[values[2]]
		let unit = new Unit(values[2], values[1], node)
		let key = values[0]

		unitDict[key] = unit
	})
}

function update(key) {
	let unit = unitDict[key]

	if (taskRunning) {
		console.log('QUEUE - Enqueueing task')
		q.push(key)
	} else {
		console.log('UPDATE - Updating unit ' + key + ' to ' + unit.version)
		apUpdate.update(unit)
		taskRunning = true
	}
}

function handlePost(req) {
	let key = req.id

	switch(req.header) {
		case 'addUnit':
			let unit = new Unit(req.beanID, '', undefined)
			unitDict[key] = unit
			break
		case 'removeUnit':
			delete unitDict[key]
			break
		case 'updateVersion':
			let requestedVersionString = req.version.split('.')[1]
			let curVersionString = unitDict[key].version.split('.')[1]

			if (requestedVersionString !== curVersionString) {
				unitDict[key].version = req.version
				update(key)
			} else {
				console.log('ERR - Requested update to unit ' + key + ' from ' + curVersionString + ' to ' + requestedVersionString)
			}

			break
		default:
			console.log('ERR - Dont know what to do with this request: ' + req.header)
	}
}

function isJson(str) {
	try {
		return JSON.parse(str)
	} catch (e) {
		return false
	}
}

module.exports.taskFinish = function () {
	taskRunning = false
	
	if (q.length == 0) {
		console.log('QUEUE - Queue is empty, waiting for next task')
	} else {
		console.log('QUEUE - Dequeueing task')
		let key = q.shift()
		update(key)
	}
}
