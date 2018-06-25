var winston = require('winston');
var net = require('net');
var fs = require('fs');
var _ = require('lodash');
var util = require('util');
var path = require('path');
var crypto = require('crypto');

var fs_appendFile = util.promisify(fs.appendFile);

function Server(opts) {
    if (!(this instanceof Server)) {
        return new Server(opts);
    }

    var defaults = {
        host: '0.0.0.0',
        port: 9003,
        password: '01230123012301230123012301230123',
        filename: 'log'
    };

    _.extend(this, defaults, opts);

    /* processing stream */
    this.ipToBuffer = {};

    if (this.password != null) {
        this.key = new Buffer(this.password.substring(0, 16));
        this.iv = new Buffer(this.password.substring(16, 32));
    }
}


Server.prototype.createServer = function() {

    this.server = net.createServer(function(stream) {

        this.ipToBuffer[stream.remoteAddress + ':' + stream.remotePort] = {
            incomingBuffer: null,
            incomingIdx:    -1
        }

        console.log(`start connection: ${stream.remoteAddress + ':' + stream.remotePort}`);


        stream.on('data', function(chunk) {
            console.log(`receive chunk: ${chunk.byteLength}`);
            this.process(chunk, stream.remoteAddress, stream.remotePort);
        }.bind(this));

        stream.on('end', async function() {
            stream.destroy();
            console.log(`end connection: ${stream.remoteAddress + ':' + stream.remotePort}`);
            //this.process(chunk, stream.remoteAddress, stream.remotePort);
        }.bind(this));

        //stream.pipe(fs.createWriteStream(this.filename, {flags: 'a'}));

    }.bind(this));

    console.log('Listening on port %d', this.port);
};

Server.prototype.receive = async function (ciphertext, ip, port) {
    if (this.password == null) {
        try {
            var log = JSON.parse(ciphertext.toString());
            var tokens = _(log).chain().pick('level', 'message', 'meta', 'timestamp').values().value();
            await fs_appendFile(`${that.filename}-${ip}-${port}.txt`,
                JSON.stringify(Object.assign({timestamp: tokens[3]}, tokens[2])) + '\n');
        } catch (ex) {
            console.error(ex);
        }
        return;
    }


    var decipher = crypto.createDecipheriv('aes-128-cbc', this.key, this.iv);
    var plaintext = null;

    that = this;
    decipher.on('readable', function () {
        try {
            var chunk = decipher.read();
        } catch (ex) {
            console.error(ex);
        }
        if(chunk!=null) {
            if (!plaintext) {
                plaintext = chunk;
            } else {
                plaintext = Buffer.concat([plaintext, chunk], plaintext.length + chunk.length);
            }
        }
        chunk = null;
    });

    decipher.on('end', async function () {
        try {
            var log = JSON.parse(plaintext.toString());
            var tokens = _(log).chain().pick('level', 'message', 'meta', 'timestamp').values().value();
            await fs_appendFile(`${that.filename}-${ip}-${port}.txt`,
                JSON.stringify(Object.assign({timestamp: tokens[3]}, tokens[2])) + '\n');
        } catch (ex) {
            console.error(ex);
        }
    });

    decipher.write(ciphertext);
    decipher.end();
}

/* parse content and write to file */
Server.prototype.process = async function (chunk, ip, port) {
    if (!chunk) return;

    var isNewMessage = (this.ipToBuffer[ip + ':' + port].incomingIdx == -1); //if the incoming index is -1, this means it may be a new message.

    var startIdx = 0;

    if (chunk[0] == 0xff) {
        this.ipToBuffer[ip + ':' + port].incomingBuffer = null;
        this.ipToBuffer[ip + ':' + port].incomingIdx = -1;
        this.ipToBuffer[ip + ':' + port].expectedLength = -1;
        isNewMessage = true;
    }

    if (isNewMessage) {


        this.ipToBuffer[ip + ':' + port].expectedLength = chunk[1];

        if (chunk[0] != 0xff) {

            var isValidChunk = false;

            for (var i = 0; i < chunk.length - 1; ++i) {
                if (chunk[i] == SYNC_BYTES) {
                    chunk = chunk.slice(i);
                    isValidChunk = true;
                    break;
                }
            }

            this.ipToBuffer[ip + ':' + port].incomingBuffer = null;
            this.ipToBuffer[ip + ':' + port].incomingIdx = -1;
            this.ipToBuffer[ip + ':' + port].expectedLength = -1;

            if (!isValidChunk) {
                chunk = null;
                return;
            } else {
                this.ipToBuffer[ip + ':' + port].expectedLength = chunk[1];
            }
        }

        this.ipToBuffer[ip + ':' + port].incomingBuffer = new Buffer(this.ipToBuffer[ip + ':' + port].expectedLength);
        this.ipToBuffer[ip + ':' + port].incomingIdx = 0;
        startIdx = 2;
    }

    var remainder = null;
    var bytesLeft = this.ipToBuffer[ip + ':' + port].expectedLength - this.ipToBuffer[ip + ':' + port].incomingIdx;

    var endIdx = startIdx + bytesLeft;
    if (endIdx > chunk.length) {
        endIdx = chunk.length;
    }

    var start_idx = startIdx;
    var end_idx = endIdx;

    if (startIdx < endIdx) {
        chunk.copy(this.ipToBuffer[ip + ':' + port].incomingBuffer, this.ipToBuffer[ip + ':' + port].incomingIdx, startIdx, endIdx);
    }
    this.ipToBuffer[ip + ':' + port].incomingIdx += endIdx - startIdx;

    end_idx = endIdx;
    chunkLen = chunk.length;

    if (endIdx < chunk.length) {
        remainder = new Buffer(chunk.length -  endIdx);
        chunk.copy(remainder, 0, endIdx, chunk.length);
    }

    var inxoming_idx = this.ipToBuffer[ip + ':' + port].incomingIdx;
    var expect_length = this.ipToBuffer[ip + ':' + port].expectedLength;

    if (this.ipToBuffer[ip + ':' + port].incomingIdx == this.ipToBuffer[ip + ':' + port].expectedLength) {

        /* finish */
        try {
            this.receive(this.ipToBuffer[ip + ':' + port].incomingBuffer, ip, port);
        } catch(err) {
            console.error(err);
        }

        this.ipToBuffer[ip + ':' + port].incomingBuffer = null;
        this.ipToBuffer[ip + ':' + port].incomingIdx = -1;
        this.ipToBuffer[ip + ':' + port].expectedLength = -1;

        if (remainder != null) {
            this.process(remainder);
        } else {
            chunk = null;
        }
    } else {
        return;
    }
}

Server.prototype.listen = function() {
    this.server.listen(this.port, this.host);
};

module.exports = {
    createServer: function(opts) {
        var server = new Server(opts);
        server.createServer();
        return server;
    }
};
