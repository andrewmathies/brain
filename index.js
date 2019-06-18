//const payload = '8bb4ede7c1ed9e8a1164ff7952a48d7c_0_0_4_6_advantium.tar.xz.enc';
const path = '/home/andrew/versions/';
const fileExt = '_walloven.tar.xz.enc';
let payloadPath = ''

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

const GeaNode = require('gea-communication').DualNode;
const ErdClient = require('erd-core').Client;
const wifi = require('node-wifi');
const equal = require('fast-deep-equal');
const _exec = require('child-process-promise').exec;
const Blinkt = require('node-blinkt');
const fs = require('fs')
const socket = require('../socket/socket.js')

wifi.init({ iface: interface });
const blinkt = new Blinkt();
blinkt.setup();
blinkt.clearAll();
blinkt.sendUpdate();

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));


function startUpdate(versionString, geaNode) {
	
	findHash(versionString)
	setExpectedVersion(versionString)

	const erdClient = ErdClient({ address: address.self, geaNode });

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

	const readWifi = async (erd) => {
  		return await dieTrying(async () => await erdClient.read({ host: address.wifi, erd }));
	};

	const readSbc = async (erd) => {
  		return await dieTrying(async () => {
    		try {
      			return await erdClient.read({ host: address.sbc1, erd });
    		}
    		catch(e) {
      			return await erdClient.read({ host: address.sbc2, erd });
    		}
  		});
	};

	const writeSbc = async (erd, data) => {
		return await dieTrying(async () => {
			try {
				await erdClient.write({ host: address.sbc1, erd, data })
			} catch(e) {
				await erdClient.write({ host: address.sbc2, erd, data })
			}
		})
	}

	const writeWifi = async (erd, data) => {
  		return await dieTrying(async () => await erdClient.write({ host: address.wifi, erd, data }));
	};

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

	const exec = async (...args) => {
  		return await dieTrying(async() => await _exec(...args));
	};

	const ascii = (a) => {
  		let result = '';
  		for(let c of a) {
    		if(c == 0) break;
    		result += String.fromCharCode(c);
  		}
  		return result;
	};

	const progress = (n) => {
  		if(n === 8) {
    		blinkt.setAllPixels(0, 255, 0, 1.0)
  		}
  		else {
    		for(let i = 0; i < n; i++) {
      			blinkt.setPixel(i, 0, 0, 255, 1.0);
    		}
  		}

  		blinkt.sendUpdate();
	};
	
	
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

  			progress(4);
  			console.log('AP - Uploading');

  			await exec('sh /home/andrew/git/applcommon.sbc-pi-update/upload.sh ' + payloadPath + ' ' + password);

  			progress(5);
  			console.log('AP - Waiting for the update to be applied');
  			while(!equal(await readWifi(erd.status), status.done)) {
    			await sleep(5000);
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

module.exports = {

	getGeaNodes: function(callback) {
		const geaNode = createNode()
	
		geaNode.list().then((nodeList) => {
			let objList = []
			let count = 0

			console.log('GEA - Found ' + nodeList.length + ' bean(s)')

			for (let i = 0; i < nodeList.length; i++) {
				const curNode = createNode()

				curNode.on('connect', function() { 
					console.log('GEA - Connected to: ' + curNode.uid())
					
					if (objList.includes(curNode))
						return
					
					count++
					objList.push(curNode)
					if (count == nodeList.length) {
						callback(objList)
					}
				});	
	
				console.log('GEA - Attempting to bind to: ' + nodeList[i])
				curNode.bind(nodeList[i]);
			}	
		})
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
				startUpdate(versionString, node)
			});	
		
			node.bind(beanID);
		}
	}
}
