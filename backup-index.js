const GeaNode = require('gea-communication').DualNode;
const ErdClient = require('erd-core').Client;
const wifi = require('node-wifi');
const equal = require('fast-deep-equal');
const _exec = require('child-process-promise').exec;
const Blinkt = require('node-blinkt');
const fs = require('fs')
const socket = require('../socket/socket.js')
const SegfaultHandler = require('segfault-handler');

let payloadPath = ''
const path = '/home/pi/versions/';
const fileExt = '_walloven.tar.xz.enc';
const interface = 'wlan0';

const address = {
  self: 0xE4,
  sbc1: 0x80,
  sbc2: 0xC0,
  wifi: 0xBF
};

const erd = {
  networkMode: 0x602C,
  ssid: 0x6001,
  password: 0x6002,
  networkState: 0x6003,
  status: 0x0108,
  version: 0x0106
};

const networkMode = {
  off: [0],
  ap: [1]
};

const networkState = {
  off: [0],
  on: [1]
}

const status = {
  done: [0]
};

let version = {
  expected: ''
};

wifi.init({ iface: interface });
const blinkt = new Blinkt();
blinkt.setup();
blinkt.clearAll();
blinkt.sendUpdate();

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

// Wifi

const connect = async ({ ssid, password }) => {
  	return await dieTrying(async () => {
    	try {
      		await wifi.disconnect();
   		}     
    	catch(e) {
    	}
    	return await wifi.connect({ ssid, password });
  	});
};

// ERD

let erdClient

function setClient(node) {
    erdClient = ErdClient({ address: address.self, node })
}

function readErd(host, erd) {
    return await dieTrying(async () => {
        return await erdClient.read({ host, erd })
    }
}

function writeErd(host, erd, data) {
    return await dieTrying(async () => {
        await erdClient.write({ host, erd, data })
    }
}

// Utility

const dieTrying = async (f) => {
  	while(true) {
    	try {
      		const result = await f();
      		return result;
   		}
    	catch(e) {
      		await sleep(10000);
      		console.log(e);
    	}
  	};
};

const exec = async (...args) => {
    return await dieTrying(async() => await _exec(...args));
};

const ascii = (a) => {
    let result = '';
  	for (let c of a) {
    	if(c == 0) break;
    	result += String.fromCharCode(c);
  	}
  	return result;
};

const progress = (n) => {
    if (n === 8) {
    	blinkt.setAllPixels(0, 255, 0, 1.0)
  	} else {
    	for(let i = 0; i < n; i++) {
     		blinkt.setPixel(i, 0, 0, 255, 1.0);
    	}
  	}
  	blinkt.sendUpdate();
};



function startUpdate(versionString, geaNode) {
	
	findHash(versionString)
	setExpectedVersion(versionString)
	
	(async () => {
			progress(1);
 		
			console.log('AP - Network State to Off')

			let currentWifiState, currentSbcState

			do {
				await writeWifi(erd.networkState, networkState.off)
				await writeSbc(erd.networkState, networkState.off)

				currentWifiState = await readWifi(erd.networkState)
				currentSbcState = await readSbc(erd.networkState)

		//		console.log('wifi state: ' + currentWifiState + '\nsbc state: ' + currentSbcState)
			} while (!equal(currentWifiState, networkState.off) && !equal(currentSbcState, networkState.off))
		
			console.log('AP - Enabling AP mode');
  		 	let currentMode;
  		 	do {
    			await writeWifi(erd.networkMode, networkMode.ap);
    			currentMode = await readWifi(erd.networkMode);
  			} while(!equal(currentMode, networkMode.ap));

  			progress(2);
  			console.log('AP - Reading SSID and password');
  			const ssid = ascii(await readWifi(erd.ssid));
  			const password = ascii(await readWifi(erd.password));

  			console.log('AP - SSID: ' + ssid + ' Password: ' + password);

  			progress(3);
  			console.log('AP - Connecting to AP');
  			await connect({ ssid, password });

            logMemory()

            progress(4);
  			console.log('AP - Uploading');

  			await exec('sh /home/pi/git/applcommon.sbc-pi-update/upload.sh ' + payloadPath + ' ' + password);

            logMemory()

  			progress(5);
  			console.log('AP - Waiting for the update to be applied');
  			while(!equal(await readWifi(erd.status), status.done)) {
    			await sleep(5000);
                logMemory()
  			}

  			progress(6);
  			console.log('AP - Verifying version');
  			let tries = 0;
  			let err = false	

			while(!equal(await readSbc(erd.version), version.expected)) {
    			await sleep(5000);
    			if(++tries > 25) {
      				console.log('ERR - Update failed, cannot verify version')
					err = true
					break
					//throw new Error('Timed out while verifying version');
    			}
  			}

  			progress(7);
  			console.log('AP - Turning AP mode off');
  			await writeWifi(erd.networkMode, networkMode.off);
            
            logMemory()
  			progress(8);

			if (!err)
  				console.log('AP - Update applied successfully');
			
			socket.taskFinish()
	})();
}



function findHash(version) {
	fs.readdir(path, (err, files) => {
		if (err) {
			console.log('ERR - Unable to scan directory at: ' + path)
			console.log(err)
			return
		}

		for (let i = 0; i < files.length; i++) {
			if (files[i].includes(version)) {
				setPath(files[i])
			}
		}
	})
}

function setExpectedVersion(versionString) {
	let parts = versionString.split('_')
	//console.log('parts are: ' + parts[0] + ' ' + parts[1])
	version.expected = [0, 0, parseInt(parts[0], 10), parseInt(parts[1], 10)]
}

function setPath(filename) {
	payloadPath = path + filename
	console.log('FILE - Path to version file is: ' + payloadPath)
}

function createNode() {
	let geaNode = GeaNode();
	geaNode._sendGea2 = geaNode.sendGea2;
	geaNode.sendGea2 = (...args) => {
 		geaNode._sendGea2(...args);
 		geaNode.sendGea3(...args);
	};

	return geaNode
}

function logMemory() {
    let mem = process.memoryUsage()
    let rss = mem.rss / 1024 / 1024
    let hTotal = mem.heapTotal / 1024 / 1024
    let hUsed = mem.heapUsed / 1024 / 1024
    let external = mem.external / 1024 / 1024

    console.log('Resident Set Size: ~' + Math.round(rss * 100) / 100 + ' MB')
    console.log('Heap Total: ~' + Math.round(hTotal * 100) / 100 + ' MB')
    console.log('Heap Used: ~' + Math.round(hUsed * 100) / 100 + ' MB')
    console.log('External: ~' + Math.round(external * 100) / 100 + ' MB')
}

process.on('unhandledRejection', error => {
    // Will print "unhandledRejection err is not defined"
    console.log('unhandledRejection ', error.message);
});


let done = []

module.exports = {

	getGeaNodes: async function(callback) {
		const geaNode = createNode()
	    const MAX_TRIES = 3

        let nodeList = []
		let idList = await geaNode.list()

        if (idList.length < 1) {
            console.log('didnt find any beans =(')
            return
        }

		console.log('GEA - Found ' + idList.length + ' bean(s)')

        for (let j = 0; j < idList.length; j++) {
            let id = idList[j]
            done[id] = false
            const curNode = createNode()

            curNode.on('connect', () => {
                console.log('GEA - connected to: ' + curNode.uid())
                done[curNode.uid()] = true
                nodeList.push(curNode)
            })

            for (let curTry = 0; curTry < MAX_TRIES; curTry++) {
                curNode.bind(id)
                await sleep(5000)
                if (done[id]) {
                    break
                } else if (curTry == 2) {
                    console.log('failed to connect to: ' + id)
                }
            }
        }

        callback(nodeList)
	},

	update: function(unit) {
		let beanID = unit.beanID
		let versionString = unit.version.replace('.', '_')

		if (unit.node) {
			startUpdate(versionString, unit.node)
		} else {
			const node = createNode()

			node.on('connect', function() { 
				console.log('GEA - Connected to: ' + node.uid())
				try {
                    startUpdate(versionString, node)
                } catch(e) {
                    console.log(e)
                }
			});	
		
			node.bind(beanID);
		}
	},
/*
    readVersion: async function(node) {
   	    const erdClient = ErdClient({ address: address.self, node });
        
        async function readSbc(erd) {
  		    return await dieTrying(async () => {
    		    try {
      			    return await erdClient.read({ host: address.sbc1, erd });
    		    } catch(e)
  		    });
        }

		for (let curTry = 0; curTry < 10; curTry++) {
            console.log('try: ' + curTry)
            try {
                return await readSbc(erd.version)
            } catch(e) {
                await sleep(5000)
            }
  		}

        console.log('ERR - cannot verify version')
    }*/
}
