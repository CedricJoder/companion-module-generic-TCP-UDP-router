exports.UpdateVariableDefinitions = function (self) {
	let variableDefinitions = []

	for (let i = 0; i < self.config.connectionNumber; i++) {
		variableDefinitions.push({
			variableId: 'connection_' + i + '_remote_ip',
			name: 'Remote IP address of connection ' + i,
		},
		{
			variableId: 'connection_' + i + '_protocol',
			name: 'Protocol for connection ' + i,
		},
		{
		variableId: 'connection_' + i + '_remote_port',
		name: 'Remote port of connection ' + i,
		},
		{
			variableId: 'connection_' + i + '_name',
			name: 'Name of connection ' + i,
		})
	}

	self.setVariableDefinitions(variableDefinitions)
}


exports.UpdateVariables = function (self, index) {
	let variableValues = []
	for (let i = (index == undefined ? 0 : index); i < (index == undefined ? self.config.connectionNumber : index + 1); i++) {
		let value = {}
		if (self.connections) {
			value['connection_' + i + '_remote_ip'] = self.connections[i]?.IP
			value['connection_' + i + '_remote_port'] = self.connections[i]?.Port
			value['connection_' + i + '_protocol'] = self.config['connection' + i + 'protocol']
			value['connection_' + i + '_name'] = self.config['connection' + i + 'name']
		}
		if (value) {
			self.setVariableValues(value)
		}

	}
}