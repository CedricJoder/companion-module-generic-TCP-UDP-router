module.exports = function (self) {

	const DeviceChoices = []

	for (let i = 0; i < self.config.connectionNumber; i++) {
		DeviceChoices.push({
			id: i,
			label: 'Connection ' + i + ' : ' + self.config['connection' + i + 'name']
        })
    }

	self.setActionDefinitions({
		simpleSend: {
			name: 'Send message to device',
			options: [
				{
					id: 'msg',
					type: 'textinput',
					label: 'Command to send',
					default: '',
					width: 6
				},
				{
					id: 'device',
					label: 'Destination device',
					type: 'dropdown',
					choices: DeviceChoices,
					width: 6,
					default: 0,
				}
			],
			callback: async (action) => {
				self.connections[action.options.device].write(action.options.msg)
			},
		},


		multipleSend: {
				name: 'Send message to multiple devices',
				options: [
					{
						id: 'msg',
						type: 'textinput',
						label: 'Message to send',
						default: '',
						width: 6
					},
					{
						id: 'devices',
						label: 'Destination devices',
						type: 'textinput',
						width: 6,
						default: '',
					}
				],
				callback: async (action) => {

					let routing = action.options.devices.split(',')

					routing.forEach((device) => {
						if (self.connections[device]) { 
							self.connections[device].write(action.options.msg)
						}
					})
				},
			},

		simulIncoming: {
				name: 'Simul incoming message',
				options: [
					{
						id: 'msg',
						type: 'textinput',
						label: 'Message received',
						default: '',
						width: 6
					},
					{
						id: 'device',
						label: 'Source device',
						type: 'dropdown',
						choices: DeviceChoices,
						width: 6,
						default: 0,
					}
				],
				callback: async (action) => {
					self.route(action.options.msg, action.options.device)
				},
			}
	})
}
