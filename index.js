const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const { UpdateVariableDefinitions, UpdateVariables } = require('./variables')
const net = require("net")
const dgram = require ("dgram")


/**
 * Returns the passed string expanded to 2-digit hex for each character
 * @param {string} data: string to hexify
 * @param {string} delim: string to insert between characters
 */
const toHex = (data, delim = '') => {
	data = data.toString()
	return [...data]
		.map((hex) => {
			return ('0' + Number(hex.charCodeAt(0)).toString(16)).slice(-2)
		})
		.join(delim)
}



class TcpServerInstance extends net.Server {
	constructor(ModuleInstance, index) {
		super()
		let self = this.module = ModuleInstance
		let port = self.config['connection' + index + 'port']
		this.index = index
		this.clients = []
		this.IP = []
		this.Port = []
		this.isListening = false

		this.on('connection', (socket) => {
			let cid = socket.remoteAddress + ':' + socket.remotePort
			this.clients.push(socket)
			self.log('info', 'Connection #' + index + ' (' + self.config['connection' + index + 'name'] + ') : incoming connection from ' + cid)
			socket.setKeepAlive(true, 10000)

			this.IP.push(socket.remoteAddress)
			this.Port.push(socket.remotePort)
			self.updateVariables(index)
			
			socket.on('err', (err) => {
				this.emit('err', err)
				this.isListening = this.clients.length > 0
				this.IP.splice(this.clients.indexOf(socket.remoteAddress), 1)
				this.Port.splice(this.clients.indexOf(socket.remotePort), 1)
				self.updateVariables(index)
				self.log('error', 'Error in connection #' + index + ' (' + self.config['connection' + index + 'name'] + ') : ' + cid + ' : ' + err)
			})

			socket.on('close', () => {
				this.clients.splice(this.clients.indexOf(socket), 1)
				this.isListening = this.clients.length > 0
				this.IP.splice(this.clients.indexOf(socket.remoteAddress), 1)
				this.Port.splice(this.clients.indexOf(socket.remotePort),1)
				self.updateVariables(index)
			})
			
			socket.on('data', (data) => {
				this.emit('data', data)

				if (self.config['connection' + index + 'hex']) {
					data = toHex(data)
				}
				self.log('debug', 'Connection #' + index + ' (' + self.config['connection' + index + 'name'] + ' : Received from ' + cid + ' : ' + data)
			})
		})

		if (port) {
			this.listen(port)
		}
	}

	destroy() {
		this.clients.forEach((socket) => {
			socket.end()
			socket.destroy()
        })
    }


	write(data) {
		let printData = this.module.config['connection' + this.index + 'hex'] ? toHex(data) : data
		this.clients.forEach((client) => {
			client.write(data)
			this.module.log('debug', 'writing data to ' + client.remoteAddress + ':' + client.remotePort + ' : ' + printData)
		})
	}


}


class IpMessageDispatcherInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.connections = []
		this.routing = []
	}


	populateDefaultConfig(start) {
		for (let i = start ?? 0; i < this.config.connectionNumber; i++) {
			this.config['connection' + i + 'protocol'] ??= 'tcp'
			this.config['connection' + i + 'ip'] ??= ''
			this.config['connection' + i + 'port'] ??= ''
			this.config['connection' + i + 'routing'] ??= 'all'
		}
    }



	/**
	 * Initialize the module.
	 * Called once when the system is ready for the module to start.
	 *
	 * @param {Object} config - module configuration details
	 * @version
	 * @since 1.0.0
	 */
	async init(config) {

		this.updateStatus(InstanceStatus.Ok)

		this.config = config

		// populate default config
		this.populateDefaultConfig()

		this.parseRoutingArray(config)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions

		this.init_connection()
	}


	// When module gets deleted
	async destroy() {
	
		for (let i = 0; i < this.connections.length; i++) {
			this.connections[i].end()
			this.connections[i].destroy()
		}
		this.connections = []
		this.log('debug', 'destroy')
	}


	parseRoutingArray(config) {
		let conNum = config.connectionNumber

		// Parsing routing array
		for (let i = 0; i < conNum; i++) {

			let routingArray = new Set(config['connection' + i + 'routing']?.split(','))

			if (routingArray.has('all')) {
				for (let j = 0; j < conNum; j++) {
					if (j != i) {
						routingArray.add(j)
					}
				}
				routingArray.delete('all')
			}
			if (routingArray.has('echo')) {
				routingArray.add(i)
				routingArray.delete('echo')
			}

			this.routing[i] = routingArray
		}

    }



	async configUpdated(config) {

		let conNum = config.connectionNumber
		let reconnectionArray = []
		// Parsing routing array
		this.parseRoutingArray(config)

		// populate default config if connections number change
		if (config.connectionNumber > this.config.connectionNumber) {
			this.populateDefaultConfig(this.config.connectionNumber)
        }
		

		// reconnecting 
		for (let i = 0; i < conNum; i++)
			if ((this.config['connection' + i + 'ip'] != config['connection' + i + 'ip']) ||
				(this.config['connection' + i + 'port'] != config['connection' + i + 'port']) ||
				(this.config['connection' + i + 'protocol'] != config['connection' + i + 'protocol']) ||
				(this.connections[i] == undefined) ||
				(!this.connections[i].isConnected && !this.connections[i].isListening)) {
				reconnectionArray.push(i)
			}

		this.config = config

		reconnectionArray.forEach((i) => {
			this.init_connection(i)
        })
	}



	route(data, sourceId) {

		if ((sourceId >= this.connections.length) || (this.routing[sourceId] == undefined)) {
			this.log('error', 'Invalid source id')
			returni
		}

		this.routing[sourceId].forEach((dest) => {
			if (RegExp(this.config['connection' + dest + 'filter']).test(String(data))) {
				this.connections[dest].write(data)
			}
        })
    }




	init_connection(id) {
		const self = this

		this.updateStatus(InstanceStatus.Connecting)

		for (let i = (id ?? 0); i <= (id ?? this.config.connectionNumber - 1); i++) {
			if (this.connections[i]) {
				this.connections[i].destroy()
			}

			let port = this.config['connection' + i + 'port']
			let ip = self.config['connection' + i + 'ip']

			if (port) {
				switch (self.config['connection' + i + 'protocol']) {
					case 'udp':
						// UDP connection
						let udp = this.connections[i] = dgram.createSocket('udp4')

						udp.write = () => {}
						udp.isConnected = false
						udp.isListening = false

						udp.on('connect', () => {
							self.log('info', 'Connection #' + i + ' (' + this.config['connection' + i + 'name'] + ') : connected to ' + udp.remoteAddress().address + ':' + udp.remoteAddress().port + '(UDP)')
							udp.write = (data) => {
								udp.send(data)
							}
							udp.isConnected = true

							udp.IP = udp.remoteAddress().address
							udp.Port = udp.remoteAddress().port
							self.updateVariables(i)
						})

						udp.on('err', (err) => {
							self.log('error', 'Error in connection ' + i + ' (' + this.config['connection' + i + 'name'] + ') : ' + err)
						})
						
						udp.on('message', (data, rinfo) => {
							let printData = self.config['connection' + i + 'hex'] ? toHex(data) : data
							
							if (!ip) {
								this.IP.push(rinfo.address)
								this.Port.push(rinfo.port)
                            }
							self.log('debug', 'Received message from connection #' + i + ' (' + this.config['connection' + i + 'name'] + ') : ' + rinfo.address + ':' + rinfo.port + ' : ' + printData)
							self.route(data, i)
						})

						udp.on('close', () => {
							self.log('info', 'Connection #' + i + ' (' + this.config['connection' + i + 'name'] + ') : closed')
							delete udp.IP
							delete udp.Port
							})

						
						
						if (ip) {
							// Client mode
							udp.connect(port, ip)
						} else {
							// Server mode
							udp.bind(port)
							udp.isListening = true
							udp.IP = []
							udp.Port = []
						}

						break

					case 'tcp':
						// TCP connection
						if (ip) {
							// Client mode 
							let socket = this.connections[i] = new net.Socket()
							socket.isConnected = false

							socket.on('error', (err) => {
								self.log('error', 'Error in connection ' + i + ' (' + self.config['connection' + i + 'name'] + ') : ' + err)
								socket.isConnected = false

								socket.IP = socket.remoteAddress
								socket.Port = socket.remotePort
								self.updateVariables(i)
							})

							socket.on('connect', () => {
							//	this.updateStatus(InstanceStatus.Ok)
								self.log('info', 'Connection #' + i + ' (' + self.config['connection' + i + 'name'] + ') : connected to ' + socket.remoteAddress + ':' + socket.remotePort + '(TCP)')
								socket.isConnected = true

								socket.IP = socket.remoteAddress
								socket.Port = socket.remotePort
								self.updateVariables(i)
							})

							socket.on('data', (data) => {
								let printData = self.config['connection' + i + 'hex'] ? toHex(data) : data
								self.log('debug', 'Received message from connection #' + i + ' (' + self.config['connection' + i + 'name'] + ') : ' + printData)
								self.route(data, i)
								
							})

							socket.on('close', () => {
								socket.isConnected = false
								delete socket.IP
								delete socket.Port
								setTimeout(() => {
									socket.connect(port,ip)
                                }, 5000)
                            })
							
							socket.connect(port, ip)

						} else {
							// Server mode
							let server = this.connections[i] = new TcpServerInstance(this, i)

							server.on('data', (data) => {
								let printData = self.config['connection' + i + 'hex'] ? toHex(data) : data
								this.log('debug', 'Received from  connection #' + i + ' (' + self.config['connection' + i + 'name'] + ') :' + printData)
								self.route(data, i)
							})
						}

						break
                }
            }
		}
		this.updateVariables()
    }




	// Return config fields for web config
	getConfigFields() {
		let configFields = [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This is a helper module to share IP commands between multiple connections'
			},
			{
				type: 'number',
				id: 'connectionNumber',
				label: 'Number of connections',
				width: 4,
				min: 1,
				max: 16,
				default: 2,
			},
			{
				type: 'static-text',
				label: '',
				width: 12,
			}]

		for (let i = 0; i < (this.config?.connectionNumber ? this.config.connectionNumber : 0); i++) {
			configFields.push(
				{
					type: 'static-text',
					id: 'Connection ' + i,
					width: 12,
					label: 'Connection ' + i + ' Information',
					//value: '',
				},
				{
					type: 'textinput',
					id: 'connection' + i + 'name',
					width: 12,
					label: 'Connection ' + i + ' Name',
					default: '',
                },
				{
					type: 'dropdown',
					id: 'connection' + i + 'protocol',
					label: 'Protocol',
					width: 3,
					choices: [{
							id: 'tcp',
							label: 'TCP',
						},
						{
							id: 'udp',
							label: 'UDP'
						}],
					default: 'tcp',
				},
				{
					type: 'textinput',
					id: 'connection' + i + 'ip',
					label: 'Target IP',
					width: 4,
					regex: Regex.IP,
					required: false,
					default: ''
				},
				{
					type: 'textinput',
					id: 'connection' + i + 'port',
					label: 'Target Port',
					width: 3,
					regex: Regex.PORT,
					default: ''
				},
				{
					type: 'checkbox',
					id: 'connection' + i + 'hex',
					label: 'Hex mode',
					width: 2,
					default: false,
                },
				{
					type: 'textinput',
					id: 'connection' + i + 'routing',
					label: 'Routing Array',
					regex: '/^(([0-7]|all|echo)(,([0-7]|all|echo)){0,' + (this.config.connectionNumber - 1) + '})?$/',
					default: '',
					width: 4
				},
				{
					type: 'textinput',
					id: 'connection' + i + 'filter',
					label: 'Regular expression filter',
					default: '',
					width: 8,
				},
				{
					type: 'static-text',
					id: 'Spacing ' + i,
					width: 12,
					label: '',
					//value: '',
				},
			)
		}

		return configFields
	}

	updateActions() {
		UpdateActions(this)
	}

	updateFeedbacks() {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions() {
		UpdateVariableDefinitions(this)
	}

	updateVariables(i) {
		UpdateVariables(this, i)
    }
}

runEntrypoint(IpMessageDispatcherInstance, UpgradeScripts)
