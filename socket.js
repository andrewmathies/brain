const apUpdate = require('../applcommon.sbc-pi-update/index')

const net = require('net')
const fs = require('fs')
const fastcsv = require('fast-csv')
const kue = require('kue')

const localCSVPath = '/home/andrew/git/brain/dict.csv'
const serverPort = 3000
const serverIP = '18.217.44.191'
// ec2 ip - '18.223.114.193'

let unitDict = []
let jobs = kue.createQueue()

class Unit {
	constructor(beanID, version) {
		this.beanID = beanID
		this.version = version
	}
}

// "Main" -------------------------------------------------------------
/*
// check for file on boot
let rs = fs.createReadStream(localCSVPath, { autoClose: true })
let csvStream = fastcsv()
	.on('data', (data) => {
		parseRecord(data, 'fs')
	})
	.on('end', () => {
		console.log('CSV - finished reading csv from disk')
	})

rs.pipe(csvStream)
*/

establishConnection()

jobs.process('updateJob', (job, done) => {
	console.log('QUEUE - ' + job.id + ' started')

	apUpdate.update(job.data.version, job.data.beanID)

	while (apUpdate.isLocked()) {
		// wait
		console.log('waiting')
	}

	done && done()
})

// Functions ----------------------------------------------------------

function addJob(version, beanID) {
	let job = jobs.create('updateJob', {
		version: version,
		beanID: beanID
	})

	job.on('complete', () => console.log('QUEUE - ' + job.id + ' finished'))
	job.on('failed', () => console.log('QUEUE - ' + job.id + ' failed'))

	job.save()
}

// open TCP socket and connect with server

function establishConnection() {
	let client = new net.Socket()

	client.connect(serverPort, serverIP, function() {
		console.log('TCP SOCKET - connected to server')
		client.write('yo')
	})

	client.on('data', function(data) {
		console.log('TCP SOCKET - recieved: ' + data)

		let req = isJson(data)
	
		if (Boolean(req)) {
			handlePost(req)
		} else {
			parseRecord(data, 'tcp')
		}
	})

	client.on('close', function() {
		console.log('TCP SOCKET - disconnected from server')
	})
}

function isJson(str) {
	try {
		return JSON.parse(str)
	} catch (e) {
		return false
	}
}

function parseRecord(csvRow, src) {
	// we have to do this split and the forEach loop because the server will sometimes send us multiple records in 
	// one string. I have no idea why this is happening as the server is supposed to send one a time
		
	let records = String(csvRow).split('_')

	records.forEach(record => {
		if (!record)
			return
		
		csvRow = '_' + record
		console.log('CSV - read ' + csvRow + ' from ' + src)

		let values = String(csvRow).split(',')
		let unit = new Unit(values[2], values[1])
		let key = values[0]

		if (src === 'fs') {
			unitDict[key] = unit
		} else if (src === 'tcp') {
			// if we already have a record of this and the version is out of date, then update that unit
			if (unitDict[key]) {
				if (unitDict[key].version !== unit.version) {
					console.log('UPDATE - updating unit ' + key + ' to ' + unit.version)
					addJob(unit.version, unit.beanID)
					//apUpdate.update(unit.version, unit.beanID)
				}
			}/* else {
				console.log('UPDATE - setting unit ' + key + ' to ' + unit.version)
				apUpdate.update(unit.version, unit.beanID)
			}*/

			unitDict[key] = unit
		} else {
			console.log('CSV - parsing, invalid source: ' + src)
		}
	})

	//if (src === 'tcp')
	//	saveChanges()	
}

function handlePost(req) {
	switch(req.header) {
		case 'addUnit':
			unit = new Unit(req.beanID, '')
			unitDict[req.id] = unit
			break
		case 'removeUnit':
			delete unitDict[req.id]
			break
		case 'updateVersion':
			if (req.version !== unitDict[req.id].version) {
				console.log('UPDATE - updating unit ' + req.id + ' to ' + req.version)
				addJob(req.version, unitDict[req.id].beanID)
				//apUpdate.update(req.version, unitDict[req.id].beanID)
			}
			break
		default:
			console.log('panic: dont know what to do with this request')
	}
	
	//saveChanges()
}
/*
function saveChanges() {
	let ws = fs.createWriteStream(localCSVPath, { autoClose: true })
	let fast_csv = fastcsv.createWriteStream()
	fast_csv.pipe(ws)

	for (key in unitDict) {
		if (unitDict[key].beanID) {
			fast_csv.write([ key, unitDict[key].version, unitDict[key].beanID ], { headers: false })
		}
	}

	console.log('CSV - wrote changes to disk')
	fast_csv.end()
}
*/
