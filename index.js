const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const UpdateActions = require('./actions')
const UpdateFeedbacks = require('./feedbacks')
const UpdateVariableDefinitions = require('./variables')
const net = require("net")
const dgram = require ("dgram")


class TcpServerInstance extends net.Server {
	constructor(ModuleInstance, index) {
		super()
		let self = this.module = ModuleInstance
		let port = self.config['connection' + index + 'port']
		this.clients = []
		this.isListening = false

		this.on('connection', (socket) => {
			let cid = socket.remoteAddress + ':' + socket.remotePort
			this.clients.push(socket)
			self.log('info', 'Connection #' + index + ' (' + self.config['connection' + index + 'name'] + ') : incoming connection from ' + cid)
			socket.setKeepAlive(true, 10000)
			
			socket.on('err', (err) => {
				this.emit('err', err)
				self.log('error', 'Error in connection ' + cid + ' : ' + err)
			})

			socket.on('close', () => {
				this.clients.splice(this.clients.indexOf(socket), 1)
				this.isListening = this.clients.length > 0
			})
			
			socket.on('data', (data) => {
				self.log('debug', 'Received from ' + cid + ' : ' + data)
				this.emit('data', data)
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
		for (let key in this.clients) {
			this.clients[key].write(data)
			this.module.log('debug', 'writing data to ' + this.clients[key].remoteAddress + ':' + this.clients[key].remotePort + ' : ' + data)
		}
	}


}


class TcpUdpRouterInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.connections = []
		this.routing = []
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

		this.configUpdated(config)

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions

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


	async configUpdated(config) {
		this.config = config

		let conNum = this.config.connectionNumber

		// Parsing routing array
		for (let i = 0; i < conNum; i++) {

			let routingArray = new Set(config['connection' + i + 'routing'].split(','))

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


		this.init_connection()

	}



	route(data, sourceId) {

		if ((sourceId >= this.connections.length) || (this.routing[sourceId] == undefined)) {
			this.log('error', 'Invalid source id')
			return
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

						udp.on('connect', () => {
							self.log('info', 'Connection #' + i + ' (' + this.config['connection' + i + 'name'] + ') : connected to ' + udp.remoteAddress + ':' + udp.remotePort + '(UDP)')
							udp.write = (data) => {
								udp.send(data)
							}
						})

						udp.on('err', (err) => {
							self.log('error', 'Error in connection ' + i + ' (' + this.config['connection' + i + 'name'] + ') : ' + err)
						})

						udp.on('message', (data) => {
							self.log('debug', 'Received message from connection #' + i + ' (' + this.config['connection' + i + 'name'] + ') : ' + data)

							self.route(data, i)

						})

						udp.on('close', () => {
								self.log('info', 'Connection #' + i + ' (' + this.config['connection' + i + 'name'] + ') : closed')
							})


						if (ip) {
							// Client mode
							udp.connect(port, ip)
						} else {
							// Server mode
							udp.bind(port)
						}

						break

					case 'tcp':
						// TCP connection
						if (ip) {
							// Client mode 
							this.log('indo', 'Connection #' + i + ' : client mode')
							let socket = this.connections[i] = new net.Socket()


							socket.on('error', (err) => {
								self.log('error', 'Error in connection ' + i + ' (' + self.config['connection' + i + 'name'] + ') : ' + err)
							})

							socket.on('connect', () => {
							//	this.updateStatus(InstanceStatus.Ok)
								self.log('info', 'Connection #' + i + ' (' + self.config['connection'+ i +'name'] + ') : connected to ' + socket.remoteAddress + ':' + socket.remotePort + '(TCP)')
							})

							socket.on('data', (data) => {
								self.log('debug', 'Received message from connection #' + i + ' (' + self.config['connection' + i + 'name'] + ') : ' + data)

								self.route(data, i)
							})

							socket.on('close', () => {
								setTimeout(() => {
									socket.connect(port,ip)
                                }, 5000)
                            })

							socket.connect(port, ip)

						} else {
							// Server mode
							this.log('debug', 'server mode')
							let server = this.connections[i] = new TcpServerInstance(this, i)

							server.on('data', (data) => {
								this.log('debug', 'Received from  connection #' + i + ' (' + self.config['connection' + i + 'name'] + ') :' + data)

								self.route(data, i)
							})
						}

						break
                }
            }
        }
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

		for (let i = 0; i < this.config.connectionNumber; i++) {
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
					default: 'tcp',
					choices: [{
							id: 'tcp',
							label: 'TCP',
						},
						{
							id: 'udp',
							label: 'UDP'
					}]
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
					width: 5,
					regex: Regex.PORT,
					default: ''
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
}

runEntrypoint(TcpUdpRouterInstance, UpgradeScripts)
