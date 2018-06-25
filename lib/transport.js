var util = require('util');
var net = require('net');
var winston = require('winston');
var _ = require('lodash');
var Readable = require('stream').Readable;
var crypto = require('crypto');
var cluster = require('cluster');

function compactObject(obj) {
    _.forOwn(obj, function(val, key) {
       if (_.isEmpty(val)) delete obj[key];
    });
    return obj;
}
_.mixin({'compactObject': compactObject});

/* constructor */
function Remote(opts) {
    var defaults = {
        host: '0.0.0.0',
        port: 9003,
        label: null,
        stack: false,
        password: '01230123012301230123012301230123'
    };
    _.extend(this, defaults, opts);

    this.name = 'Remote';
    /* get pid and wid */
    this.pid = process.pid;
    this.wid = (cluster.isMaster? 0 : cluster.worker.id);

    this.connect();

    Remote.super_.apply(this, arguments);

    if (this.password != null) {
        this.key = new Buffer(this.password.substring(0, 16));
        this.iv = new Buffer(this.password.substring(16, 32));
    }
}

util.inherits(Remote, winston.Transport);   /* child, parent */

Remote.prototype.send = function (payload) {

    if (this.password == null) {
        var buf = new Buffer(payload.byteLength + 2);
        payload.copy(buf, 2, 0, payload.byteLength);
        buf[0] = 0xff;
        buf[1] = payload.byteLength
        this.client.write(buf);
        return;
    }

    var cipher = crypto.createCipheriv('aes-128-cbc', this.key, this.iv);
    var ciphertext = null;

    that = this;
    cipher.on('readable', function () {
        try {
            var chunk = cipher.read();
        } catch (ex) {
            console.error(ex);
        }
        if(chunk!=null) {
            if (!ciphertext) {
                ciphertext = chunk;
            } else {
                ciphertext = Buffer.concat([ciphertext, chunk], ciphertext.length + chunk.length);
            }
        }
        chunk = null;
    });

    cipher.on('end', function () {
        var buf = new Buffer(ciphertext.byteLength + 2);
        ciphertext.copy(buf, 2, 0, ciphertext.byteLength);
        buf[0] = 0xff;
        buf[1] = ciphertext.byteLength
        that.client.write(buf);
    });

    cipher.write(payload);
    cipher.end();
};

Remote.prototype.connect = function() {
    /*  host is set in constructor */
    that = this;

    this.client = net.connect({host: this.host, port: this.port}, (err) => {
        console.log(`connection to ${this.host + ':' + this.port}`);
        /* socket established failed */
        if (err) {
            that.client = undefined;
            throw new Error(err);
        }
    });

    /* connection error */
    this.client.on('error', function(err) {
        that.client.end();
        that.client.destroy();
        that.client = undefined;
        throw new Error(err);
    });

    /* socket endded by other party */
    this.client.on('end', function (err) {
        that.client.end();
        that.client.destroy();
        that.client = undefined;
        throw new Error(err);
    });

    /* socket is not supposed to receive data */
    this.client.on('data', function (chunk) {
        that.client.end();
        that.client.destroy();
        that.client = undefined;
        throw new Error('socket is only allowed to send data');
    });

    /* socket closed */
    this.client.on('close', function() {
        console.log('client closed');
    });
};


function getLineInfo() {
    var stack = (new Error()).stack.split('\n').slice(3);
    // Stack trace format:
    // http://code.google.com/p/v8/wiki/JavaScriptStackTraceApi
    var s = stack[7],
        sp = /at\s+(.*)\s+\((.*):(\d*):(\d*)\)/gi.exec(s) || /at\s+()(.*):(\d*):(\d*)/gi.exec(s);
    var data = {};
    if (sp.length === 5) {
        data.method = sp[1];
        data.path = sp[2];
        data.line = sp[3];
        data.pos = sp[4];
        data.file = require('path').basename(data.path);
    }
    delete stack;
    return [' at ', data.path.replace(process.cwd() + '/', ''), (':' + data.line) || '', (':' + data.pos) || '', ' ', data.method || ''].join('');
}

Remote.prototype.log = function(level, message, meta, callback) {
    var col = [{level: level}];
    var msg = message;
    if (this.label) msg = [this.label, message].join('::');
    if (this.stack) msg = msg.concat(getLineInfo());

    /* added */
    meta['pid'] = this.pid;
    meta['wid'] = this.wid;

    col.push({message: msg, meta: meta, timestamp: (new Date()).toString()});

    var log = _.compactObject(_.reduce(col, function(acc,o) { return _.extend(acc,o); },{}));

    if (this.client == undefined) {
        this.connect();
    }

    if (this.client != undefined) {
        var payload = Buffer.from([JSON.stringify(log), '\n'].join(''));

        console.log(payload.toString());

        try {
            this.send(payload);
        } catch (ex) {
            console.error(ex);
        }
    } else {
        throw new Error('undefined socket');
    }

    // var stream = Readable();
    // stream.push([JSON.stringify(log),'\n'].join(''));
    // stream.push(null);
    // stream.pipe(this.client());

    this.emit('logged');
    if (callback) callback(null, true);
};

module.exports = Remote;
