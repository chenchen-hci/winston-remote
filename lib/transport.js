var util = require('util');
var net = require('net');
var winston = require('winston');
var _ = require('lodash');
var Readable = require('stream').Readable;
var crypto = require('crypto');
var cluster = require('cluster');

/**
 * compact object using loadash util.
 * @param obj
 * @return {*}
 */
function compactObject(obj) {
    _.forOwn(obj, function(val, key) {
       if (_.isEmpty(val)) delete obj[key];
    });
    return obj;
}
_.mixin({'compactObject': compactObject});

/**
 * create a new transports.
 * @param opts
 * @constructor
 */
function Remote(opts) {
    var defaults = {
        host: '0.0.0.0',
        port: 9003,
        label: null,
        stack: false,
        password: null
    };
    _.extend(this, defaults, opts);

    this.name = 'Remote'; /* make sure winston is able to recognized */

    this.pid = process.pid;
    this.wid = (cluster.isMaster? 0 : cluster.worker.id);

    this.connect();

    Remote.super_.apply(this, arguments);

    if (this.password != null) {
        this.key = new Buffer(this.password.substring(0, 16));
        this.iv = new Buffer(this.password.substring(16, 32));
    }
}

/* inherit from winston transport api */
util.inherits(Remote, winston.Transport);

/**
 * send the payload with encryption being used or not
 * @param payload
 */
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

/**
 * establish connection to server
 */
Remote.prototype.connect = function() {
    that = this;

    this.client = net.connect({host: this.host, port: this.port}, (err) => {
        console.log(`connection to ${this.host + ':' + this.port}`);
        if (err) {
            that.client = undefined;
            console.error(err);
            //throw new Error(err);
        }
    });

    this.client.on('error', function(err) {
        that.client.end();
        that.client.destroy();
        that.client = undefined;
        console.error(err);
    //    throw new Error(err);
    });

    this.client.on('end', function (err) {
        that.client.end();
        that.client.destroy();
        that.client = undefined;
        console.error(err);
        //throw new Error(err);
    });

    this.client.on('data', function (chunk) {
        that.client.end();
        that.client.destroy();
        that.client = undefined;
        console.error('socket is only allowed to send data');
        //throw new Error('socket is only allowed to send data');
    });

    this.client.on('close', function() {
        console.log('client closed');
    });
};

/**
 * create error stack trace.
 * @return {string}
 */
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

/**
 * log to file.
 * @param level
 * @param message
 * @param meta
 * @param callback
 */
Remote.prototype.log = function(level, message, meta, callback) {
    var col = [{level: level}];
    var msg = message;
    if (this.label) msg = [this.label, message].join('::');
    if (this.stack) msg = msg.concat(getLineInfo());

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
        console.error('undefined socket');
        //throw new Error('undefined socket');
    }

    this.emit('logged');
    if (callback) callback(null, true);
};

module.exports = Remote;
