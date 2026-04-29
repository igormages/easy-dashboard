import * as vscode from 'vscode';

class Message {

	type:
	string|null = null;

	data:
	any|null = null;

	constructor(type: string, data: any|null=null) {

		this.type = type;
		this.data = data;

		return;
	};

	static FromObject(input: { type?: unknown, data?: unknown }):
	Message {

		let type = 'unknown';
		let data: any = {};

		if(typeof input.type === 'string')
		type = input.type;

		if(input.data && typeof input.data === 'object')
		data = input.data;

		return new Message(type, data);
	};

};

export default Message;
